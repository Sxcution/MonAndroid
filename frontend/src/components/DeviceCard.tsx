import React, { memo, useState, useRef, useEffect } from 'react';
import { Device } from '@/types/device';
import { ScreenView } from './ScreenView';
import { Search } from 'lucide-react'; // Dùng icon kính lúp
import { cn } from '@/utils/helpers';
import { useAppStore } from '@/store/useAppStore';
import { useSettingsStore } from '@/store/useSettingsStore';

interface DeviceCardProps {
    device: Device | null; // ✅ Now accepts null for disconnected slots
    slotIndex: number; // ✅ Stable slot index for identification
    isSelected: boolean;
    onSelect: () => void;
    onExpand: () => void;
}

export const DeviceCard: React.FC<DeviceCardProps> = memo(({ device, slotIndex, isSelected, onSelect, onExpand }) => {
    const { expandedDeviceId, expandButtonPosition, setExpandButtonPosition } = useAppStore();
    const { showDeviceName } = useSettingsStore();
    const isExpanded = device ? expandedDeviceId === device.id : false;
    const [isHovered, setIsHovered] = useState(false);

    // Kéo thả button - SỬ DỤNG VỊ TRÍ GLOBAL
    const btnRef = useRef<HTMLButtonElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const isDraggingBtn = useRef(false);
    const dragStartPos = useRef({ x: 0, y: 0 }); // Track drag start position
    const hasDragged = useRef(false); // Track if actually dragged

    const handleMouseDownBtn = (e: React.MouseEvent) => {
        e.stopPropagation();
        isDraggingBtn.current = true;
        hasDragged.current = false; // Reset drag flag
        dragStartPos.current = { x: e.clientX, y: e.clientY }; // Save start position
    };

    // Xử lý kéo thả - CẬP NHẬT GLOBAL POSITION
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDraggingBtn.current || !containerRef.current) return;

            // Check if moved more than 5px (drag threshold)
            const deltaX = Math.abs(e.clientX - dragStartPos.current.x);
            const deltaY = Math.abs(e.clientY - dragStartPos.current.y);
            if (deltaX > 5 || deltaY > 5) {
                hasDragged.current = true; // Mark as dragged
            }

            const rect = containerRef.current.getBoundingClientRect();
            let newX = e.clientX - rect.left - 15;
            let newY = e.clientY - rect.top - 15;

            newX = Math.max(0, Math.min(newX, rect.width - 30));
            newY = Math.max(0, Math.min(newY, rect.height - 30));

            setExpandButtonPosition({ x: newX, y: newY }); // CẬP NHẬT GLOBAL
        };

        const handleMouseUp = () => {
            isDraggingBtn.current = false;
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
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            className={cn(
                'relative bg-gray-900 rounded-sm overflow-hidden border-2 transition-all group aspect-[9/16]',
                // Border màu xanh nếu được chọn, xám nếu chưa kết nối
                !device ? 'border-gray-800' :
                    isSelected ? 'border-blue-500' : 'border-gray-700 hover:border-gray-500'
            )}
            onClick={device ? onSelect : undefined}
        >
            {/* ScreenView Full Ô - ABSOLUTE INSET */}
            <div className="absolute inset-0">
                {device && device.status === 'online' ? (
                    <ScreenView
                        device={device}
                        className="w-full h-full"
                        interactive={true}
                    />
                ) : (
                    // ✅ Hiển thị "Chưa kết nối" cho null hoặc offline
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 text-xs gap-2">
                        <div className="text-6xl font-bold text-gray-800">
                            {String(slotIndex + 1).padStart(2, '0')}
                        </div>
                        <div className="text-sm text-gray-600">
                            {device ? 'Offline' : 'Chưa kết nối'}
                        </div>
                    </div>
                )}

                {/* Overlay khi đang phóng to (Expanded) */}
                {isExpanded && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-10 pointer-events-none border-2 border-yellow-500/50">
                        <span className="text-yellow-500 font-bold text-sm animate-pulse px-2 py-1 bg-black/40 rounded">
                            Đang điều khiển
                        </span>
                    </div>
                )}

                {/* Thông tin tên máy nhỏ ở đáy (nếu cần nhận biết) */}
                {showDeviceName && device && (
                    <div className="absolute bottom-0 left-0 right-0 bg-black/40 backdrop-blur-[2px] p-1 text-[10px] text-white/80 truncate text-center pointer-events-none">
                        {device.name || device.adb_device_id}
                    </div>
                )}
            </div>

            {/* Nút Kính Lúp Draggable - CHỈ HIỆN KHI HOVER */}
            {device && device.status === 'online' && isHovered && (
                <button
                    ref={btnRef}
                    onMouseDown={handleMouseDownBtn}
                    onClick={(e) => {
                        e.stopPropagation();
                        // CHỈ expand nếu KHÔNG kéo (click thật)
                        if (!hasDragged.current) {
                            onExpand();
                        }
                    }}
                    style={{
                        top: `${expandButtonPosition.y}px`,
                        left: `${expandButtonPosition.x}px`,
                        position: 'absolute',
                    }}
                    // Scale 80% (giảm 20%), hình tròn, kính lúp
                    className="z-20 w-8 h-8 flex items-center justify-center bg-gray-800/80 hover:bg-blue-600 text-white rounded-full shadow-lg backdrop-blur-sm border border-white/10 transition-colors cursor-grab active:cursor-grabbing transform scale-90"
                    title="Phóng to"
                >
                    <Search size={14} />
                </button>
            )}
        </div>
    );
});

DeviceCard.displayName = 'DeviceCard';
