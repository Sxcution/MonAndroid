import React, { useRef, useEffect, useState } from 'react';
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

    // Parse resolution
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

    // Update canvas size
    useEffect(() => {
        if (canvasRef.current) {
            canvasRef.current.width = dimensions.width;
            canvasRef.current.height = dimensions.height;
        }
    }, [dimensions]);

    // Start Streaming
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

    // Init Decoder
    useEffect(() => {
        const ctx = canvasRef.current?.getContext('2d');
        if (!ctx || !canvasRef.current) return;

        const decoder = new VideoDecoder({
            output: (frame) => {
                ctx.drawImage(frame, 0, 0, canvasRef.current!.width, canvasRef.current!.height);
                frame.close();

                frameCountRef.current++;
                const now = Date.now();
                if (now - lastFpsUpdateRef.current >= 1000) {
                    setFps(frameCountRef.current);
                    frameCountRef.current = 0;
                    lastFpsUpdateRef.current = now;
                }
            },
            error: (e) => {
                console.error('❌ WebCodecs Error:', e);
                // Reset to try re-configuring if needed
                hasConfiguredRef.current = false;
            }
        });

        decoderRef.current = decoder;
        return () => {
            if (decoder.state !== 'closed') decoder.close();
        };
    }, []);

    // Handle WebSocket Message
    useEffect(() => {
        if (!lastMessage || !decoderRef.current) return;
        if (!(lastMessage instanceof ArrayBuffer)) return;

        const buf = new Uint8Array(lastMessage);
        
        // Protocol: [4 bytes Length] + [NAL Unit Data]
        if (buf.byteLength < 5) return;
        const view = new DataView(buf.buffer);
        const len = view.getUint32(0);
        
        if (len + 4 > buf.byteLength) return;

        // Extract NAL (with Start Code)
        const nalUnit = buf.subarray(4, 4 + len);
        const nalType = getNALType(nalUnit);

        if (nalType === 7) { // SPS
            spsRef.current = nalUnit;
        } else if (nalType === 8) { // PPS
            ppsRef.current = nalUnit;
        }

        const decoder = decoderRef.current;

        // 1. Configure Decoder (One time)
        if (!hasConfiguredRef.current && spsRef.current && ppsRef.current) {
            let spsRaw = stripStartCode(spsRef.current);
            const ppsRaw = stripStartCode(ppsRef.current);

            // 🔥 HACK: Patch Level IDC if it's too low
            // Byte 3 is Level. If < 3.1 (0x1F), force it to 4.2 (0x2A)
            // This fixes "EncodingError" on high-res screens declaring low levels
            if (spsRaw[3] < 0x1F) {
                console.warn(`⚠️ SPS Level ${spsRaw[3].toString(16)} too low. Patching to 4.2 (0x2A)`);
                // Clone to avoid mutating original ref if needed
                const newSps = new Uint8Array(spsRaw);
                newSps[3] = 0x2A; 
                spsRaw = newSps;
            }

            const profile = spsRaw[1].toString(16).padStart(2, '0').toUpperCase();
            const compat = spsRaw[2].toString(16).padStart(2, '0').toUpperCase();
            const level = spsRaw[3].toString(16).padStart(2, '0').toUpperCase();
            const codec = `avc1.${profile}${compat}${level}`;

            console.log(`🔧 Configuring Decoder: ${codec}`);

            try {
                const description = createAVCDecoderConfigurationRecord(spsRaw, ppsRaw);
                decoder.configure({
                    codec: codec,
                    optimizeForLatency: true,
                    description: description
                });
                hasConfiguredRef.current = true;
            } catch (e) {
                console.error('Configuration Failed:', e);
            }
        }

        // 2. Decode Frame
        if (hasConfiguredRef.current && (nalType === 1 || nalType === 5)) {
            try {
                // Convert Annex B (Start Code) to AVCC (Length Prefix) for the chunk
                // This is preferred by WebCodecs when description is provided
                const avccData = convertToAVCC(nalUnit);

                const chunk = new EncodedVideoChunk({
                    type: nalType === 5 ? 'key' : 'delta',
                    timestamp: performance.now() * 1000,
                    data: avccData
                });
                
                if (decoder.decodeQueueSize < 5) {
                    decoder.decode(chunk);
                }
            } catch (e) {
                console.error('Decode Error:', e);
            }
        }
    }, [lastMessage]);

    // ... handleCanvasClick and Fullscreen logic remains same ...
    const handleCanvasClick = async (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!canvasRef.current) return;
        
        // Parse lại resolution cho chắc chắn (tìm cặp số đầu tiên)
        const match = device.resolution.match(/(\d+)x(\d+)/);
        if (!match) {
             console.warn("Cannot parse resolution for tap:", device.resolution);
             return;
        }
        
        const origW = parseInt(match[1]);
        const origH = parseInt(match[2]);

        const rect = canvasRef.current.getBoundingClientRect();
        
        // Tính toán tọa độ
        const x = Math.floor((e.clientX - rect.left) / rect.width * origW);
        const y = Math.floor((e.clientY - rect.top) / rect.height * origH);

        console.log(`Tap: ${x},${y} (Screen: ${origW}x${origH})`); // Debug log

        try {
            await deviceService.tap(device.id, x, y);
        } catch (error) {
            console.error('Failed to send tap:', error);
        }
    };

    return (
        <div className={cn('relative bg-black rounded-lg overflow-hidden', className)}>
            <canvas ref={canvasRef} onClick={handleCanvasClick} className="w-full h-full object-contain" />
            <div className="absolute top-2 left-2 px-2 py-1 bg-black/60 rounded text-white text-xs pointer-events-none">
                {fps} FPS
            </div>
            {fps === 0 && (
                <div className="absolute inset-0 flex items-center justify-center text-white/50">
                    <div className="animate-spin text-2xl">⟳</div>
                </div>
            )}
        </div>
    );
};

// --- HELPERS ---

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

/**
 * Chuyển đổi NAL từ Annex B (00 00 01 data) sang AVCC (Length data)
 * WebCodecs thích định dạng này hơn khi đã có description
 */
function convertToAVCC(data: Uint8Array): Uint8Array {
    let offset = 0;
    if (data.length > 4 && data[0] === 0 && data[1] === 0 && data[2] === 0 && data[3] === 1) offset = 4;
    else if (data.length > 3 && data[0] === 0 && data[1] === 0 && data[2] === 1) offset = 3;
    else return data; // Không tìm thấy start code, trả về nguyên gốc

    const length = data.length - offset;
    const newData = new Uint8Array(length + 4);
    const view = new DataView(newData.buffer);
    
    // Ghi độ dài vào 4 byte đầu (Big Endian)
    view.setUint32(0, length);
    // Copy dữ liệu NAL (bỏ start code)
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
    buf[offset++] = sps[3]; // level (Đã được patch)
    buf[offset++] = 0xFF;   // lengthSizeMinusOne

    buf[offset++] = 0xE1;   // numSPS
    view.setUint16(offset, sps.length, false); offset += 2;
    buf.set(sps, offset); offset += sps.length;

    buf[offset++] = 1;      // numPPS
    view.setUint16(offset, pps.length, false); offset += 2;
    buf.set(pps, offset); offset += pps.length;

    return buf;
}