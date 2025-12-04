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
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const [fps, setFps] = useState(0);
    const { lastMessage, sendMessage, isConnected } = useWebSocket();
    const decoderRef = useRef<VideoDecoder | null>(null);
    const frameCountRef = useRef(0);
    const lastFpsUpdateRef = useRef(Date.now());
    const spsRef = useRef<Uint8Array | null>(null);
    const ppsRef = useRef<Uint8Array | null>(null);

    // Parse device resolution
    useEffect(() => {
        console.log('🔍 Device resolution:', device.resolution);
        if (device.resolution) {
            const resolutionMatch = device.resolution.match(/(\d+)x(\d+)/);
            if (resolutionMatch) {
                const width = parseInt(resolutionMatch[1]);
                const height = parseInt(resolutionMatch[2]);
                const scale = 0.4;
                const scaledDims = { width: width * scale, height: height * scale };
                console.log('📐 Setting canvas dimensions:', scaledDims);
                setDimensions(scaledDims);
            }
        }
    }, [device.resolution]);

    // Manual canvas dimension setting
    useEffect(() => {
        if (canvasRef.current && dimensions.width > 0 && dimensions.height > 0) {
            console.log('🔧 Manually setting canvas dimensions:', dimensions);
            canvasRef.current.width = dimensions.width;
            canvasRef.current.height = dimensions.height;
        }
    }, [dimensions]);

    // Start streaming when WebSocket connected
    useEffect(() => {
        if (!isConnected) {
            console.log('⏳ Waiting for WebSocket connection...');
            return;
        }

        const startStreaming = async () => {
            try {
                console.log('✅ WebSocket connected! Starting H.264 streaming for:', device.id);

                // Subscribe to device
                sendMessage({
                    type: 'subscribe',
                    device_id: device.id
                });
                console.log('📨 Sent subscribe message');

                // Start backend streaming
                await fetch(`http://localhost:8080/api/streaming/start/${device.id}`, { method: 'POST' });
                console.log('🎬 Backend H.264 streaming started');
            } catch (error) {
                console.error('❌ Failed to start streaming:', error);
            }
        };

        startStreaming();

        return () => {
            console.log('🛑 Stopping streaming for:', device.id);
            fetch(`http://localhost:8080/api/streaming/stop/${device.id}`, { method: 'POST' }).catch(console.error);
            sendMessage({
                type: 'unsubscribe',
                device_id: device.id
            });
        };
    }, [device.id, sendMessage, isConnected]);

    // WebCodecs H.264 decoder
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Create VideoDecoder (configure later when we get SPS/PPS)
        const decoder = new VideoDecoder({
            output: (frame) => {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
                frame.close();

                // Update FPS
                frameCountRef.current++;
                const now = Date.now();
                if (now - lastFpsUpdateRef.current >= 1000) {
                    setFps(frameCountRef.current);
                    frameCountRef.current = 0;
                    lastFpsUpdateRef.current = now;
                }
            },
            error: (e) => console.error('❌ WebCodecs decoder error:', e)
        });

        // Will be configured when we receive SPS/PPS
        decoderRef.current = decoder;
        console.log('📹 WebCodecs decoder created (waiting for SPS/PPS to configure)');

        return () => {
            try {
                decoder.close();
            } catch { }
        };
    }, []);

    // Handle WebSocket messages (H.264 binary frames)
    useEffect(() => {
        if (!lastMessage || !decoderRef.current) return;

        // Binary H.264 frame
        if (lastMessage instanceof ArrayBuffer) {
            const buf = new Uint8Array(lastMessage);

            // Parse length-prefix: [4 bytes big-endian][frame data]
            if (buf.byteLength < 4) return;

            const len = (buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3];
            if (len <= 0 || 4 + len > buf.byteLength) {
                console.warn('⚠️ Invalid frame length:', len, 'total:', buf.byteLength);
                return;
            }

            const frame = buf.subarray(4, 4 + len);
            console.log(`📦 Received frame: ${len} bytes`);
            const decoder = decoderRef.current;

            // Extract SPS/PPS if decoder not configured yet
            if (decoder.state === 'unconfigured') {
                const { sps, pps } = extractSPSPPS(frame);

                if (sps) spsRef.current = sps;
                if (pps) ppsRef.current = pps;

                if (spsRef.current && ppsRef.current) {
                    // Create description from SPS+PPS
                    const sps = spsRef.current;
                    const pps = ppsRef.current;
                    const description = new Uint8Array(sps.length + pps.length);
                    description.set(sps, 0);
                    description.set(pps, sps.length);

                    decoder.configure({
                        codec: 'avc1.42E01E',
                        optimizeForLatency: true,
                        description: description,
                    });
                    console.log('✅ Decoder configured with SPS/PPS', {
                        spsLen: sps.length,
                        ppsLen: pps.length
                    });
                } else {
                    // Wait for both SPS and PPS
                    return;
                }
            }

            // Skip if decoder not ready
            if (decoder.state !== 'configured') return;

            // Backpressure: skip frame if decoder queue is full
            if (decoder.decodeQueueSize > 4) {
                return; // Drop frame to keep latency low
            }

            // Detect IDR frame (key frame)
            const type: 'key' | 'delta' = isIDRAnnexB(frame) ? 'key' : 'delta';

            try {
                const chunk = new EncodedVideoChunk({
                    type,
                    timestamp: performance.now() * 1000, // microseconds
                    data: frame
                });
                decoder.decode(chunk);
            } catch (error) {
                console.error('❌ Decode error:', error);
            }
        }
        // JSON message (control/status)
        else if (typeof lastMessage === 'string') {
            try {
                const data = JSON.parse(lastMessage);
                console.log('📨 JSON message:', data);
            } catch { }
        }
    }, [lastMessage]);

    const handleCanvasClick = async (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!canvasRef.current) return;

        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();

        // Calculate click position relative to original device resolution
        const [origWidth, origHeight] = device.resolution.split('x').map(Number);
        const x = Math.floor((e.clientX - rect.left) / rect.width * origWidth);
        const y = Math.floor((e.clientY - rect.top) / rect.height * origHeight);

        try {
            await deviceService.tap(device.id, x, y);
        } catch (error) {
            console.error('Failed to send tap:', error);
        }
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
        const handleFullscreenChange = () => {
            setIsFullscreen(!!document.fullscreenElement);
        };

        document.addEventListener('fullscreenchange', handleFullscreenChange);
        return () => {
            document.removeEventListener('fullscreenchange', handleFullscreenChange);
        };
    }, []);

    return (
        <div className={cn('relative bg-black rounded-lg overflow-hidden', className)}>
            <canvas
                ref={canvasRef}
                width={dimensions.width}
                height={dimensions.height}
                onClick={handleCanvasClick}
                className="w-full h-full object-contain cursor-pointer"
            />

            {/* FPS Counter */}
            {fps > 0 && (
                <div className="absolute top-2 left-2 px-2 py-1 bg-black/70 rounded text-white text-xs font-mono">
                    {fps} FPS • H.264
                </div>
            )}

            {/* Fullscreen button */}
            <button
                onClick={toggleFullscreen}
                className="absolute top-2 right-2 p-2 bg-black/50 hover:bg-black/70 rounded-md text-white transition-colors"
                title={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            >
                {isFullscreen ? (
                    <Minimize2 className="w-5 h-5" />
                ) : (
                    <Maximize2 className="w-5 h-5" />
                )}
            </button>

            {/* Status overlay */}
            {fps === 0 && (
                <div className="absolute inset-0 flex items-center justify-center text-white/60">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto mb-2"></div>
                        <p>{isConnected ? 'Starting H.264 stream...' : 'Connecting...'}</p>
                    </div>
                </div>
            )}
        </div>
    );
};

