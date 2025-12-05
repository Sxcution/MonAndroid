import { useEffect, useState, useCallback, useRef } from 'react';
import { DeviceGrid } from './components/DeviceGrid';
import { ControlPanel } from './components/ControlPanel';
import { ExpandedDeviceView } from './components/ExpandedDeviceView';
import { SettingsModal } from './components/SettingsModal';
import { useAppStore } from './store/useAppStore';
import { wsService } from './services/websocket';
import { api } from './services/api';
import {
    RefreshCw,
    Settings,
    Wifi,
    WifiOff,
    Type
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
        setConnected,
        clearDeviceSelection,
        toggleDeviceSelection,
    } = useAppStore();

    const [isScanning, setIsScanning] = useState(false);
    const [batchInput, setBatchInput] = useState('');
    const [showBatchInput, setShowBatchInput] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [sidebarVisible, setSidebarVisible] = useState(false);

    // Drag selection state
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
    const [dragEnd, setDragEnd] = useState({ x: 0, y: 0 });
    const [dragHighlightedDevices, setDragHighlightedDevices] = useState<string[]>([]);
    const containerRef = useRef<HTMLDivElement>(null);

    // Load devices on mount
    useEffect(() => {
        loadDevices();
    }, []);

    // Sync WebSocket connection state
    useEffect(() => {
        const checkConnection = () => {
            setConnected(wsService.isConnected);
        };
        checkConnection();
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

    // Sidebar hover detection
    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (e.clientX <= 8) {
            setSidebarVisible(true);
        }
    }, []);

    useEffect(() => {
        window.addEventListener('mousemove', handleMouseMove);
        return () => window.removeEventListener('mousemove', handleMouseMove);
    }, [handleMouseMove]);

    // Drag selection handlers
    const dragTargetRef = useRef<HTMLElement | null>(null);

    const handleDragStart = (e: React.MouseEvent) => {
        // Only start drag with left mouse button, not on sidebar/modals, not with Ctrl
        if (e.button !== 0) return;
        if (e.ctrlKey) return; // Ctrl+Click handled by DeviceCard
        if ((e.target as HTMLElement).closest('.sidebar, .modal')) return;

        // IMPORTANT: Only start drag selection when clicking OUTSIDE device cards
        // Clicking on a card should NOT start drag (to avoid conflict with phone swipe)
        const clickedOnCard = (e.target as HTMLElement).closest('[data-device-id]');
        if (clickedOnCard) return;

        // Store target element
        dragTargetRef.current = e.target as HTMLElement;

        setIsDragging(true);
        setDragStart({ x: e.clientX, y: e.clientY });
        setDragEnd({ x: e.clientX, y: e.clientY });
        setDragHighlightedDevices([]);
    };

    const handleDragMove = (e: React.MouseEvent) => {
        if (!isDragging) return;
        const newEnd = { x: e.clientX, y: e.clientY };
        setDragEnd(newEnd);

        // Calculate highlighted devices in real-time
        const minX = Math.min(dragStart.x, newEnd.x);
        const maxX = Math.max(dragStart.x, newEnd.x);
        const minY = Math.min(dragStart.y, newEnd.y);
        const maxY = Math.max(dragStart.y, newEnd.y);

        const highlighted: string[] = [];
        const cards = document.querySelectorAll('[data-device-id]');
        cards.forEach(card => {
            const rect = card.getBoundingClientRect();
            const intersects = !(rect.right < minX || rect.left > maxX || rect.bottom < minY || rect.top > maxY);
            if (intersects) {
                const deviceId = card.getAttribute('data-device-id');
                if (deviceId) highlighted.push(deviceId);
            }
        });
        setDragHighlightedDevices(highlighted);
    };

    const handleDragEnd = () => {
        if (!isDragging) return;

        // If drag distance is too small, treat as click
        if (Math.abs(dragEnd.x - dragStart.x) < 10 && Math.abs(dragEnd.y - dragStart.y) < 10) {
            // Only clear selection if click was NOT on a device card (empty area)
            const clickedOnCard = dragTargetRef.current?.closest('[data-device-id]');
            if (!clickedOnCard) {
                clearDeviceSelection();
            }
            setIsDragging(false);
            setDragHighlightedDevices([]);
            dragTargetRef.current = null;
            return;
        }

        // Use already calculated highlighted devices from drag move
        dragHighlightedDevices.forEach(deviceId => {
            if (!selectedDevices.includes(deviceId)) {
                toggleDeviceSelection(deviceId);
            }
        });

        setIsDragging(false);
        setDragHighlightedDevices([]);
    };

    // Calculate selection box dimensions
    const selectionBox = isDragging ? {
        left: Math.min(dragStart.x, dragEnd.x),
        top: Math.min(dragStart.y, dragEnd.y),
        width: Math.abs(dragEnd.x - dragStart.x),
        height: Math.abs(dragEnd.y - dragStart.y),
    } : null;

    return (
        <div
            ref={containerRef}
            className="h-screen w-screen overflow-hidden bg-gray-950 relative select-none"
            onMouseDown={handleDragStart}
            onMouseMove={handleDragMove}
            onMouseUp={handleDragEnd}
            onMouseLeave={handleDragEnd}
        >
            {/* Selection Box */}
            {selectionBox && selectionBox.width > 5 && selectionBox.height > 5 && (
                <div
                    className="fixed pointer-events-none z-50 border-2 border-blue-500 bg-blue-500/20"
                    style={{
                        left: selectionBox.left,
                        top: selectionBox.top,
                        width: selectionBox.width,
                        height: selectionBox.height,
                    }}
                />
            )}

            {/* Hidden Sidebar - appears on hover */}
            <div
                className={`sidebar fixed left-0 top-0 h-full z-50 transition-transform duration-300 ease-in-out ${sidebarVisible ? 'translate-x-0' : '-translate-x-full'
                    }`}
                onMouseLeave={() => setSidebarVisible(false)}
            >
                <div className="h-full w-56 bg-gray-900/95 backdrop-blur-md border-r border-gray-700 flex flex-col shadow-2xl">
                    {/* Sidebar Header - Scan + Status on same row */}
                    <div className="p-3 border-b border-gray-700">
                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleScanDevices}
                                disabled={isScanning}
                                className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg transition-colors text-sm font-medium"
                            >
                                <RefreshCw size={16} className={isScanning ? 'animate-spin' : ''} />
                                {isScanning ? 'Scanning...' : 'Scan'}
                            </button>
                            {isConnected ? (
                                <Wifi className="text-green-500" size={20} />
                            ) : (
                                <WifiOff className="text-red-500" size={20} />
                            )}
                        </div>
                    </div>

                    {/* Sidebar Actions */}
                    <div className="flex-1 p-3 space-y-2">
                        <button
                            onClick={() => setShowSettings(true)}
                            className="w-full flex items-center gap-3 px-4 py-3 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors text-sm"
                        >
                            <Settings size={18} />
                            Settings
                        </button>

                        {/* Device count info */}
                        <div className="mt-4 p-3 bg-gray-800/50 rounded-lg">
                            <div className="text-xs text-gray-400">Devices</div>
                            <div className="text-2xl font-bold text-white">
                                {devices.filter(d => d.status === 'online').length}
                                <span className="text-sm font-normal text-gray-500"> / {devices.length}</span>
                            </div>
                        </div>

                        {/* Selected devices */}
                        {selectedDevices.length > 0 && (
                            <div className="mt-4 p-3 bg-blue-900/30 border border-blue-700/50 rounded-lg">
                                <div className="text-xs text-blue-400 mb-2">
                                    {selectedDevices.length} device(s) selected
                                </div>
                                <button
                                    onClick={() => handleBatchAction('input')}
                                    className="w-full flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-xs"
                                >
                                    <Type size={14} />
                                    Batch Input
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Sidebar Footer */}
                    <div className="p-3 border-t border-gray-700 text-xs text-gray-500 text-center">
                        v1.0.0
                    </div>
                </div>
            </div>

            {/* Sidebar trigger zone */}
            <div
                className="fixed left-0 top-0 w-2 h-full z-40"
                onMouseEnter={() => setSidebarVisible(true)}
            />

            {/* Main Content - Full Screen Grid */}
            <main className="w-full h-full">
                <DeviceGrid dragHighlightedDevices={dragHighlightedDevices} />
            </main>

            {/* Expanded Device View */}
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
                <div className="modal">
                    <SettingsModal onClose={() => setShowSettings(false)} />
                </div>
            )}

            {/* Batch input modal */}
            {showBatchInput && (
                <div className="modal fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
                    <div className="bg-gray-900 rounded-lg shadow-2xl max-w-md w-full p-6 border border-gray-700">
                        <h3 className="text-lg font-semibold mb-4 text-white">Batch Input</h3>
                        <input
                            type="text"
                            value={batchInput}
                            onChange={(e) => setBatchInput(e.target.value)}
                            onKeyPress={(e) => e.key === 'Enter' && executeBatchInput()}
                            placeholder="Enter text to send to all selected devices..."
                            className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4 text-white"
                            autoFocus
                        />
                        <div className="flex gap-2 justify-end">
                            <button
                                onClick={() => setShowBatchInput(false)}
                                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-md transition-colors text-white"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={executeBatchInput}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded-md transition-colors text-white"
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
