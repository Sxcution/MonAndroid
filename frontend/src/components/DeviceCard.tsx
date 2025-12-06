import React, { memo, useState, useRef, useEffect } from 'react';
import { Device } from '@/types/device';
import { ScreenView } from './ScreenView';
import { Search } from 'lucide-react';
import { cn } from '@/utils/helpers';
import { useAppStore } from '@/store/useAppStore';
import { useSettingsStore } from '@/store/useSettingsStore';
import { deviceService } from '@/services/deviceService';

interface DeviceCardProps {
    device: Device | null;
    slotIndex: number;
    isSelected: boolean;
    isDragHighlighted?: boolean;
    onSelect: () => void;
    onExpand: () => void;
}

export const DeviceCard: React.FC<DeviceCardProps> = memo(({ device, slotIndex, isSelected, isDragHighlighted = false, onSelect, onExpand }) => {
    const { expandedDeviceId, expandButtonPosition, setExpandButtonPosition, selectedDevices } = useAppStore();
    const { showDeviceName } = useSettingsStore();
    const isExpanded = device ? expandedDeviceId === device.id : false;
    const [isHovered, setIsHovered] = useState(false);

    // Refs for expand button drag
    const btnRef = useRef<HTMLButtonElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const isDraggingBtn = useRef(false);
    const dragStartPos = useRef({ x: 0, y: 0 });
    const hasDragged = useRef(false);

    const handleMouseDownBtn = (e: React.MouseEvent) => {
        e.stopPropagation();
        isDraggingBtn.current = true;
        hasDragged.current = false;
        dragStartPos.current = { x: e.clientX, y: e.clientY };
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDraggingBtn.current || !containerRef.current) return;
            const deltaX = Math.abs(e.clientX - dragStartPos.current.x);
            const deltaY = Math.abs(e.clientY - dragStartPos.current.y);
            if (deltaX > 5 || deltaY > 5) {
                hasDragged.current = true;
            }
            const rect = containerRef.current.getBoundingClientRect();
            let newX = e.clientX - rect.left - 15;
            let newY = e.clientY - rect.top - 15;
            newX = Math.max(0, Math.min(newX, rect.width - 30));
            newY = Math.max(0, Math.min(newY, rect.height - 30));
            setExpandButtonPosition({ x: newX, y: newY });
        };
        const handleMouseUp = () => {
            isDraggingBtn.current = false;
        };
        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, []);

    const didSelectOnDown = useRef(false);

    const handleMouseDownSelect: React.MouseEventHandler<HTMLDivElement> = (e) => {
        // Only left click triggers selection here
        // Avoid conflict with drag button or other interactions
        if (e.button !== 0) return;

        // Ignore if interacting with the screen (canvas)
        if ((e.target as HTMLElement).tagName.toLowerCase() === 'canvas') return;

        // Instant feedback: toggle selection immediately on mousedown
        e.preventDefault();
        didSelectOnDown.current = true;
        onSelect();
    };

    const handleTouchStartSelect: React.TouchEventHandler<HTMLDivElement> = (e) => {
        // Ignore if interacting with the screen (canvas)
        if ((e.target as HTMLElement).tagName.toLowerCase() === 'canvas') return;

        // Remove touch delay
        e.preventDefault();
        didSelectOnDown.current = true;
        onSelect();
    };

    const handleClickWrapper: React.MouseEventHandler<HTMLDivElement> = () => {
        // If we selected on mousedown/touchstart, skip click to avoid double toggle
        if (didSelectOnDown.current) {
            didSelectOnDown.current = false;
            return;
        }

        // Handle Ctrl+Click specifically if it wasn't caught by mousedown (though mousedown should catch it)
        // But if we want to support standard click behavior for other things, we keep this.
        // In the specific user request, they mentioned "Sếp có handleClick cũ (mở gì đó), gọi lại ở đây"
        // Our old handleClick was handling Ctrl+Click.

        if (!device) return;

        // If for some reason mousedown didn't fire (unlikely), we can fallback here,
        // but primarily we just want to allow other interactions if needed.
        // Original logic only handled Ctrl+Click. Since we moved selection to mousedown,
        // we might not need this for selection anymore.

        // However, we should be careful about the "ScreenView" interactions.
        // The ScreenView is inside this div. We need to make sure we don't block its interactions if it's the target.
        // The previous code had "onClick={handleClick}" on the div.
    };

    // We verify if we need to keep the old handleClick for anything else. 
    // The old handleClick:
    // const handleClick = (e: React.MouseEvent) => {
    //    if (!device) return;
    //    if (e.ctrlKey) { e.stopPropagation(); onSelect(); }
    // };
    // Since we are moving onSelect to mousedown, we don't need it here for Ctrl+click anymore if mousedown handles it.
    // The mousedown handler above handles the selection.

    return (
        <div
            ref={containerRef}
            data-device-id={device?.id}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onContextMenu={(e) => {
                e.preventDefault();
                if (device && device.status === 'online') {
                    deviceService.goBack(device.id);
                }
            }}
            onMouseDown={handleMouseDownSelect}
            onTouchStart={handleTouchStartSelect}
            onClick={handleClickWrapper}
            style={{ touchAction: 'manipulation', userSelect: 'none' }}
            className={cn(
                'relative bg-gray-900 rounded-sm overflow-hidden border-2 transition-all group aspect-[9/16]',
                !device ? 'border-gray-800' :
                    (isSelected || isDragHighlighted) ? 'border-blue-500 shadow-lg shadow-blue-500/30' : 'border-gray-700 hover:border-blue-400/60'
            )}
        >
            {/* ScreenView Full */}
            <div className="absolute inset-0">
                {device && device.status === 'online' ? (
                    <ScreenView
                        device={device}
                        className="w-full h-full"
                        interactive={true}
                        syncWithSelected={isSelected && selectedDevices.length > 1}
                    />
                ) : (
                    <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500 text-xs gap-2">
                        <div className="text-6xl font-bold text-gray-800">
                            {String(slotIndex + 1).padStart(2, '0')}
                        </div>
                        <div className="text-sm text-gray-600">
                            {device ? 'Offline' : 'Chưa kết nối'}
                        </div>
                    </div>
                )}

                {/* Expanded overlay */}
                {isExpanded && (
                    <div className="absolute inset-0 bg-black/60 flex items-center justify-center z-10 pointer-events-none border-2 border-yellow-500/50">
                        <span className="text-yellow-500 font-bold text-sm animate-pulse px-2 py-1 bg-black/40 rounded">
                            Đang điều khiển
                        </span>
                    </div>
                )}

                {/* Device name */}
                {showDeviceName && device && (
                    <div className="absolute bottom-0 left-0 right-0 bg-black/40 backdrop-blur-[2px] p-1 text-[10px] text-white/80 truncate text-center pointer-events-none">
                        {device.name || device.adb_device_id}
                    </div>
                )}
            </div>

            {/* Expand button (magnifying glass) */}
            {device && device.status === 'online' && isHovered && (
                <button
                    ref={btnRef}
                    onMouseDown={handleMouseDownBtn}
                    onClick={(e) => {
                        e.stopPropagation();
                        if (!hasDragged.current) {
                            onExpand();
                        }
                    }}
                    style={{
                        top: `${expandButtonPosition.y}px`,
                        left: `${expandButtonPosition.x}px`,
                        position: 'absolute',
                    }}
                    className="z-20 w-5 h-5 flex items-center justify-center bg-gray-800/80 hover:bg-blue-600 text-white rounded-full shadow-lg backdrop-blur-sm border border-white/10 transition-colors cursor-grab active:cursor-grabbing"
                    title="Phóng to"
                >
                    <Search size={10} />
                </button>
            )}
        </div>
    );
});

DeviceCard.displayName = 'DeviceCard';
