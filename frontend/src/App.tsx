import React, { useEffect, useState } from 'react';
import { DeviceGrid } from './components/DeviceGrid';
import { ControlPanel } from './components/ControlPanel';
import { ExpandedDeviceView } from './components/ExpandedDeviceView';
import { SettingsModal } from './components/SettingsModal';
import { useAppStore } from './store/useAppStore';
import { wsService } from './services/websocket';
import { api } from './services/api';
import {
    RefreshCw,
    Trash2,
    Play,
    Type,
    Package,
    Wifi,
    WifiOff,
    Settings
} from 'lucide-react';

function App() {
    const {
        devices,
        selectedDevices,
        selectedDeviceDetail,
        expandedDeviceId,
        isConnected,
        setDevices,
        selectDevice,
        clearDeviceSelection,
        setConnected,
    } = useAppStore();

    const [isScanning, setIsScanning] = useState(false);
    const [batchInput, setBatchInput] = useState('');
    const [showBatchInput, setShowBatchInput] = useState(false);
    const [showSettings, setShowSettings] = useState(false);

    // Load devices on mount
    useEffect(() => {
        loadDevices();
    }, []);

    // Sync WebSocket connection state
    useEffect(() => {
        const checkConnection = () => {
            setConnected(wsService.isConnected);
        };

        // Check immediately
        checkConnection();

        // Check periodically
        const interval = setInterval(checkConnection, 1000);

        return () => clearInterval(interval);
    }, [setConnected]);

    const loadDevices = async () => {
        setIsScanning(true);
        try {
            const deviceList = await api.device.scanDevices();
            setDevices(deviceList);
        } catch (error) {
            console.error('Failed to load devices:', error);
        } finally {
            setIsScanning(false);
        }
    };

    const handleScanDevices = async () => {
        setIsScanning(true);
        try {
            const deviceList = await api.device.scanDevices();
            setDevices(deviceList);
        } catch (error) {
            console.error('Failed to scan devices:', error);
        } finally {
            setIsScanning(false);
        }
    };

    const handleBatchAction = async (actionType: 'tap' | 'input') => {
        if (selectedDevices.length === 0) {
            alert('Please select devices first');
            return;
        }

        if (actionType === 'input') {
            setShowBatchInput(true);
        }
    };

    const executeBatchInput = async () => {
        if (!batchInput.trim() || selectedDevices.length === 0) return;

        try {
            await api.action.executeBatchAction(selectedDevices, {
                type: 'input',
                params: { text: batchInput },
            });
            setBatchInput('');
            setShowBatchInput(false);
        } catch (error) {
            console.error('Failed to execute batch input:', error);
        }
    };

    return (
        <div className="min-h-screen bg-background">
            {/* Header */}
            <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
                <div className="container mx-auto px-4 py-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-2xl font-bold">Android Control</h1>
                            <p className="text-sm text-muted-foreground">
                                Multi-Device Control System
                            </p>
                        </div>

                        {/* Connection status */}
                        <div className="flex items-center gap-2">
                            {isConnected ? (
                                <>
                                    <Wifi className="text-green-500" size={20} />
                                    <span className="text-sm text-green-500">Connected</span>
                                </>
                            ) : (
                                <>
                                    <WifiOff className="text-red-500" size={20} />
                                    <span className="text-sm text-red-500">Disconnected</span>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </header>

            {/* Toolbar */}
            <div className="sticky top-16 z-30 border-b bg-background/95 backdrop-blur">
                <div className="container mx-auto px-4 py-3">
                    <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleScanDevices}
                                disabled={isScanning}
                                className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md transition-colors disabled:opacity-50"
                            >
                                <RefreshCw size={16} className={isScanning ? 'animate-spin' : ''} />
                                {isScanning ? 'Scanning...' : 'Scan Devices'}
                            </button>

                            <button
                                onClick={() => clearDeviceSelection()}
                                className="flex items-center gap-2 px-4 py-2 bg-secondary hover:bg-secondary/80 rounded-md transition-colors"
                            >
                                <Trash2 size={16} />
                                Clear Selection
                            </button>

                            <button
                                onClick={() => setShowSettings(true)}
                                className="flex items-center gap-2 px-4 py-2 bg-secondary hover:bg-secondary/80 rounded-md transition-colors"
                            >
                                <Settings size={16} />
                                Settings
                            </button>
                        </div>

                        {/* Batch operations */}
                        {selectedDevices.length > 0 && (
                            <div className="flex items-center gap-2">
                                <span className="text-sm text-muted-foreground">
                                    {selectedDevices.length} device(s) selected
                                </span>

                                <button
                                    onClick={() => handleBatchAction('input')}
                                    className="flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent/80 rounded-md transition-colors"
                                >
                                    <Type size={16} />
                                    Batch Input
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Main content */}
            <main className="container mx-auto">
                <DeviceGrid />
            </main>

            {/* Expanded Device View (Phóng to) */}
            {expandedDeviceId && (
                <ExpandedDeviceView deviceId={expandedDeviceId} />
            )}

            {/* Control panel modal */}
            {selectedDeviceDetail && (
                <ControlPanel
                    device={selectedDeviceDetail}
                    onClose={() => selectDevice(null)}
                />
            )}

            {/* Settings modal */}
            {showSettings && (
                <SettingsModal onClose={() => setShowSettings(false)} />
            )}

            {/* Batch input modal */}
            {showBatchInput && (
                <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
                    <div className="bg-background rounded-lg shadow-2xl max-w-md w-full p-6">
                        <h3 className="text-lg font-semibold mb-4">Batch Input</h3>
                        <input
                            type="text"
                            value={batchInput}
                            onChange={(e) => setBatchInput(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && executeBatchInput()}
                            placeholder="Enter text to send to all selected devices..."
                            className="w-full px-3 py-2 bg-background border border-input rounded-md focus:outline-none focus:ring-2 focus:ring-ring mb-4"
                            autoFocus
                        />
                        <div className="flex gap-2 justify-end">
                            <button
                                onClick={() => setShowBatchInput(false)}
                                className="px-4 py-2 bg-secondary hover:bg-secondary/80 rounded-md transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={executeBatchInput}
                                className="px-4 py-2 bg-primary text-primary-foreground hover:bg-primary/90 rounded-md transition-colors"
                            >
                                Send
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default App;
