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
        clearDeviceSelection,
        setExpandedDevice,
        getDevicesBySlot,
        // Filters
        filterTag,
        filterUntagged,
        showSelectedOnly
    } = useAppStore();

    // Get all devices (including null for empty slots)
    const allSlots = getDevicesBySlot();

    // Apply filters to determine visibility
    // We want to KEEP the grid layout (slots), but just hide/show items?
    // OR do we want to filter the LIST?
    // Usually "Filter" means only show matching items.
    // If we use slots, filtering might leave gaps.
    // Let's assume we filter the visible items but keep them in their slots if possible,
    // OR we just map over them and filter out nulls/non-matches.

    // HOWEVER, `getDevicesBySlot` returns (Device | null)[].
    // If we filter, we might lose slot positioning visual if we just render the filtered list.
    // But specific requirement: "Checkbox 'Hiển thị tất cả': khi bật, hiển thị tất cả device trong grid."
    // implying that filtering REMOVES non-matching items from view.

    const visibleDevices = allSlots.filter(device => {
        if (!device) return false; // Hide empty slots when filtering? Or keep them? 
        // If we want a strict grid, we usually keep slots. But "Filter" usually implies compacting.
        // Let's filter the devices.

        // 1. Show Selected Only
        if (showSelectedOnly && !selectedDevices.includes(device.id)) return false;

        // 2. Filter Untagged
        if (filterUntagged && (device.tags && device.tags.length > 0)) return false;

        // 3. Filter by specific Tag
        if (filterTag && (!device.tags || !device.tags.includes(filterTag))) return false;

        return true;
    });

    if (visibleDevices.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full p-8 text-center bg-gray-950">
                <Loader2 className="w-12 h-12 animate-spin text-blue-500 mb-4" />
                <h2 className="text-xl font-semibold mb-2 text-white">No devices found</h2>
                <p className="text-gray-400">
                    adjust filters or scan for devices
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
                {visibleDevices.map((device, index) => {
                    if (!device) return null;
                    return (
                        <DeviceCard
                            // Use actual device ID for key to maintain state when filtering
                            key={device.id}
                            device={device}
                            // Slot index is less relevant when filtering, passing index for now
                            slotIndex={index}
                            isSelected={selectedDevices.includes(device.id)}
                            isDragHighlighted={dragHighlightedDevices.includes(device.id)}
                            onSelect={(isCtrl, isShift) => {
                                if (isCtrl) {
                                    toggleDeviceSelection(device.id); // Add/Remove from selection
                                } else {
                                    // Exclusive select: clear all, then select this one
                                    clearDeviceSelection();
                                    toggleDeviceSelection(device.id);
                                }
                            }}
                            onExpand={() => setExpandedDevice(device.id)}
                        />
                    );
                })}
            </div>
        </div>
    );
};
