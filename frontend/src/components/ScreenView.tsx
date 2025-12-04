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
    const { lastMessage, sendMessage } = useWebSocket();

    useEffect(() => {
        // Parse device resolution (e.g., "1080x1920")
        if (device.resolution) {
            const [width, height] = device.resolution.split('x').map(Number);
            if (width && height) {
                // Scale down for display
                const scale = 0.4;
                setDimensions({ width: width * scale, height: height * scale });
            }
        }
    }, [device.resolution]);

    // Start streaming when component mounts
    useEffect(() => {
        const startStreaming = async () => {
            try {
                await axios.post(`${API_BASE_URL}/streaming/start/${device.id}`);
                console.log('Started streaming for device:', device.id);

                // Subscribe to this device's frames
                sendMessage({
                    type: 'subscribe',
                    device_id: device.id
                });
            } catch (error) {
                console.error('Failed to start streaming:', error);
            }
        };

        startStreaming();

        // Cleanup: stop streaming when unmounting
        return () => {
            axios.post(`${API_BASE_URL}/streaming/stop/${device.id}`).catch(console.error);
            sendMessage({
                type: 'unsubscribe',
                device_id: device.id
            });
        };
    }, [device.id, sendMessage]);

    // Handle WebSocket messages (screen frames)
    useEffect(() => {
        if (!lastMessage || !canvasRef.current) return;

        try {
            const data = JSON.parse(lastMessage);

            if (data.type === 'screen_frame' && data.device_id === device.id) {
                const canvas = canvasRef.current;
                const ctx = canvas.getContext('2d');
                if (!ctx) return;

                // Update FPS and latency
                if (data.fps) setFps(data.fps);
                if (data.capture_ms) setLatency(data.capture_ms);

                // Create image from base64
                const img = new Image();
                img.onload = () => {
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                };
                img.src = `data:image/png;base64,${data.frame}`;
            }
        } catch (error) {
            console.error('Failed to process screen frame:', error);
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
                        <p>Starting stream...</p>
                    </div>
                </div>
            )}
        </div>
    );
};
