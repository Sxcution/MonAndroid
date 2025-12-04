import React, { useState, useEffect, useRef } from 'react';
import { Device } from '@/types/device';
import { ScreenView } from './ScreenView';
import {
    X, ArrowLeft, Circle, Square, Power, Volume2, VolumeX,
    Keyboard, GripHorizontal
} from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { deviceService } from '@/services/deviceService';
import { cn } from '@/utils/helpers';

interface ExpandedDeviceViewProps {
    deviceId: string;
}

export const ExpandedDeviceView: React.FC<ExpandedDeviceViewProps> = ({ deviceId }) => {
    const { devices, setExpandedDevice } = useAppStore();
    const device = devices.find(d => d.id === deviceId);

    // Vị trí cửa sổ nổi
    const [position, setPosition] = useState({ x: 100, y: 50 });
    const windowRef = useRef<HTMLDivElement>(null);
    const dragHeaderRef = useRef<HTMLDivElement>(null);
    const isDragging = useRef(false);
    const dragOffset = useRef({ x: 0, y: 0 });

    if (!device) return null;

    // Logic kéo thả cửa sổ
    const handleMouseDown = (e: React.MouseEvent) => {
        if (windowRef.current) {
            isDragging.current = true;
            dragOffset.current = {
                x: e.clientX - windowRef.current.offsetLeft,
                y: e.clientY - windowRef.current.offsetTop
            };
        }
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isDragging.current) {
                setPosition({
                    x: e.clientX - dragOffset.current.x,
                    y: e.clientY - dragOffset.current.y
                });
            }
        };
        const handleMouseUp = () => {
            isDragging.current = false;
        };
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, []);

    const actions = [
        { icon: ArrowLeft, label: 'Back', onClick: () => deviceService.goBack(device.id) },
        { icon: Circle, label: 'Home', onClick: () => deviceService.goHome(device.id) },
        { icon: Square, label: 'Recent', onClick: () => deviceService.openMenu(device.id) },
        { icon: Power, label: 'Power', onClick: () => deviceService.pressKey(device.id, 26), className: 'text-red-400' },
        { icon: VolumeX, label: 'Vol-', onClick: () => deviceService.pressKey(device.id, 25) },
        { icon: Volume2, label: 'Vol+', onClick: () => deviceService.pressKey(device.id, 24) },
    ];

    return (
        // Không dùng inset-0 fixed overlay nữa để cho phép nhìn thấy grid phía sau
        <div 
            ref={windowRef}
            style={{ left: position.x, top: position.y }}
            className="fixed z-50 flex flex-row shadow-2xl border border-gray-600 rounded-lg overflow-hidden bg-gray-900 w-[400px] h-[700px] resize-y" // Kích thước cố định hoặc resize
        >
            {/* Thanh tiêu đề để kéo thả (Ở trên cùng hoặc viền) */}
            {/* Ở đây ta làm viền bao quanh để kéo */}
            <div 
                ref={dragHeaderRef}
                onMouseDown={handleMouseDown}
                className="absolute top-0 left-0 w-full h-8 bg-gray-800 flex items-center justify-between px-2 cursor-move z-20 hover:bg-gray-700"
            >
                <div className="flex items-center gap-2 text-xs text-gray-300">
                    <GripHorizontal size={14} />
                    <span className="font-bold">{device.name || device.id}</span>
                </div>
                <button 
                    onClick={() => setExpandedDevice(null)}
                    className="text-gray-400 hover:text-white"
                >
                    <X size={16} />
                </button>
            </div>

            {/* Nội dung chính (đẩy xuống dưới header 8px) */}
            <div className="flex flex-1 mt-8 w-full h-[calc(100%-32px)]">
                {/* Cột Màn hình (Trái) */}
                <div className="flex-1 bg-black relative">
                    <ScreenView 
                        device={device} 
                        className="w-full h-full" 
                        interactive={true}
                        active={true} // Đảm bảo Expanded View luôn active
                    />
                </div>

                {/* Cột Menu (Phải) */}
                <div className="w-12 bg-gray-800 border-l border-gray-700 flex flex-col items-center py-2 gap-2 overflow-y-auto no-scrollbar">
                    {actions.map((action, idx) => (
                        <button
                            key={idx}
                            onClick={action.onClick}
                            className={cn(
                                "p-2 rounded hover:bg-gray-600 text-gray-300 transition-colors",
                                action.className
                            )}
                            title={action.label}
                        >
                            <action.icon size={20} />
                        </button>
                    ))}
                    
                    <div className="flex-1" />
                    
                    <button className="p-2 rounded hover:bg-gray-600 text-gray-300">
                        <Keyboard size={20} />
                    </button>
                </div>
            </div>
        </div>
    );
};
