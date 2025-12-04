import React from 'react';
import { Device } from '@/types/device';
import { ScreenView } from './ScreenView';
import { ActionBar } from './ActionBar';
import { X } from 'lucide-react';

interface ControlPanelProps {
    device: Device;
    onClose: () => void;
}

export const ControlPanel: React.FC<ControlPanelProps> = ({
    device,
    onClose,
}) => {
    return (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
            <div className="bg-background rounded-lg shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-auto">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b sticky top-0 bg-background z-10">
                    <div>
                        <h2 className="text-xl font-bold">{device.name}</h2>
                        <p className="text-sm text-muted-foreground">
                            {device.adb_device_id} • Android {device.android_version}
                        </p>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-secondary rounded-md transition-colors"
                    >
                        <X size={24} />
                    </button>
                </div>

                {/* Content */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 p-6">
                    {/* Screen view */}
                    <div>
                        <h3 className="text-lg font-semibold mb-3">Screen Mirror</h3>
                        <ScreenView device={device} />
                    </div>

                    {/* Action bar */}
                    <div>
                        <h3 className="text-lg font-semibold mb-3">Controls</h3>
                        <ActionBar deviceId={device.id} />
                    </div>
                </div>
            </div>
        </div>
    );
};
