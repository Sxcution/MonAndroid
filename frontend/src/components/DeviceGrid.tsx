import React from 'react';
import { useAppStore } from '@/store/useAppStore';
import { DeviceCard } from './DeviceCard';
import { Loader2 } from 'lucide-react';

interface DeviceGridProps {
    dragHighlightedDevices?: string[];
    scanVersion?: number; // Increment to force ScreenView re-mount
}

export const DeviceGrid: React.FC<DeviceGridProps> = ({ dragHighlightedDevices = [], scanVersion = 0 }) => {
    const {
        selectedDevices,
        toggleDeviceSelection,
        setExpandedDevice,
        getDevicesBySlot,
    } = useAppStore();

    const deviceSlots = getDevicesBySlot();

    if (deviceSlots.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-gray-950">
                <Loader2 className="w-12 h-12 animate-spin text-blue-500 mb-4" />
                <h2 className="text-xl font-semibold mb-2 text-white">No devices found</h2>
                <p className="text-gray-400">
                    Hover on the left edge to open sidebar and scan devices
                </p>
            </div>
        );
    }

    return (
        <div className="w-full h-full p-2 overflow-y-auto bg-gray-950 scrollbar-hide">
            <div
                className="grid gap-1"
                style={{
                    gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
                }}
            >
                {deviceSlots.map((device, slotIndex) => (
                    <DeviceCard
                        // Use scanVersion in key to force ScreenView re-mount after scan
                        key={`slot-${slotIndex}-v${scanVersion}`}
                        device={device}
                        slotIndex={slotIndex}
                        isSelected={device ? selectedDevices.includes(device.id) : false}
                        isDragHighlighted={device ? dragHighlightedDevices.includes(device.id) : false}
                        onSelect={() => device && toggleDeviceSelection(device.id)}
                        onExpand={() => device && setExpandedDevice(device.id)}
                    />
                ))}
            </div>
        </div>
    );
};
