import React from 'react';
import { useAppStore } from '@/store/useAppStore';
import { DeviceCard } from './DeviceCard';
import { Loader2 } from 'lucide-react';

export const DeviceGrid: React.FC = () => {
    const {
        selectedDevices,
        toggleDeviceSelection,
        setExpandedDevice,
        getDevicesBySlot,
    } = useAppStore();

    // ✅ Get devices sorted by stable slot positions (includes null for disconnected)
    const deviceSlots = getDevicesBySlot();

    if (deviceSlots.length === 0) {
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
        <div className="p-4 overflow-y-auto h-full bg-gray-950">
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
                {deviceSlots.map((device, slotIndex) => (
                    <DeviceCard
                        key={`slot-${slotIndex}`}
                        device={device}
                        slotIndex={slotIndex}
                        isSelected={device ? selectedDevices.includes(device.id) : false}
                        onSelect={() => device && toggleDeviceSelection(device.id)}
                        onExpand={() => device && setExpandedDevice(device.id)}
                    />
                ))}
            </div>
        </div>
    );
};
