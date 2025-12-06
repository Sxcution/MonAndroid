import React, { useState } from 'react';
import { Device } from '@/types/device';
import { useAppStore } from '@/store/useAppStore';
import { Tag, Edit, LayoutGrid, Check, ChevronRight, Settings } from 'lucide-react';
// Using custom context menu (not radix) for flexibility

// Custom Context Menu Component
interface DeviceContextMenuProps {
    device: Device;
    x: number;
    y: number;
    onClose: () => void;
    onUpdateSlot: () => void;
}

export const DeviceContextMenu: React.FC<DeviceContextMenuProps> = ({ device, x, y, onClose, onUpdateSlot }) => {
    const { availableTags, assignTag, removeTag } = useAppStore();
    const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);

    return (
        <div
            className="fixed z-50 w-56 bg-[#1e1e1e] border border-gray-700 rounded-lg shadow-xl py-1 text-sm text-gray-300 select-none animate-in fade-in zoom-in-95 duration-100"
            style={{ top: y, left: x }}
            onClick={(e) => e.stopPropagation()}
        >
            {/* Header / Title */}
            <div className="px-3 py-2 border-b border-gray-700 mb-1 flex items-center justify-between">
                <span className="font-semibold text-white truncate max-w-[150px]">{device.name || device.adb_device_id}</span>
            </div>

            {/* Menu Items */}
            <div className="relative">
                {/* Add to Tag (Hover to show submenu) */}
                <div
                    className="px-3 py-2 hover:bg-[#04395e] hover:text-white cursor-pointer flex items-center justify-between group"
                    onMouseEnter={() => setOpenSubmenu('tags')}
                    onMouseLeave={() => setOpenSubmenu(null)}
                >
                    <div className="flex items-center gap-2">
                        <Tag size={14} className="text-green-500" />
                        <span>Thêm vào thẻ</span>
                    </div>
                    <ChevronRight size={14} className="text-gray-500 group-hover:text-white" />

                    {/* Submenu */}
                    {openSubmenu === 'tags' && (
                        <div
                            className="absolute left-full top-0 ml-1 w-48 bg-[#1e1e1e] border border-gray-700 rounded-lg shadow-xl py-1"
                        >
                            {availableTags.length === 0 ? (
                                <div className="px-3 py-2 text-gray-500 text-xs italic">Chưa có thẻ nào</div>
                            ) : (
                                availableTags.map(tag => {
                                    const isSelected = device.tags?.includes(tag);
                                    return (
                                        <div
                                            key={tag}
                                            onClick={(e) => {
                                                e.stopPropagation(); // prevent closing main menu? maybe close both. 
                                                // User wants to check multiple? 
                                                if (isSelected) removeTag(device.id, tag);
                                                else assignTag(device.id, tag);
                                            }}
                                            className="px-3 py-2 hover:bg-[#04395e] hover:text-white cursor-pointer flex items-center gap-2"
                                        >
                                            <div className={`w-3.5 h-3.5 border rounded flex items-center justify-center ${isSelected ? 'bg-blue-600 border-blue-600' : 'border-gray-500'}`}>
                                                {isSelected && <Check size={10} className="text-white" />}
                                            </div>
                                            <span className="truncate">{tag}</span>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    )}
                </div>

                {/* Change Slot */}
                <div
                    className="px-3 py-2 hover:bg-[#04395e] hover:text-white cursor-pointer flex items-center gap-2"
                    onClick={() => {
                        onUpdateSlot();
                        onClose();
                    }}
                >
                    <LayoutGrid size={14} className="text-orange-400" />
                    <span>Đổi số hiệu card</span>
                </div>

                <div className="h-px bg-gray-700 my-1 mx-2"></div>

                {/* Placeholder Items */}
                <div className="px-3 py-2 hover:bg-[#04395e] hover:text-white cursor-pointer flex items-center gap-2 opacity-50">
                    <Settings size={14} />
                    <span>Cài đặt APK (Coming Soon)</span>
                </div>
                <div className="px-3 py-2 hover:bg-[#04395e] hover:text-white cursor-pointer flex items-center gap-2 opacity-50">
                    <Edit size={14} />
                    <span>Nhập văn bản (Coming Soon)</span>
                </div>
            </div>
        </div>
    );
};
