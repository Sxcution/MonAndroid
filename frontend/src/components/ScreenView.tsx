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

    // Handle WebSocket messages (H.264 binary NAL units)
    useEffect(() => {
        if (!lastMessage || !decoderRef.current) return;

        // Binary H.264 NAL unit
        if (lastMessage instanceof ArrayBuffer) {
            const buf = new Uint8Array(lastMessage);

            // Parse length-prefix: [4 bytes big-endian][NAL data]
            if (buf.byteLength < 4) return;

            const len = (buf[0] << 24) | (buf[1] << 16) | (buf[2] << 8) | buf[3];
            if (len <= 0 || 4 + len > buf.byteLength) {
                console.warn('⚠️ Invalid NAL length:', len, 'total:', buf.byteLength);
                return;
            }

            const nalUnit = buf.subarray(4, 4 + len);
            console.log(`📦 Received NAL unit: ${len} bytes`);
            const decoder = decoderRef.current;

            // Extract NAL type from this individual NAL unit
            const nalType = getNALType(nalUnit);

            // Handle SPS (type 7)
            if (nalType === 7) {
                console.log('🔍 Found SPS NAL (type 7)');
                spsRef.current = nalUnit;
            }
            // Handle PPS (type 8)
            else if (nalType === 8) {
                console.log('🔍 Found PPS NAL (type 8)');
                ppsRef.current = nalUnit;
            }

            // Configure decoder if we have both SPS and PPS
            if (decoder.state === 'unconfigured' && spsRef.current && ppsRef.current) {
                console.log('✅ Configuring decoder with SPS and PPS');
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
                console.log('✅ Decoder configured successfully!', {
                    spsLen: sps.length,
                    ppsLen: pps.length
                });
            }

            // Skip if decoder not ready
            if (decoder.state !== 'configured') return;

            // Only decode video frames (IDR type 5 or Slice type 1)
            if (nalType !== 5 && nalType !== 1) return;

            console.log(`🎬 Decoding frame (NAL type ${nalType})`);

            // Backpressure: skip frame if decoder queue is full
            if (decoder.decodeQueueSize > 4) {
                return; // Drop frame to keep latency low
            }

            // Detect IDR frame (key frame)
            const type: 'key' | 'delta' = nalType === 5 ? 'key' : 'delta';

            try {
                const chunk = new EncodedVideoChunk({
                    type,
                    timestamp: performance.now() * 1000, // microseconds
                    data: nalUnit
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

// Helper: Get NAL type from an individual NAL unit
function getNALType(nalUnit: Uint8Array): number {
    // Find start code
    let offset = 0;
    if (nalUnit.length >= 4 && nalUnit[0] === 0 && nalUnit[1] === 0) {
        if (nalUnit[2] === 1) {
            offset = 3; // 00 00 01
        } else if (nalUnit[2] === 0 && nalUnit[3] === 1) {
            offset = 4; // 00 00 00 01
        }
    }

    if (offset > 0 && offset < nalUnit.length) {
        return nalUnit[offset] & 0x1F;
    }

    return -1; // Invalid
}
