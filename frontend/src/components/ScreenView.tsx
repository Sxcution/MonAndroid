import React, { useRef, useEffect, useState } from 'react';
import { Maximize2, Minimize2 } from 'lucide-react';
import { cn } from '@/utils/helpers';
import { deviceService } from '@/services/deviceService';
import { Device } from '@/types/device';
import { useWebSocket } from '@/services/websocket';
import axios from 'axios';

const API_BASE_URL = 'http://localhost:8080/api';

interface ScreenViewProps {
    device: Device;
    className?: string;
}

export const ScreenView: React.FC<ScreenViewProps> = ({ device, className }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
    const [fps, setFps] = useState(0);
    const [latency, setLatency] = useState(0);
    const { lastMessage, sendMessage, isConnected } = useWebSocket();

    useEffect(() => {
        // Parse device resolution (e.g., "1080x1920")
        console.log('🔍 Device resolution:', device.resolution);
        console.log('🔍 Resolution type:', typeof device.resolution);
        if (device.resolution) {
            // Extract just the resolution part (e.g., "1080x1920" from "1080x1920 Override size")
            const resolutionMatch = device.resolution.match(/(\d+)x(\d+)/);
            console.log('🔍 Resolution match:', resolutionMatch);
            if (resolutionMatch) {
                const width = parseInt(resolutionMatch[1]);
                const height = parseInt(resolutionMatch[2]);
                console.log('🔍 Parsed dimensions:', { width, height });
                if (width && height) {
                    // Scale down for display
                    const scale = 0.4;
                    const scaledDims = { width: width * scale, height: height * scale };
                    console.log('📐 Setting canvas dimensions:', scaledDims);
                    setDimensions(scaledDims);
                } else {
                    console.error('❌ Width or height is 0:', { width, height });
                }
            } else {
                console.error('❌ Failed to match resolution pattern:', device.resolution);
            }
        } else {
            console.warn('⚠️ No device resolution available!');
        }
    }, [device.resolution]);

    // Failsafe: Manually update canvas dimensions when state changes
    useEffect(() => {
        if (canvasRef.current && dimensions.width > 0 && dimensions.height > 0) {
            console.log('🔧 Manually setting canvas dimensions:', dimensions);
            canvasRef.current.width = dimensions.width;
            canvasRef.current.height = dimensions.height;
        }
    }, [dimensions]);

    // Start streaming when WebSocket is connected
    useEffect(() => {
        if (!isConnected) {
            console.log('⏳ Waiting for WebSocket connection...');
            return;
        }

        const startStreaming = async () => {
            try {
                console.log('✅ WebSocket connected! Starting streaming for:', device.id);

                // Subscribe FIRST
                sendMessage({
                    type: 'subscribe',
                    device_id: device.id
                });
                console.log('📨 Sent subscribe message');

                // Then start backend streaming
                await axios.post(`${API_BASE_URL}/streaming/start/${device.id}`);
                console.log('🎬 Backend streaming started');
            } catch (error) {
                console.error('❌ Failed to start streaming:', error);
            }
        };

        startStreaming();

        // Cleanup
        return () => {
            console.log('🛑 Stopping streaming for:', device.id);
            axios.post(`${API_BASE_URL}/streaming/stop/${device.id}`).catch(console.error);
            sendMessage({
                type: 'unsubscribe',
                device_id: device.id
            });
        };
    }, [device.id, sendMessage, isConnected]);

    // Handle WebSocket messages (screen frames)
    useEffect(() => {
        if (!lastMessage || !canvasRef.current) {
            if (!lastMessage) console.log('⏸️ No lastMessage');
            if (!canvasRef.current) console.log('⏸️ No canvas ref');
            return;
        }

        try {
            const data = JSON.parse(lastMessage);

            if (data.type === 'screen_frame' && data.device_id === device.id) {
                const canvas = canvasRef.current;
                const ctx = canvas.getContext('2d');

                if (!ctx) {
                    console.error('❌ Failed to get canvas context!');
                    return;
                }

                // Update FPS and latency
                if (data.fps) setFps(data.fps);
                if (data.capture_ms) setLatency(data.capture_ms);

                // Check for empty frame data
                if (!data.frame || data.frame.length === 0) {
                    console.error('❌ Empty frame data!');
                    return;
                }

                // Log only every 30 frames to reduce console spam
                if (data.frame_count % 30 === 0) {
                    console.log(`📺 Frame: ${data.frame_count}, FPS: ${data.fps}, Canvas: ${canvas.width}x${canvas.height}`);
                }

                // Create image from base64
                const img = new Image();
                img.onload = () => {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                };
                img.onerror = (err) => {
                    console.error('❌ Image load error:', err, 'Frame:', data.frame_count);
                };

                img.src = `data:image/png;base64,${data.frame}`;
            }
        } catch (error) {
            console.error('❌ Failed to process screen frame:', error);
        }
    }, [lastMessage, device.id]);

    const handleCanvasClick = async (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!canvasRef.current) return;

        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();

        // Calculate click position relative to original device resolution
        const [origWidth, origHeight] = device.resolution.split('x').map(Number);
        const x = Math.floor((e.clientX - rect.left) / rect.width * origWidth);
        const y = Math.floor((e.clientY - rect.top) / rect.height * origHeight);

        // Send tap command
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
                    {fps} FPS • {latency}ms
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
                        <p>{isConnected ? 'Starting stream...' : 'Connecting...'}</p>
                    </div>
                </div>
            )}
        </div>
    );
};
