import React, { useRef, useEffect, useState, useCallback } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { cn } from '@/utils/helpers';
import { deviceService } from '@/services/deviceService';
import { Device } from '@/types/device';
import { useWebSocket } from '@/services/websocket';

interface ScreenViewProps {
    device: Device;
    className?: string;
}

export const ScreenView: React.FC<ScreenViewProps> = ({ device, className }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [dimensions, setDimensions] = useState({ width: 288, height: 600 });
    const [fps, setFps] = useState(0);
    
    const { lastMessage, sendMessage, isConnected } = useWebSocket();
    
    const decoderRef = useRef<VideoDecoder | null>(null);
    const frameCountRef = useRef(0);
    const lastFpsUpdateRef = useRef(Date.now());
    
    const spsRef = useRef<Uint8Array | null>(null);
    const ppsRef = useRef<Uint8Array | null>(null);
    const hasConfiguredRef = useRef(false);

    // --- 1. Layout & Resolution ---
    useEffect(() => {
        if (device.resolution) {
            const match = device.resolution.match(/(\d+)x(\d+)/);
            if (match) {
                const w = parseInt(match[1]);
                const h = parseInt(match[2]);
                // Scale 40% để vừa UI
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

    // --- 2. Streaming Control ---
    useEffect(() => {
        if (!isConnected) return;

        console.log('🚀 Starting stream for:', device.id);
        sendMessage({ type: 'subscribe', device_id: device.id });
        
        fetch(`http://localhost:8080/api/streaming/start/${device.id}`, { method: 'POST' })
            .catch(e => console.error('❌ Start stream failed:', e));

        return () => {
            fetch(`http://localhost:8080/api/streaming/stop/${device.id}`, { method: 'POST' }).catch(() => {});
            sendMessage({ type: 'unsubscribe', device_id: device.id });
        };
    }, [device.id, isConnected, sendMessage]);

    // --- 3. Decoder Setup with Auto-Reset ---
    const resetDecoder = useCallback(() => {
        if (!decoderRef.current) return;
        if (decoderRef.current.state !== 'closed') {
            try {
                decoderRef.current.reset(); // Reset state to 'unconfigured'
            } catch (e) {
                console.warn("Reset failed, ignoring:", e);
            }
        }
        hasConfiguredRef.current = false;
        console.log("🔄 Decoder reset requested");
    }, []);

    useEffect(() => {
        const decoder = new VideoDecoder({
            output: (frame) => {
                if (canvasRef.current) {
                    const ctx = canvasRef.current.getContext('2d');
                    if (ctx) {
                        ctx.drawImage(frame, 0, 0, canvasRef.current.width, canvasRef.current.height);
                    }
                }
                frame.close();

                // FPS counter
                frameCountRef.current++;
                const now = Date.now();
                if (now - lastFpsUpdateRef.current >= 1000) {
                    setFps(frameCountRef.current);
                    frameCountRef.current = 0;
                    lastFpsUpdateRef.current = now;
                }
            },
            error: (e) => {
                console.error('❌ VideoDecoder Error:', e);
                resetDecoder(); // Tự động reset khi gặp lỗi
            }
        });

        decoderRef.current = decoder;

        return () => {
            if (decoder.state !== 'closed') decoder.close();
        };
    }, [resetDecoder]);

    // --- 4. NAL Processing ---
    useEffect(() => {
        if (!lastMessage || !decoderRef.current) return;
        if (!(lastMessage instanceof ArrayBuffer)) return;

        const decoder = decoderRef.current;
        if (decoder.state === 'closed') return; // Safety check

        const buf = new Uint8Array(lastMessage);
        if (buf.byteLength < 5) return;

        const view = new DataView(buf.buffer);
        const len = view.getUint32(0);
        if (len + 4 > buf.byteLength) return;

        const nalUnit = buf.subarray(4, 4 + len);
        const nalType = getNALType(nalUnit);

        // Save SPS/PPS
        if (nalType === 7) spsRef.current = nalUnit;
        else if (nalType === 8) ppsRef.current = nalUnit;

        // Configure Decoder
        if (!hasConfiguredRef.current && spsRef.current && ppsRef.current) {
            let spsRaw = stripStartCode(spsRef.current);
            const ppsRaw = stripStartCode(ppsRef.current);

            // 🔥 SPS Level Patching (Fix for high-res on low-level profiles)
            if (spsRaw.length > 3 && spsRaw[3] < 0x2A) {
                const newSps = new Uint8Array(spsRaw);
                newSps[3] = 0x2A; // Force Level 4.2
                spsRaw = newSps;
                console.log("⚠️ Level patched to 4.2");
            }

            const profile = spsRaw[1].toString(16).padStart(2, '0').toUpperCase();
            const compat = spsRaw[2].toString(16).padStart(2, '0').toUpperCase();
            const level = spsRaw[3].toString(16).padStart(2, '0').toUpperCase();
            const codec = `avc1.${profile}${compat}${level}`;

            const description = createAVCDecoderConfigurationRecord(spsRaw, ppsRaw);

            if (decoder.state === 'unconfigured') {
                try {
                    console.log(`🔧 Configuring: ${codec}`);
                    decoder.configure({
                        codec: codec,
                        optimizeForLatency: true,
                        description: description
                    });
                    hasConfiguredRef.current = true;
                } catch (e) {
                    console.error('Configuration Failed:', e);
                    resetDecoder();
                }
            }
        }

        // Decode Frame
        if (hasConfiguredRef.current && (nalType === 1 || nalType === 5)) {
            if (decoder.state === 'configured') {
                try {
                    // Convert to AVCC (Length prefix) for WebCodecs
                    const avccData = convertToAVCC(nalUnit);
                    
                    const chunk = new EncodedVideoChunk({
                        type: nalType === 5 ? 'key' : 'delta',
                        timestamp: performance.now() * 1000,
                        data: avccData
                    });

                    // Simple Backpressure to prevent queue overload
                    if (decoder.decodeQueueSize < 10) {
                        decoder.decode(chunk);
                    }
                } catch (e) {
                    console.error('Decode Error:', e);
                    // Don't reset immediately on decode error, might be one bad frame
                }
            }
        }
    }, [lastMessage, resetDecoder]);

    // --- Interaction ---
    const handleCanvasClick = async (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!canvasRef.current || !device.resolution) return;
        
        const match = device.resolution.match(/(\d+)x(\d+)/);
        if (!match) return;

        const origW = parseInt(match[1]);
        const origH = parseInt(match[2]);
        const rect = canvasRef.current.getBoundingClientRect();
        
        const x = Math.floor((e.clientX - rect.left) / rect.width * origW);
        const y = Math.floor((e.clientY - rect.top) / rect.height * origH);

        deviceService.tap(device.id, x, y).catch(console.error);
    };

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
            <canvas
                ref={canvasRef}
                onClick={handleCanvasClick}
                className="w-full h-full object-contain cursor-pointer"
            />
            <div className="absolute top-2 left-2 px-2 py-1 bg-black/60 rounded text-white text-xs pointer-events-none">
                {fps} FPS | {dimensions.width}x{dimensions.height}
            </div>
            <button
                onClick={toggleFullscreen}
                className="absolute top-2 right-2 p-2 bg-black/50 hover:bg-black/70 rounded-md text-white"
            >
                {isFullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
            </button>
        </div>
    );
};

// --- Helpers ---

function getNALType(data: Uint8Array): number {
    if (data.length > 4 && data[0] === 0 && data[1] === 0 && data[2] === 0 && data[3] === 1) return data[4] & 0x1F;
    if (data.length > 3 && data[0] === 0 && data[1] === 0 && data[2] === 1) return data[3] & 0x1F;
    return -1;
}

function stripStartCode(data: Uint8Array): Uint8Array {
    if (data.length > 4 && data[0] === 0 && data[1] === 0 && data[2] === 0 && data[3] === 1) return data.subarray(4);
    if (data.length > 3 && data[0] === 0 && data[1] === 0 && data[2] === 1) return data.subarray(3);
    return data;
}

function convertToAVCC(data: Uint8Array): Uint8Array {
    let offset = 0;
    if (data.length > 4 && data[0] === 0 && data[1] === 0 && data[2] === 0 && data[3] === 1) offset = 4;
    else if (data.length > 3 && data[0] === 0 && data[1] === 0 && data[2] === 1) offset = 3;
    else return data;

    const length = data.length - offset;
    const newData = new Uint8Array(length + 4);
    const view = new DataView(newData.buffer);
    view.setUint32(0, length);
    newData.set(data.subarray(offset), 4);
    return newData;
}

function createAVCDecoderConfigurationRecord(sps: Uint8Array, pps: Uint8Array): Uint8Array {
    const bodyLength = 5 + 1 + 2 + sps.length + 1 + 2 + pps.length;
    const buf = new Uint8Array(bodyLength);
    const view = new DataView(buf.buffer);
    let offset = 0;
    buf[offset++] = 1; // version
    buf[offset++] = sps[1]; // profile
    buf[offset++] = sps[2]; // compatibility
    buf[offset++] = sps[3]; // level
    buf[offset++] = 0xFF;
    buf[offset++] = 0xE1; // numSPS
    view.setUint16(offset, sps.length, false); offset += 2;
    buf.set(sps, offset); offset += sps.length;
    buf[offset++] = 1; // numPPS
    view.setUint16(offset, pps.length, false); offset += 2;
    buf.set(pps, offset); offset += pps.length;
    return buf;
}