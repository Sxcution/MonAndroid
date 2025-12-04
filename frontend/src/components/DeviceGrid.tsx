import React from 'react';
import { useAppStore } from '@/store/useAppStore';
import { DeviceCard } from './DeviceCard';
import { Loader2 } from 'lucide-react';

export const DeviceGrid: React.FC = () => {
    const {
        devices,
        selectedDevices,
        toggleDeviceSelection,
        selectDevice,
    } = useAppStore();

    // ✅ Hiển thị tất cả thiết bị (bỏ giới hạn slice)
    const displayDevices = devices;

    if (displayDevices.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center">
                <Loader2 className="w-12 h-12 animate-spin text-primary mb-4" />
                <h2 className="text-xl font-semibold mb-2">No devices found</h2>
                <p className="text-muted-foreground">
                    Connect your Android devices via USB and click "Scan Devices"
                </p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4 p-4">
            {displayDevices.map((device) => (
                <DeviceCard
                    key={device.id}
                    device={device}
                    isSelected={selectedDevices.includes(device.id)}
                    onSelect={() => toggleDeviceSelection(device.id)}
                    onClick={() => selectDevice(device.id)}
                />
            ))}
        </div>
    );
};
