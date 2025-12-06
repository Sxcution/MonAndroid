import { create } from 'zustand';
import { Device } from '@/types/device';
import { Action } from '@/types/action';

// LocalStorage key for slot registry
const SLOT_REGISTRY_KEY = 'device_slot_registry';

// Device slot registry: deviceId -> slotIndex
type SlotRegistry = Record<string, number>;

// Load slot registry from localStorage
const loadSlotRegistry = (): SlotRegistry => {
    try {
        const stored = localStorage.getItem(SLOT_REGISTRY_KEY);
        return stored ? JSON.parse(stored) : {};
    } catch {
        return {};
    }
};

// Save slot registry to localStorage
const saveSlotRegistry = (registry: SlotRegistry) => {
    try {
        localStorage.setItem(SLOT_REGISTRY_KEY, JSON.stringify(registry));
    } catch (e) {
        console.error('Failed to save slot registry:', e);
    }
};

interface AppStore {
    // Device state
    devices: Device[];
    selectedDevices: string[];
    selectedDeviceDetail: Device | null;
    deviceSlotRegistry: SlotRegistry; // NEW: Track stable grid positions

    // Action state
    actions: Action[];

    // UI state
    isConnected: boolean;
    expandedDeviceId: string | null; // ID của máy đang phóng to

    // Device actions
    setDevices: (devices: Device[]) => void;
    addDevice: (device: Device) => void;
    removeDevice: (id: string) => void;
    updateDevice: (id: string, updates: Partial<Device>) => void;
    toggleDeviceSelection: (id: string) => void;
    selectAllDevices: () => void;
    selectDevice: (id: string | null) => void;
    clearDeviceSelection: () => void;
    setExpandedDevice: (id: string | null) => void;
    registerDeviceSlots: (devices: Device[]) => void; // NEW: Register new devices

    // Real-time updates
    onDeviceStatusChange: (id: string, status: 'online' | 'offline') => void;
    onScreenFrameUpdate: (id: string, frame: string) => void;

    // Action handling
    addAction: (action: Action) => void;
    updateActionStatus: (actionId: string, status: Action['status'], result?: string) => void;

    // Connection state
    setConnected: (connected: boolean) => void;

    // Helper to get devices sorted by slot
    getDevicesBySlot: () => (Device | null)[];

    // Shared expand button position
    expandButtonPosition: { x: number; y: number };
    setExpandButtonPosition: (position: { x: number; y: number }) => void;

    // Tag Management & Filtering
    availableTags: string[];
    filterTag: string | null;
    filterUntagged: boolean;
    showSelectedOnly: boolean;

    addTag: (tagName: string) => void;
    // assignTagToDevice(s) - updateDevice can handle this, but specific helper is nice
    assignTag: (deviceId: string, tagName: string) => void;
    removeTag: (deviceId: string, tagName: string) => void;

    setFilterTag: (tagName: string | null) => void;
    setFilterUntagged: (enabled: boolean) => void;
    setShowSelectedOnly: (enabled: boolean) => void;

    renameTag: (oldName: string, newName: string) => void;
    deleteTag: (tagName: string) => void;
    updateDeviceSlot: (deviceId: string, newSlot: number) => void;
}


