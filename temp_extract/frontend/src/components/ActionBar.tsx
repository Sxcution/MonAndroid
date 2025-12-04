import React, { useState } from 'react';
import { deviceService } from '@/services/deviceService';
import { KEY_CODES } from '@/utils/constants';
import {
    ArrowLeft,
    Home,
    Menu,
    Power,
    VolumeX,
    Volume2,
    RotateCcw,
    Send
} from 'lucide-react';

interface ActionBarProps {
    deviceId: string;
    onInput?: (text: string) => void;
    onOpenApp?: (packageName: string) => void;
}

export const ActionBar: React.FC<ActionBarProps> = ({
    deviceId,
    onInput,
    onOpenApp,
}) => {
    const [inputText, setInputText] = useState('');
    const [appPackage, setAppPackage] = useState('');

    const handleKeyPress = async (keycode: number) => {
        try {
            await deviceService.pressKey(deviceId, keycode);
        } catch (error) {
            console.error('Failed to press key:', error);
        }
    };

    const handleInput = async () => {
        if (!inputText.trim()) return;

        try {
            await deviceService.input(deviceId, inputText);
            if (onInput) onInput(inputText);
            setInputText('');
        } catch (error) {
            console.error('Failed to input text:', error);
        }
    };

    const handleOpenApp = async () => {
        if (!appPackage.trim()) return;

        try {
            await deviceService.openApp(deviceId, appPackage);
            if (onOpenApp) onOpenApp(appPackage);
            setAppPackage('');
        } catch (error) {
            console.error('Failed to open app:', error);
        }
    };

    return (
        <div className="flex flex-col gap-4 p-4 bg-card border rounded-lg">
            {/* Quick actions */}
            <div>
                <h3 className="text-sm font-semibold mb-2">Quick Actions</h3>
                <div className="grid grid-cols-4 gap-2">
                    <button
                        onClick={() => handleKeyPress(KEY_CODES.BACK)}
                        className="flex flex-col items-center gap-1 p-3 bg-secondary hover:bg-secondary/80 rounded-md transition-colors"
                        title="Back"
                    >
                        <ArrowLeft size={20} />
                        <span className="text-xs">Back</span>
                    </button>

                    <button
                        onClick={() => handleKeyPress(KEY_CODES.HOME)}
                        className="flex flex-col items-center gap-1 p-3 bg-secondary hover:bg-secondary/80 rounded-md transition-colors"
                        title="Home"
                    >
                        <Home size={20} />
                        <span className="text-xs">Home</span>
                    </button>

                    <button
                        onClick={() => handleKeyPress(KEY_CODES.MENU)}
                        className="flex flex-col items-center gap-1 p-3 bg-secondary hover:bg-secondary/80 rounded-md transition-colors"
                        title="Menu"
                    >
                        <Menu size={20} />
                        <span className="text-xs">Menu</span>
                    </button>

                    <button
                        onClick={() => handleKeyPress(KEY_CODES.POWER)}
                        className="flex flex-col items-center gap-1 p-3 bg-secondary hover:bg-secondary/80 rounded-md transition-colors"
                        title="Power"
                    >
                        <Power size={20} />
                        <span className="text-xs">Power</span>
                    </button>

                    <button
                        onClick={() => handleKeyPress(KEY_CODES.VOLUME_DOWN)}
                        className="flex flex-col items-center gap-1 p-3 bg-secondary hover:bg-secondary/80 rounded-md transition-colors"
                        title="Volume Down"
                    >
                        <VolumeX size={20} />
                        <span className="text-xs">Vol-</span>
                    </button>

                    <button
                        onClick={() => handleKeyPress(KEY_CODES.VOLUME_UP)}
                        className="flex flex-col items-center gap-1 p-3 bg-secondary hover:bg-secondary/80 rounded-md transition-colors"
                        title="Volume Up"
                    >
                        <Volume2 size={20} />
                        <span className="text-xs">Vol+</span>
                    </button>

                    <button
                        onClick={() => handleKeyPress(KEY_CODES.ENTER)}
                        className="flex flex-col items-center gap-1 p-3 bg-secondary hover:bg-secondary/80 rounded-md transition-colors"
                        title="Enter"
                    >
                        <RotateCcw size={20} />
                        <span className="text-xs">Enter</span>
                    </button>
                </div>
            </div>

            {/* Text input */}
            <div>
                <h3 className="text-sm font-semibold mb-2">Input Text</h3>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleInput()}
                        placeholder="Enter text to send..."
                        className="flex-1 px-3 py-2 bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <button
                        onClick={handleInput}
                        className="px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md transition-colors flex items-center gap-2"
                    >
                        <Send size={16} />
                        Send
                    </button>
                </div>
            </div>

            {/* Open app */}
            <div>
                <h3 className="text-sm font-semibold mb-2">Open App</h3>
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={appPackage}
                        onChange={(e) => setAppPackage(e.target.value)}
                        onKeyPress={(e) => e.key === 'Enter' && handleOpenApp()}
                        placeholder="Package name (e.g., com.android.chrome)"
                        className="flex-1 px-3 py-2 bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring"
                    />
                    <button
                        onClick={handleOpenApp}
                        className="px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md transition-colors"
                    >
                        Open
                    </button>
                </div>
            </div>
        </div>
    );
};
