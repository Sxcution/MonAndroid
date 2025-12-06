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
        const state = get();
        // Auto-register new devices when setting devices
        const newRegistry = { ...state.deviceSlotRegistry };
        let hasChanges = false;

        devices.forEach(device => {
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
            set({ devices, deviceSlotRegistry: newRegistry });
        } else {
            set({ devices });
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

    // Helper: Get devices sorted by slot position (including empty slots)
    getDevicesBySlot: () => {
        const state = get();
        const registry = state.deviceSlotRegistry;
        const devices = state.devices;

        // Create a map of deviceId -> device for quick lookup
        const deviceMap = new Map<string, Device>();
        devices.forEach(d => deviceMap.set(d.id, d));

        // Get all slots sorted by slot index
        const slots = Object.entries(registry).sort((a, b) => a[1] - b[1]);

        // Return array with device or null for each slot
        return slots.map(([deviceId, _slotIdx]) => deviceMap.get(deviceId) || null);
    },

    expandButtonPosition: { x: 10, y: 10 },
    setExpandButtonPosition: (position) => set({ expandButtonPosition: position }),
}));
