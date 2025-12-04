import React from 'react';
import { Device } from '@/types/device';
import { ScreenView } from './ScreenView';
import {
    X, ArrowLeft, Circle, Square, Power, Volume2, VolumeX,
    Keyboard
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

    if (!device) {
        return <div className="text-white">Device not found.</div>;
    }

    const handleClose = () => setExpandedDevice(null);

    // Các hành động điều khiển nhanh
    const actions = [
        { icon: ArrowLeft, label: 'Back', onClick: () => deviceService.sendKey(device.id, 4) },
        { icon: Circle, label: 'Home', onClick: () => deviceService.sendKey(device.id, 3) },
        { icon: Square, label: 'Recent', onClick: () => deviceService.sendKey(device.id, 187) },
        { icon: Power, label: 'Power', onClick: () => deviceService.sendKey(device.id, 26), className: 'text-red-500 hover:bg-red-900/50' },
        { icon: VolumeX, label: 'Vol Down', onClick: () => deviceService.sendKey(device.id, 25) },
        { icon: Volume2, label: 'Vol Up', onClick: () => deviceService.sendKey(device.id, 24) },
    ];

    return (
        <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            {/* Container chính: Chia 2 cột */}
            <div className="bg-gray-900 rounded-xl overflow-hidden shadow-2xl flex w-full max-w-6xl h-[90vh] border border-gray-700">
                
                {/* Cột Trái: Màn hình điện thoại (Lớn) */}
                <div className="flex-1 bg-black relative flex items-center justify-center p-2">
                    {/* Nút đóng ở góc */}
                    <button
                        onClick={handleClose}
                        className="absolute top-2 left-2 p-2 bg-gray-800/50 hover:bg-gray-700 rounded-full text-white z-10"
                        title="Đóng"
                    >
                        <X size={20} />
                    </button>
                    
                    <div className="h-full w-auto aspect-[9/16] relative shadow-lg">
                        <ScreenView
                            device={device}
                            className="w-full h-full rounded-lg border-2 border-gray-800"
                        />
                    </div>
                </div>

                {/* Cột Phải: Menu điều khiển dọc */}
                <div className="w-16 bg-gray-800 border-l border-gray-700 flex flex-col items-center py-4 space-y-4 overflow-y-auto scrollbar-hide">
                    {/* Info Thiết bị */}
                    <div className="text-xs text-gray-400 text-center px-1 mb-4" title={device.id}>
                        {device.name?.slice(0, 5) || device.id.slice(0, 5) || 'Dev..'}
                    </div>

                    {/* Danh sách nút bấm */}
                    {actions.map((action, index) => (
                        <button
                            key={index}
                            onClick={action.onClick}
                            className={cn(
                                "p-3 rounded-lg text-gray-300 hover:text-white hover:bg-gray-700 transition-colors relative group",
                                action.className
                            )}
                            title={action.label}
                        >
                            <action.icon size={24} />
                            {/* Tooltip (hiện khi hover) */}
                            <span className="absolute left-full ml-2 px-2 py-1 bg-gray-900 text-white text-xs rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-20">
                                {action.label}
                            </span>
                        </button>
                    ))}
                    
                    {/* Khoảng trống co giãn */}
                    <div className="flex-1"></div>

                    {/* Các nút chức năng khác ở dưới cùng */}
                    <button className="p-3 text-gray-300 hover:text-white hover:bg-gray-700 rounded-lg" title="Settings">
                        <Keyboard size={24}/>
                    </button>
                </div>
            </div>
        </div>
    );
};

