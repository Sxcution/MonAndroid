import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useSettingsStore } from '@/store/useSettingsStore';

interface SettingsModalProps {
    onClose: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({ onClose }) => {
    const {
        targetFps,
        showFpsIndicator,
        showDeviceName,
        setTargetFps,
        toggleFpsIndicator,
        toggleDeviceName,
    } = useSettingsStore();

    const [tempFps, setTempFps] = useState(targetFps);

    const handleSave = () => {
        setTargetFps(tempFps);
        onClose();
    };

    return (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
            <div className="bg-gray-900 rounded-lg shadow-2xl max-w-md w-full border border-gray-700">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-gray-700">
                    <h3 className="text-lg font-semibold text-white">Settings</h3>
                    <button
                        onClick={onClose}
                        className="p-1 hover:bg-gray-800 rounded transition-colors"
                    >
                        <X size={20} className="text-gray-400" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6">
                    {/* FPS Slider */}
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-2">
                            Target FPS: <span className="text-blue-400 font-bold">{tempFps}</span>
                        </label>
                        <input
                            type="range"
                            min="5"
                            max="30"
                            step="1"
                            value={tempFps}
                            onChange={(e) => setTempFps(parseInt(e.target.value))}
                            className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                        />
                        <div className="flex justify-between text-xs text-gray-500 mt-1">
                            <span>5 FPS</span>
                            <span>30 FPS</span>
                        </div>
                    </div>

                    {/* FPS Indicator Toggle */}
                    <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-gray-300">
                            Show FPS Indicator
                        </label>
                        <button
                            onClick={toggleFpsIndicator}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${showFpsIndicator ? 'bg-blue-600' : 'bg-gray-600'
                                }`}
                        >
                            <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${showFpsIndicator ? 'translate-x-6' : 'translate-x-1'
                                    }`}
                            />
                        </button>
                    </div>

                    {/* Device Name Toggle */}
                    <div className="flex items-center justify-between">
                        <label className="text-sm font-medium text-gray-300">
                            Show Device Name
                        </label>
                        <button
                            onClick={toggleDeviceName}
                            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${showDeviceName ? 'bg-blue-600' : 'bg-gray-600'
                                }`}
                        >
                            <span
                                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${showDeviceName ? 'translate-x-6' : 'translate-x-1'
                                    }`}
                            />
                        </button>
                    </div>
                </div>

                {/* Footer */}
                <div className="flex gap-3 p-4 border-t border-gray-700">
                    <button
                        onClick={onClose}
                        className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-md transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-md transition-colors"
                    >
                        Save
                    </button>
                </div>
            </div>
        </div>
    );
};
