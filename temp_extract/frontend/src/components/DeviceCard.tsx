import React from 'react';
import { Device } from '@/types/device';
import { cn, formatBattery, getBatteryColor, getStatusColor } from '@/utils/helpers';
import { Battery, Wifi, WifiOff } from 'lucide-react';
import { ScreenView } from './ScreenView';

interface DeviceCardProps {
    device: Device;
    isSelected?: boolean;
    onSelect?: () => void;
    onClick?: () => void;
}

export const DeviceCard: React.FC<DeviceCardProps> = ({
    device,
    isSelected = false,
    onSelect,
    onClick,
}) => {
    const isOnline = device.status === 'online';

    return (
        <div
            className={cn(
                'relative group rounded-lg border-2 p-4 transition-all duration-200 cursor-pointer',
                'hover:shadow-lg hover:scale-105',
                isSelected ? 'border-primary bg-primary/5' : 'border-border bg-card',
                !isOnline && 'opacity-60'
            )}
            onClick={onClick}
        >
            {/* Selection checkbox */}
            {onSelect && (
                <div
                    className="absolute top-2 right-2 z-10"
                    onClick={(e) => {
                        e.stopPropagation();
                        onSelect();
                    }}
                >
                    <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => { }}
                        className="w-5 h-5 cursor-pointer"
                    />
                </div>
            )}

            {/* Live screen streaming */}
            <div className="aspect-[9/16] bg-black rounded-md mb-3 overflow-hidden">
                <ScreenView device={device} className="w-full h-full" />
            </div>

            {/* Device info */}
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <h3 className="font-semibold truncate">{device.name}</h3>
                    <div className={cn('flex items-center gap-1', getStatusColor(device.status))}>
                        {isOnline ? <Wifi size={16} /> : <WifiOff size={16} />}
                    </div>
                </div>

                <div className="text-sm text-muted-foreground space-y-1">
                    <div className="flex items-center justify-between">
                        <span>Model:</span>
                        <span className="truncate ml-2">{device.adb_device_id.slice(0, 12)}...</span>
                    </div>

                    <div className="flex items-center justify-between">
                        <span>Android:</span>
                        <span>{device.android_version}</span>
                    </div>

                    <div className="flex items-center justify-between">
                        <span>Resolution:</span>
                        <span>{device.resolution}</span>
                    </div>

                    <div className="flex items-center justify-between">
                        <span>Battery:</span>
                        <div className={cn('flex items-center gap-1', getBatteryColor(device.battery))}>
                            <Battery size={14} />
                            <span>{formatBattery(device.battery)}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Online indicator */}
            <div
                className={cn(
                    'absolute bottom-2 left-2 w-2 h-2 rounded-full',
                    isOnline ? 'bg-green-500 animate-pulse' : 'bg-gray-400'
                )}
            />
        </div>
    );
};
