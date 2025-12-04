import React, { memo } from 'react';
import { Device } from '@/types/device';
import { ScreenView } from './ScreenView';
import { Maximize2 } from 'lucide-react';
import { cn } from '@/utils/helpers';

interface DeviceCardProps {
    device: Device;
    isSelected: boolean;
    onSelect: () => void;
    onExpand: () => void; // Hàm callback khi bấm nút phóng to
}

// Sử dụng memo để tối ưu re-render
export const DeviceCard: React.FC<DeviceCardProps> = memo(({ device, isSelected, onSelect, onExpand }) => {
    // Logic chọn thiết bị khi click vào header (giữ nguyên)
    const handleHeaderClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        onSelect();
    };

    const isOnline = device.status === 'online';

    return (
        <div
            className={cn(
                'bg-gray-800 rounded-lg overflow-hidden border-2 transition-all relative group',
                isSelected ? 'border-blue-500' : 'border-transparent hover:border-gray-600'
            )}
        >
            {/* Header: Tên máy và Trạng thái */}
            <div
                className="bg-gray-900 p-2 flex justify-between items-center cursor-pointer"
                onClick={handleHeaderClick}
            >
                <div className="flex items-center space-x-2 overflow-hidden">
                    <input type="checkbox" checked={isSelected} readOnly className="rounded" />
                    <span className="text-sm font-medium text-white truncate" title={device.id}>
                        {device.name || device.id}
                    </span>
                </div>
                <div className="flex items-center">
                     {/* Nút Phóng to (Kính lúp) */}
                     <button
                        onClick={(e) => {
                            e.stopPropagation(); // Ngăn chọn card khi bấm nút này
                            onExpand();
                        }}
                        className="p-1 text-gray-400 hover:text-white hover:bg-gray-700 rounded focus:outline-none"
                        title="Phóng to"
                    >
                        <Maximize2 size={16} />
                    </button>
                    <span className={cn("ml-2 w-2 h-2 rounded-full", isOnline ? "bg-green-500" : "bg-red-500")} />
                </div>
            </div>

            {/* Body: Màn hình điều khiển (ScreenView) */}
            {/* Ở Grid View, ta dùng bitrate thấp/độ phân giải thấp để tối ưu hiệu năng */}
            <div className="aspect-[9/16] bg-black relative">
                {isOnline ? (
                    <ScreenView
                        device={device}
                        className="w-full h-full cursor-crosshair" // Con trỏ chuột dạng + để dễ điều khiển
                    />
                ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-sm">
                        Offline
                    </div>
                )}
                
                {/* Overlay thông tin thêm (nếu cần) */}
                {device.resolution && (
                    <div className="absolute bottom-1 right-1 text-xs text-gray-400 bg-black/50 px-1 rounded">
                        {device.resolution.split('x')[0]}p
                    </div>
                )}
            </div>
        </div>
    );
});

DeviceCard.displayName = 'DeviceCard';
