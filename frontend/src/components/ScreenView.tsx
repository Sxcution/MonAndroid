import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { cn } from '@/utils/helpers';
import { deviceService } from '@/services/deviceService';
import { Device } from '@/types/device';
import { wsService } from '@/services/websocket';

interface ScreenViewProps {
    device: Device;
    className?: string;
}

export const ScreenView: React.FC<ScreenViewProps> = ({ device, className }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [dimensions, setDimensions] = useState({ width: 288, height: 600 });
    const [fps, setFps] = useState(0);
    
    const decoderRef = useRef<VideoDecoder | null>(null);
    const frameCountRef = useRef(0);
    const lastFpsUpdateRef = useRef(Date.now());
    
    // Cache SPS/PPS để ghép vào Keyframe
    const spsRef = useRef<Uint8Array | null>(null);
    const ppsRef = useRef<Uint8Array | null>(null);
    const hasConfiguredRef = useRef(false);

    // --- 1. Layout ---
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

    // --- 2. Decoder Setup (Annex B Mode) ---
    const resetDecoder = useCallback(() => {
        if (decoderRef.current && decoderRef.current.state !== 'closed') {
            try { decoderRef.current.reset(); } catch {}
        }
        hasConfiguredRef.current = false;
        spsRef.current = null;
        ppsRef.current = null;
        console.log("🔄 Decoder reset");
    }, []);

    useEffect(() => {
        const ctx = canvasRef.current?.getContext('2d', { alpha: false }); // alpha: false để tối ưu
        
        const decoder = new VideoDecoder({
            output: (frame) => {
                if (ctx && canvasRef.current) {
                    // Vẽ frame lên canvas
                    ctx.drawImage(frame, 0, 0, canvasRef.current.width, canvasRef.current.height);
                }
                frame.close();

                // Tính FPS
                frameCountRef.current++;
                const now = Date.now();
                if (now - lastFpsUpdateRef.current >= 1000) {
                    setFps(frameCountRef.current);
                    frameCountRef.current = 0;
                    lastFpsUpdateRef.current = now;
                }
            },
            error: (e) => {
                console.error('❌ Decoder Error:', e);
                resetDecoder();
            }
        });

        decoderRef.current = decoder;

        return () => {
            if (decoder.state !== 'closed') decoder.close();
        };
    }, [resetDecoder]);

    // --- 3. Handle Data ---
    useEffect(() => {
        const handleMessage = (data: ArrayBuffer | string) => {
            if (!decoderRef.current || decoderRef.current.state === 'closed') return;
            if (!(data instanceof ArrayBuffer)) return;

            const buf = new Uint8Array(data);
            
            // Protocol mới: [1 byte ID_LENGTH] + [ID_BYTES] + [NAL_DATA]
            if (buf.byteLength < 2) return;
            
            const idLen = buf[0];
            if (buf.byteLength < 1 + idLen) return;

            // Đọc Device ID từ gói tin
            const msgDeviceId = new TextDecoder().decode(buf.subarray(1, 1 + idLen));

            // 🔥 LỌC: Nếu không phải ID của máy mình -> Bỏ qua ngay lập tức
            if (msgDeviceId !== device.id) {
                return; 
            }

            // Lấy NAL Data thực sự
            const nalUnit = buf.subarray(1 + idLen);
            const nalType = getNALType(nalUnit);

            // 1. Lưu SPS/PPS
            if (nalType === 7) spsRef.current = nalUnit; // SPS
            else if (nalType === 8) ppsRef.current = nalUnit; // PPS

            // 2. Cấu hình Decoder (khi có SPS lần đầu)
            if (!hasConfiguredRef.current && spsRef.current && ppsRef.current) {
                const sps = spsRef.current;
                // Auto detect profile string
                // Byte 1, 2, 3 sau start code là Profile, Compatibility, Level
                // Start code có thể là 3 hoặc 4 byte
                const startCodeLen = (sps[2] === 1) ? 3 : 4;
                const profile = sps[startCodeLen + 1].toString(16).padStart(2, '0').toUpperCase();
                const compat = sps[startCodeLen + 2].toString(16).padStart(2, '0').toUpperCase();
                const level = sps[startCodeLen + 3].toString(16).padStart(2, '0').toUpperCase();
                const codecString = `avc1.${profile}${compat}${level}`;
                
                console.log(`🔧 Config Codec: ${codecString} (AnnexB Mode)`);
                
                try {
                    decoderRef.current.configure({
                        codec: codecString,
                        optimizeForLatency: true,
                        // KHÔNG truyền description khi dùng chế độ Annex B
                    });
                    hasConfiguredRef.current = true;
                } catch (e) {
                    console.error('Config failed:', e);
                    resetDecoder();
                }
            }

            // 3. Giải mã
            if (hasConfiguredRef.current && (nalType === 1 || nalType === 5)) {
                try {
                    let chunkData = nalUnit;

                    // Nếu là Keyframe (IDR - 5), chúng ta NÊN ghép thêm SPS/PPS vào trước
                    // để đảm bảo decoder có context (phòng trường hợp reset)
                    if (nalType === 5 && spsRef.current && ppsRef.current) {
                        const newData = new Uint8Array(spsRef.current.length + ppsRef.current.length + nalUnit.length);
                        newData.set(spsRef.current, 0);
                        newData.set(ppsRef.current, spsRef.current.length);
                        newData.set(nalUnit, spsRef.current.length + ppsRef.current.length);
                        chunkData = newData;
                        // console.log("🔑 Decoding IDR Frame with headers");
                    }

                    const chunk = new EncodedVideoChunk({
                        type: nalType === 5 ? 'key' : 'delta',
                        timestamp: performance.now() * 1000,
                        data: chunkData 
                    });

                    if (decoderRef.current.decodeQueueSize < 5) {
                        decoderRef.current.decode(chunk);
                    }
                } catch (e) {
                    console.error('Decode error:', e);
                }
            }
        };

        const unsubscribe = wsService.subscribe(handleMessage);
        
        // Gửi lệnh start
        wsService.sendMessage({ type: 'subscribe', device_id: device.id });
        fetch(`http://localhost:8080/api/streaming/start/${device.id}`, { method: 'POST' }).catch(() => {});

        return () => {
            unsubscribe();
            wsService.sendMessage({ type: 'unsubscribe', device_id: device.id });
            fetch(`http://localhost:8080/api/streaming/stop/${device.id}`, { method: 'POST' }).catch(() => {});
        };
    }, [device.id, resetDecoder]);

    // --- Interaction ---
    const handleCanvasClick = async (e: React.MouseEvent<HTMLCanvasElement>) => {
        // (Giữ nguyên logic click cũ)
        if (!canvasRef.current || !device.resolution) return;
        const match = device.resolution.match(/(\d+)x(\d+)/);
        if (!match) return;
        const [origW, origH] = [parseInt(match[1]), parseInt(match[2])];
        const rect = canvasRef.current.getBoundingClientRect();
        const x = Math.floor((e.clientX - rect.left) / rect.width * origW);
        const y = Math.floor((e.clientY - rect.top) / rect.height * origH);
        deviceService.tap(device.id, x, y).catch(console.error);
    };
    
    // ... (Giữ nguyên logic fullscreen) ...
    const toggleFullscreen = () => {
        if (!canvasRef.current) return;
        if (!isFullscreen) {
            canvasRef.current.requestFullscreen();
            setIsFullscreen(true);
        } else {
            document.exitFullscreen();
            setIsFullscreen(false);
        }
    };

    useEffect(() => {
        const handler = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', handler);
        return () => document.removeEventListener('fullscreenchange', handler);
    }, []);

    return (
        <div className={cn('relative bg-black rounded-lg overflow-hidden', className)}>
            <canvas ref={canvasRef} onClick={handleCanvasClick} className="w-full h-full object-contain cursor-pointer" />
            <div className="absolute top-2 left-2 px-2 py-1 bg-black/60 rounded text-white text-xs pointer-events-none">
                {fps} FPS | Annex B
            </div>
            <button onClick={toggleFullscreen} className="absolute top-2 right-2 p-2 bg-black/50 hover:bg-black/70 rounded-md text-white">
                {isFullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
            </button>
        </div>
    );
};

function getNALType(data: Uint8Array): number {
    // Tìm start code để lấy NAL type chính xác
    let offset = -1;
    if (data.length > 4 && data[0] === 0 && data[1] === 0 && data[2] === 0 && data[3] === 1) offset = 4;
    else if (data.length > 3 && data[0] === 0 && data[1] === 0 && data[2] === 1) offset = 3;
    
    if (offset !== -1 && offset < data.length) return data[offset] & 0x1F;
    return -1;
}
