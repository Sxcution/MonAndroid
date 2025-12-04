import React, { useRef, useEffect, useState, useCallback } from 'react';
import { cn } from '@/utils/helpers';
import { deviceService } from '@/services/deviceService';
import { Device } from '@/types/device';
import { wsService } from '@/services/websocket';

interface ScreenViewProps {
    device: Device;
    className?: string;
    interactive?: boolean;
    active?: boolean;
}

export const ScreenView: React.FC<ScreenViewProps> = ({ 
    device, 
    className,
    interactive = true,
    active = true
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [dimensions, setDimensions] = useState({ width: 288, height: 600 });
    
    // Refs cho logic
    const dragStartRef = useRef<{ x: number, y: number, t: number } | null>(null);
    const decoderRef = useRef<VideoDecoder | null>(null);
    const spsRef = useRef<Uint8Array | null>(null);
    const ppsRef = useRef<Uint8Array | null>(null);
    const hasConfiguredRef = useRef(false);

    // 1. Layout Resolution
    useEffect(() => {
        if (device.resolution) {
            const match = device.resolution.match(/(\d+)x(\d+)/);
            if (match) {
                const w = parseInt(match[1]);
                const h = parseInt(match[2]);
                setDimensions({ width: w * 0.4, height: h * 0.4 });
            }
        }
    }, [device.resolution]);

    useEffect(() => {
        if (canvasRef.current) {
            canvasRef.current.width = dimensions.width;
            canvasRef.current.height = dimensions.height;
        }
    }, [dimensions]);

    // 2. Decoder Setup
    const resetDecoder = useCallback(() => {
        if (decoderRef.current && decoderRef.current.state !== 'closed') {
            try { decoderRef.current.reset(); } catch {}
        }
        hasConfiguredRef.current = false;
        spsRef.current = null;
        ppsRef.current = null;
    }, []);

    useEffect(() => {
        if (!active) return;

        const ctx = canvasRef.current?.getContext('2d', { alpha: false });
        const decoder = new VideoDecoder({
            output: (frame) => {
                if (ctx && canvasRef.current) {
                    ctx.drawImage(frame, 0, 0, canvasRef.current.width, canvasRef.current.height);
                }
                frame.close();
            },
            error: (e) => {
                console.error('Decoder Error:', e);
                resetDecoder();
            }
        });
        decoderRef.current = decoder;

        return () => {
            if (decoder.state !== 'closed') decoder.close();
        };
    }, [active, resetDecoder]);

    // 3. Streaming Logic
    useEffect(() => {
        if (!active) return;

        const handleMessage = (data: ArrayBuffer | string) => {
            if (!decoderRef.current || decoderRef.current.state === 'closed') return;
            if (!(data instanceof ArrayBuffer)) return;

            const buf = new Uint8Array(data);
            // Protocol: [1 byte ID Len] [ID Bytes] [NAL Data]
            if (buf.byteLength < 2) return;
            const idLen = buf[0];
            if (buf.byteLength < 1 + idLen) return;

            // Filter ID
            const msgDeviceId = new TextDecoder().decode(buf.subarray(1, 1 + idLen));
            if (msgDeviceId !== device.id) return;

            const nalUnit = buf.subarray(1 + idLen);
            const nalType = getNALType(nalUnit);

            if (nalType === 7) spsRef.current = nalUnit;
            else if (nalType === 8) ppsRef.current = nalUnit;

            // Configure
            if (!hasConfiguredRef.current && spsRef.current && ppsRef.current) {
                const sps = spsRef.current;
                let offset = (sps[2] === 1) ? 3 : 4;
                if (offset + 3 < sps.length) {
                    const profile = sps[offset+1].toString(16).padStart(2,'0').toUpperCase();
                    const compat = sps[offset+2].toString(16).padStart(2,'0').toUpperCase();
                    const level = sps[offset+3].toString(16).padStart(2,'0').toUpperCase();
                    const codec = `avc1.${profile}${compat}${level}`;
                    
                    try {
                        decoderRef.current.configure({
                            codec: codec,
                            optimizeForLatency: true
                        });
                        hasConfiguredRef.current = true;
                    } catch (e) {
                        resetDecoder();
                        return;
                    }
                }
            }

            // Decode (Annex B Mode - ghép SPS/PPS vào IDR frame)
            if (hasConfiguredRef.current && (nalType === 1 || nalType === 5)) {
                try {
                    let chunkData = nalUnit;
                    if (nalType === 5 && spsRef.current && ppsRef.current) {
                        const newData = new Uint8Array(spsRef.current.length + ppsRef.current.length + nalUnit.length);
                        newData.set(spsRef.current, 0);
                        newData.set(ppsRef.current, spsRef.current.length);
                        newData.set(nalUnit, spsRef.current.length + ppsRef.current.length);
                        chunkData = newData;
                    }

                    const chunk = new EncodedVideoChunk({
                        type: nalType === 5 ? 'key' : 'delta',
                        timestamp: performance.now() * 1000,
                        data: chunkData
                    });
                    
                    if (decoderRef.current.decodeQueueSize < 3) {
                        decoderRef.current.decode(chunk);
                    }
                } catch (e) {
                    console.error(e);
                }
            }
        };

        const unsubscribe = wsService.subscribe(handleMessage);

        // Chỉ gửi lệnh Start, KHÔNG gửi lệnh Stop khi unmount component con
        wsService.sendMessage({ type: 'subscribe', device_id: device.id });
        fetch(`http://localhost:8080/api/streaming/start/${device.id}`, { method: 'POST' }).catch(()=>{});

        return () => {
            unsubscribe();
            // ⚠️ QUAN TRỌNG: Đã xóa dòng gọi API STOP ở đây.
            // Stream sẽ tiếp tục chạy nền, giúp chuyển đổi UI mượt mà.
        };
    }, [device.id, active, resetDecoder]);

    // 4. Mouse Interaction (Fire-and-Forget)
    const getCoords = (e: React.MouseEvent) => {
        if (!canvasRef.current || !device.resolution) return null;
        const match = device.resolution.match(/(\d+)x(\d+)/);
        if (!match) return null;

        const origW = parseInt(match[1]);
        const origH = parseInt(match[2]);
        const rect = canvasRef.current.getBoundingClientRect();

        return {
            x: Math.floor((e.clientX - rect.left) / rect.width * origW),
            y: Math.floor((e.clientY - rect.top) / rect.height * origH)
        };
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        if (!interactive) return;
        const coords = getCoords(e);
        if (coords) dragStartRef.current = { ...coords, t: Date.now() };
    };

    const handleMouseUp = (e: React.MouseEvent) => {
        if (!interactive || !dragStartRef.current) return;

        const end = getCoords(e);
        if (!end) return;
        
        const start = dragStartRef.current;
        const dist = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));
        const duration = Date.now() - start.t;

        // 🔥 FIX DELAY: Không dùng await, gọi xong quên luôn
        if (dist > 10) {
            deviceService.swipe(device.id, start.x, start.y, end.x, end.y, Math.max(duration, 100))
                .catch(err => console.error("Swipe failed", err));
        } else {
            deviceService.tap(device.id, end.x, end.y)
                .catch(err => console.error("Tap failed", err));
        }

        dragStartRef.current = null;
    };

    return (
        <div className={cn('relative bg-black overflow-hidden select-none', className)}>
            <canvas
                ref={canvasRef}
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
                onMouseLeave={() => dragStartRef.current = null}
                onContextMenu={(e) => e.preventDefault()}
                className={cn("w-full h-full object-contain", interactive ? "cursor-pointer" : "cursor-default")}
            />
        </div>
    );
};

function getNALType(data: Uint8Array): number {
    if (data.length > 4 && data[0] === 0 && data[1] === 0 && data[2] === 0 && data[3] === 1) return data[4] & 0x1F;
    if (data.length > 3 && data[0] === 0 && data[1] === 0 && data[2] === 1) return data[3] & 0x1F;
    return -1;
}
