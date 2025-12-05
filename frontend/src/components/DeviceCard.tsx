import React, { memo, useState, useRef, useEffect } from 'react';
import { Device } from '@/types/device';
import { ScreenView } from './ScreenView';
import { Search } from 'lucide-react'; // Dùng icon kính lúp
import { cn } from '@/utils/helpers';
import { useAppStore } from '@/store/useAppStore';

interface DeviceCardProps {
    device: Device | null; // ✅ Now accepts null for disconnected slots
    slotIndex: number; // ✅ Stable slot index for identification
    isSelected: boolean;
    onSelect: () => void;
    onExpand: () => void;
}

export const DeviceCard: React.FC<DeviceCardProps> = memo(({ device, slotIndex, isSelected, onSelect, onExpand }) => {
    const { expandedDeviceId } = useAppStore();
    const isExpanded = device ? expandedDeviceId === device.id : false;

    // Logic kéo thả nút kính lúp
    const btnRef = useRef<HTMLButtonElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [btnPos, setBtnPos] = useState({ x: 0, y: 0 }); // Start at top-left or customized
    const isDraggingBtn = useRef(false);

    const handleMouseDownBtn = (e: React.MouseEvent) => {
        e.stopPropagation();
        isDraggingBtn.current = true;
    };

    // Xử lý kéo thả nút và dính biên (Snap)
    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDraggingBtn.current || !containerRef.current) return;
            const rect = containerRef.current.getBoundingClientRect();
            // Tính vị trí tương đối trong card
            let newX = e.clientX - rect.left - 15; // 15 là nửa width button
            let newY = e.clientY - rect.top - 15;

            // Giới hạn trong khung
            newX = Math.max(0, Math.min(newX, rect.width - 30));
            newY = Math.max(0, Math.min(newY, rect.height - 30));

            setBtnPos({ x: newX, y: newY });
        };

        const handleMouseUp = () => {
            if (!isDraggingBtn.current || !containerRef.current) return;
            isDraggingBtn.current = false;

            // Snap logic: Dính trái hoặc phải
            const rect = containerRef.current.getBoundingClientRect();
            const mid = rect.width / 2;

            setBtnPos(prev => ({
                x: prev.x < mid ? 2 : rect.width - 32, // 32 là size button + margin
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
                'relative bg-gray-900 rounded-sm overflow-hidden border-2 transition-all group',
                // Border màu xanh nếu được chọn, xám nếu chưa kết nối
                !device ? 'border-gray-800' :
                    isSelected ? 'border-blue-500' : 'border-gray-700 hover:border-gray-500'
            )}
            onClick={device ? onSelect : undefined}
        >
            {/* ScreenView Full Ô */}
            <div className="w-full h-full aspect-[9/16] bg-black relative">
                {device && device.status === 'online' ? (
                    <ScreenView
                        device={device}
                        className="w-full h-full"
                        interactive={true} // Cho phép click thẳng vào đây
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
                {device && (
                    <div className="absolute bottom-0 left-0 right-0 bg-black/40 backdrop-blur-[2px] p-1 text-[10px] text-white/80 truncate text-center pointer-events-none">
                        {device.name || device.adb_device_id}
                    </div>
                )}
            </div>

            {/* Nút Kính Lúp Draggable - Chỉ hiển thị khi device online */}
            {device && device.status === 'online' && (
                <button
                    ref={btnRef}
                    onMouseDown={handleMouseDownBtn}
                    onClick={(e) => {
                        e.stopPropagation();
                        // Chỉ expand nếu không phải đang kéo
                        if (!isDraggingBtn.current) onExpand();
                    }}
                    style={{
                        top: btnPos.y,
                        left: btnPos.x,
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