// Helper: Extract SPS (NAL type 7) and PPS (NAL type 8) from Annex-B frame
function extractSPSPPS(u8: Uint8Array): { sps: Uint8Array | null; pps: Uint8Array | null } {
    let sps: Uint8Array | null = null;
    let pps: Uint8Array | null = null;

    let i = 0;
    while (i < u8.length - 4) {
        // Find start code
        const sc3 = u8[i] === 0 && u8[i + 1] === 0 && u8[i + 2] === 1;
        const sc4 = u8[i] === 0 && u8[i + 1] === 0 && u8[i + 2] === 0 && u8[i + 3] === 1;

        if (!sc3 && !sc4) {
            i++;
            continue;
        }

        const nalStart = i + (sc3 ? 3 : 4);
        if (nalStart >= u8.length) break;

        const nalType = u8[nalStart] & 0x1F;

        // Find next start code to get NAL length
        let nalEnd = nalStart + 1;
        while (nalEnd < u8.length - 3) {
            if ((u8[nalEnd] === 0 && u8[nalEnd + 1] === 0 && u8[nalEnd + 2] === 1) ||
                (u8[nalEnd] === 0 && u8[nalEnd + 1] === 0 && u8[nalEnd + 2] === 0 && u8[nalEnd + 3] === 1)) {
                break;
            }
            nalEnd++;
        }
        if (nalEnd >= u8.length) nalEnd = u8.length;

        // Extract SPS (type 7) or PPS (type 8)
        if (nalType === 7 && !sps) {
            console.log('🔍 Found SPS NAL unit');
            sps = u8.slice(i, nalEnd); // Include start code
        } else if (nalType === 8 && !pps) {
            console.log('🔍 Found PPS NAL unit');
            pps = u8.slice(i, nalEnd); // Include start code
        }

        // Stop if we have both
        if (sps && pps) break;

        i = nalEnd;
    }

    return { sps, pps };
}

// Helper: Check if Annex-B frame contains IDR NAL (type 5)
function isIDRAnnexB(u8: Uint8Array): boolean {
    for (let i = 0; i + 4 < u8.length; i++) {
        const sc3 = u8[i] === 0 && u8[i + 1] === 0 && u8[i + 2] === 1;
        const sc4 = u8[i] === 0 && u8[i + 1] === 0 && u8[i + 2] === 0 && u8[i + 3] === 1;
        if (sc3 || sc4) {
            const off = i + (sc3 ? 3 : 4);
            if (off < u8.length) {
                const nal = u8[off] & 0x1F;
                if (nal === 5) return true; // IDR
            }
        }
    }
    return false;
}
