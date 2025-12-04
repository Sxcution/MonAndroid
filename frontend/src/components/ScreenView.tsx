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
            {/* No frame placeholder */ }
            {
                !device.frame && (
                    <div className="absolute inset-0 flex items-center justify-center text-gray-500">
                        <p>Waiting for screen data...</p>
                    </div>
                )
            }
        </div >
    );
};
