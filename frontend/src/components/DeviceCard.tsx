import React, { memo, useState, useRef, useEffect } from 'react';
import { Device } from '@/types/device';
import { ScreenView } from './ScreenView';
import { Search } from 'lucide-react';
import { cn } from '@/utils/helpers';
import { useAppStore } from '@/store/useAppStore';

interface DeviceCardProps {
    device: Device;
    isSelected: boolean;
    onSelect: () => void;
    onExpand: () => void;
}

export const DeviceCard: React.FC<DeviceCardProps> = memo(({ device, isSelected, onSelect, onExpand }) => {
    const { expandedDeviceId } = useAppStore();
    const isExpanded = expandedDeviceId === device.id;
    
    const btnRef = useRef<HTMLButtonElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [btnPos, setBtnPos] = useState({ x: 10, y: 10 });
    const isDraggingBtn = useRef(false);

    const handleMouseDownBtn = (e: React.MouseEvent) => {
        e.stopPropagation();
        isDraggingBtn.current = true;
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDraggingBtn.current || !containerRef.current) return;
            const rect = containerRef.current.getBoundingClientRect();
            let newX = e.clientX - rect.left - 15;
            let newY = e.clientY - rect.top - 15;
            newX = Math.max(0, Math.min(newX, rect.width - 30));
            newY = Math.max(0, Math.min(newY, rect.height - 30));
            setBtnPos({ x: newX, y: newY });
        };

        const handleMouseUp = () => {
            if (!isDraggingBtn.current || !containerRef.current) return;
            isDraggingBtn.current = false;
            const rect = containerRef.current.getBoundingClientRect();
            const mid = rect.width / 2;
            setBtnPos(prev => ({
                x: prev.x < mid ? 2 : rect.width - 32,
                y: prev.y
            }));
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, []);

    return (
        <div
            ref={containerRef}
            className={cn(
                'relative bg-gray-900 rounded-sm overflow-hidden border-2 transition-all group', // Class 'group' để xử lý hover
                isSelected ? 'border-blue-500' : 'border-gray-700 hover:border-gray-500'
            )}
            onClick={onSelect}
        >
            <div className="w-full h-full aspect-[9/16] bg-black relative">
                {device.status === 'online' ? (
                    <ScreenView
                        device={device}
                        className="w-full h-full"
                        interactive={true}
                        active={!isExpanded} 
                    />
                ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-xs">Offline</div>
                )}

                {isExpanded && (
                    <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-10 pointer-events-none border-2 border-yellow-500/50">
                        <span className="text-yellow-500 font-bold text-sm animate-pulse px-2 py-1 bg-black/40 rounded">
                            Đang điều khiển
                        </span>
                    </div>
                )}

                <div className="absolute bottom-0 left-0 right-0 bg-black/40 backdrop-blur-[2px] p-1 text-[10px] text-white/80 truncate text-center pointer-events-none">
                    {device.name || device.adb_device_id}
                </div>
            </div>

            {/* Kính lúp: opacity-0 mặc định, group-hover:opacity-100 khi rê chuột vào card */}
            {device.status === 'online' && !isExpanded && (
                <button
                    ref={btnRef}
                    onMouseDown={handleMouseDownBtn}
                    onClick={(e) => { e.stopPropagation(); if (!isDraggingBtn.current) onExpand(); }}
                    style={{ top: btnPos.y, left: btnPos.x, position: 'absolute' }}
                    className="z-20 w-8 h-8 flex items-center justify-center bg-gray-800/90 hover:bg-blue-600 text-white rounded-full shadow-lg border border-white/20 transition-all cursor-grab active:cursor-grabbing opacity-0 group-hover:opacity-100 scale-90 hover:scale-100"
                    title="Phóng to"
                >
                    <Search size={16} />
                </button>
            )}
        </div>
    );
});

DeviceCard.displayName = 'DeviceCard';
