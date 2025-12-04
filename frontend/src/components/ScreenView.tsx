import React, { useRef, useEffect, useState } from 'react';
import { Device } from '@/types/device';
import { deviceService } from '@/services/deviceService';
import { cn } from '@/utils/helpers';
import { Maximize2, Minimize2 } from 'lucide-react';

interface ScreenViewProps {
    device: Device;
    onTap?: (x: number, y: number) => void;
}

export const ScreenView: React.FC<ScreenViewProps> = ({ device, onTap }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [scale, setScale] = useState(1);

    // Update canvas with device frame
    useEffect(() => {
        if (!device.frame || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const img = new Image();
        img.onload = () => {
            canvas.width = img.width;
            canvas.height = img.height;
            ctx.drawImage(img, 0, 0);
        };
        img.src = `data:image/png;base64,${device.frame}`;
    }, [device.frame]);

    // Calculate scale for responsive display
    useEffect(() => {
        const updateScale = () => {
            if (!containerRef.current || !canvasRef.current) return;

            const container = containerRef.current;
            const canvas = canvasRef.current;

            const scaleX = container.clientWidth / canvas.width;
            const scaleY = container.clientHeight / canvas.height;
            setScale(Math.min(scaleX, scaleY, 1));
        };

        updateScale();
        window.addEventListener('resize', updateScale);
        return () => window.removeEventListener('resize', updateScale);
    }, [device.frame]);

    const handleClick = async (e: React.MouseEvent<HTMLCanvasElement>) => {
        if (!canvasRef.current) return;

        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();

        // Calculate actual coordinates on device
        const x = Math.round((e.clientX - rect.left) / scale);
        const y = Math.round((e.clientY - rect.top) / scale);

        // Execute tap
        try {
            await deviceService.tap(device.id, x, y);
            if (onTap) onTap(x, y);
        } catch (error) {
            console.error('Failed to execute tap:', error);
        }
    };

    const toggleFullscreen = () => {
        if (!containerRef.current) return;

        if (!document.fullscreenElement) {
            containerRef.current.requestFullscreen();
            setIsFullscreen(true);
        } else {
            document.exitFullscreen();
            setIsFullscreen(false);
        }
    };

    return (
        <div
            ref={containerRef}
            className={cn(
                'relative flex items-center justify-center bg-black rounded-lg overflow-hidden',
                isFullscreen ? 'fixed inset-0 z-50' : 'aspect-[9/16] max-h-[600px]'
            )}
        >
            {/* Fullscreen toggle button */}
            <button
                onClick={toggleFullscreen}
                className="absolute top-2 right-2 z-10 p-2 bg-black/50 hover:bg-black/70 rounded-md transition-colors"
            >
                {isFullscreen ? (
                    <Minimize2 className="w-5 h-5 text-white" />
                ) : (
                    <Maximize2 className="w-5 h-5 text-white" />
                )}
            </button>

            {/* Canvas for screen display */}
            <canvas
                ref={canvasRef}
                onClick={handleClick}
                style={{
                    transform: `scale(${scale})`,
                    transformOrigin: 'center center',
                    cursor: 'crosshair',
                }}
                className="max-w-full max-h-full"
            />

            {/* No frame placeholder */}
            {!device.frame && (
                <div className="absolute inset-0 flex items-center justify-center text-gray-500">
                    <p>Waiting for screen data...</p>
                </div>
            )}
        </div>
    );
};