export const useAppStore = create<AppStore>((set, get) => ({
    // Initial state
    devices: [],
    selectedDevices: [],
    selectedDeviceDetail: null,
    actions: [],
    isConnected: false,
    expandedDeviceId: null,
    deviceSlotRegistry: loadSlotRegistry(),

    // Device actions
    setDevices: (devices) => {
        // DEBUG: Log incoming devices
        console.log('[Store] setDevices called with', devices.length, 'devices:', devices.map(d => d.id));

        // DEDUPLICATE: Ensure no duplicate device IDs
        const uniqueDevicesMap = new Map<string, typeof devices[0]>();
        devices.forEach(device => {
            if (!uniqueDevicesMap.has(device.id)) {
                uniqueDevicesMap.set(device.id, device);
            } else {
                console.warn('[Store] Duplicate device ID found:', device.id);
            }
        });
        const uniqueDevices = Array.from(uniqueDevicesMap.values());

        console.log('[Store] After dedup:', uniqueDevices.length, 'unique devices');

        const state = get();
        // Auto-register new devices when setting devices
        const newRegistry = { ...state.deviceSlotRegistry };
        let hasChanges = false;

        uniqueDevices.forEach(device => {
            if (!(device.id in newRegistry)) {
                // Assign next available slot
                const usedSlots = Object.values(newRegistry);
                const nextSlot = usedSlots.length > 0 ? Math.max(...usedSlots) + 1 : 0;
                newRegistry[device.id] = nextSlot;
                hasChanges = true;
            }
        });

        if (hasChanges) {
            saveSlotRegistry(newRegistry);
            set({ devices: uniqueDevices, deviceSlotRegistry: newRegistry });
        } else {
            set({ devices: uniqueDevices });
        }
    },

    registerDeviceSlots: (devices) => {
        const state = get();
        const newRegistry = { ...state.deviceSlotRegistry };
        let hasChanges = false;

        devices.forEach(device => {
            if (!(device.id in newRegistry)) {
                const usedSlots = Object.values(newRegistry);
                const nextSlot = usedSlots.length > 0 ? Math.max(...usedSlots) + 1 : 0;
                newRegistry[device.id] = nextSlot;
                hasChanges = true;
            }
        });

        if (hasChanges) {
            saveSlotRegistry(newRegistry);
            set({ deviceSlotRegistry: newRegistry });
        }
    },

    addDevice: (device) => set((state) => ({
        devices: [...state.devices, device]
    })),

    removeDevice: (id) => set((state) => ({
        devices: state.devices.filter(d => d.id !== id),
        selectedDevices: state.selectedDevices.filter(did => did !== id),
        selectedDeviceDetail: state.selectedDeviceDetail?.id === id ? null : state.selectedDeviceDetail
    })),

    updateDevice: (id, updates) => set((state) => ({
        devices: state.devices.map(d =>
            d.id === id ? { ...d, ...updates } : d
        ),
        selectedDeviceDetail: state.selectedDeviceDetail?.id === id
            ? { ...state.selectedDeviceDetail, ...updates }
            : state.selectedDeviceDetail
    })),

    toggleDeviceSelection: (id) => set((state) => ({
        selectedDevices: state.selectedDevices.includes(id)
            ? state.selectedDevices.filter(d => d !== id)
            : [...state.selectedDevices, id]
    })),

    selectAllDevices: () => set((state) => ({
        selectedDevices: state.devices.map(d => d.id)
    })),

    selectDevice: (id) => set((state) => ({
        selectedDeviceDetail: id ? state.devices.find(d => d.id === id) || null : null
    })),

    clearDeviceSelection: () => set({ selectedDevices: [] }),

    setExpandedDevice: (id) => set({ expandedDeviceId: id }),

    // Real-time updates
    onDeviceStatusChange: (id, status) => set((state) => ({
        devices: state.devices.map(d =>
            d.id === id ? { ...d, status, last_seen: Date.now() } : d
        )
    })),

    onScreenFrameUpdate: (id, frame) => set((state) => ({
        devices: state.devices.map(d =>
            d.id === id ? { ...d, frame } : d
        ),
        selectedDeviceDetail: state.selectedDeviceDetail?.id === id
            ? { ...state.selectedDeviceDetail, frame }
            : state.selectedDeviceDetail
    })),

    // Action handling
    addAction: (action) => set((state) => ({
        actions: [...state.actions, action]
    })),

    updateActionStatus: (actionId, status, result) => set((state) => ({
        actions: state.actions.map(a =>
            a.id === actionId ? { ...a, status, result } : a
        )
    })),

    // Connection state
    setConnected: (connected) => set({ isConnected: connected }),

    // Helper: Get devices sorted by slot position (only currently connected devices)
    getDevicesBySlot: () => {
        const state = get();
        const registry = state.deviceSlotRegistry;
        const devices = state.devices;

        // Create a map of deviceId -> device for quick lookup
        const deviceMap = new Map<string, Device>();
        devices.forEach(d => deviceMap.set(d.id, d));

        // Get all slots sorted by slot index, but ONLY for devices that currently exist
        const slots = Object.entries(registry)
            .filter(([deviceId]) => deviceMap.has(deviceId)) // Only include devices that are currently connected
            .sort((a, b) => a[1] - b[1]);

        // Return array with device for each slot (no nulls since we filtered)
        return slots.map(([deviceId]) => deviceMap.get(deviceId)!);
    },

    expandButtonPosition: { x: 10, y: 10 },
    setExpandButtonPosition: (position) => set({ expandButtonPosition: position }),

    // Tag & Filtering Implementation
    // Load from localStorage if available
    availableTags: (() => {
        try {
            const stored = localStorage.getItem('available_tags');
            return stored ? JSON.parse(stored) : [];
        } catch {
            return [];
        }
    })(),
    filterTag: null,
    filterUntagged: false,
    showSelectedOnly: false,

    addTag: (tagName) => set((state) => {
        if (state.availableTags.includes(tagName)) return state;
        const newTags = [...state.availableTags, tagName];
        localStorage.setItem('available_tags', JSON.stringify(newTags));
        return { availableTags: newTags };
    }),

    assignTag: (deviceId, tagName) => set((state) => ({
        devices: state.devices.map(d => {
            if (d.id === deviceId) {
                const currentTags = d.tags || [];
                if (!currentTags.includes(tagName)) {
                    return { ...d, tags: [...currentTags, tagName] };
                }
            }
            return d;
        })
    })),

    removeTag: (deviceId, tagName) => set((state) => ({
        devices: state.devices.map(d => {
            if (d.id === deviceId && d.tags) {
                return { ...d, tags: d.tags.filter(t => t !== tagName) };
            }
            return d;
        })
    })),

    setFilterTag: (tagName) => set({ filterTag: tagName, filterUntagged: false }),
    setFilterUntagged: (enabled) => set({ filterUntagged: enabled, filterTag: null }),
    setShowSelectedOnly: (enabled) => set({ showSelectedOnly: enabled }),

    renameTag: (oldName: string, newName: string) => set((state) => {
        const newTags = state.availableTags.map(t => t === oldName ? newName : t);
        localStorage.setItem('available_tags', JSON.stringify(newTags));
        return {
            availableTags: newTags,
            devices: state.devices.map(d => {
                if (d.tags?.includes(oldName)) {
                    return { ...d, tags: d.tags.map(t => t === oldName ? newName : t) };
                }
                return d;
            }),
            filterTag: state.filterTag === oldName ? newName : state.filterTag
        };
    }),

    deleteTag: (tagName: string) => set((state) => {
        const newTags = state.availableTags.filter(t => t !== tagName);
        localStorage.setItem('available_tags', JSON.stringify(newTags));
        return {
            availableTags: newTags,
            devices: state.devices.map(d => {
                if (d.tags?.includes(tagName)) {
                    return { ...d, tags: d.tags.filter(t => t !== tagName) };
                }
                return d;
            }),
            filterTag: state.filterTag === tagName ? null : state.filterTag
        };
    }),

    updateDeviceSlot: (deviceId: string, newSlot: number) => set((state) => ({
        deviceSlotRegistry: { ...state.deviceSlotRegistry, [deviceId]: newSlot }
    })),
}));
