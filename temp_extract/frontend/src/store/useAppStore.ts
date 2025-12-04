import { create } from 'zustand';
import { Device } from '@/types/device';
import { Action } from '@/types/action';

interface AppStore {
    // Device state
    devices: Device[];
    selectedDevices: string[];
    selectedDeviceDetail: Device | null;

    // Action state
    actions: Action[];

    // UI state
    isConnected: boolean;

    // Device actions
    setDevices: (devices: Device[]) => void;
    addDevice: (device: Device) => void;
    removeDevice: (id: string) => void;
    updateDevice: (id: string, updates: Partial<Device>) => void;
    toggleDeviceSelection: (id: string) => void;
    selectDevice: (id: string | null) => void;
    clearDeviceSelection: () => void;

    // Real-time updates
    onDeviceStatusChange: (id: string, status: 'online' | 'offline') => void;
    onScreenFrameUpdate: (id: string, frame: string) => void;

    // Action handling
    addAction: (action: Action) => void;
    updateActionStatus: (actionId: string, status: Action['status'], result?: string) => void;

    // Connection state
    setConnected: (connected: boolean) => void;
}

export const useAppStore = create<AppStore>((set) => ({
    // Initial state
    devices: [],
    selectedDevices: [],
    selectedDeviceDetail: null,
    actions: [],
    isConnected: false,

    // Device actions
    setDevices: (devices) => set({ devices }),

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

    selectDevice: (id) => set((state) => ({
        selectedDeviceDetail: id ? state.devices.find(d => d.id === id) || null : null
    })),

    clearDeviceSelection: () => set({ selectedDevices: [] }),

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
}));
