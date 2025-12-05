import { create } from 'zustand';

// LocalStorage key
const SETTINGS_KEY = 'app_settings';

interface AppSettings {
    targetFps: number; // 5-30
    showFpsIndicator: boolean;
    showDeviceName: boolean;
}

const DEFAULT_SETTINGS: AppSettings = {
    targetFps: 30,
    showFpsIndicator: true,
    showDeviceName: true,
};

// Load settings from localStorage
const loadSettings = (): AppSettings => {
    try {
        const stored = localStorage.getItem(SETTINGS_KEY);
        return stored ? { ...DEFAULT_SETTINGS, ...JSON.parse(stored) } : DEFAULT_SETTINGS;
    } catch {
        return DEFAULT_SETTINGS;
    }
};

// Save settings to localStorage
const saveSettings = (settings: AppSettings) => {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
        console.error('Failed to save settings:', e);
    }
};

interface SettingsStore extends AppSettings {
    setTargetFps: (fps: number) => void;
    toggleFpsIndicator: () => void;
    toggleDeviceName: () => void;
    updateSettings: (partial: Partial<AppSettings>) => void;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
    // Initial state from localStorage
    ...loadSettings(),

    setTargetFps: (fps) => {
        const newSettings = { ...get(), targetFps: fps };
        set({ targetFps: fps });
        saveSettings({ targetFps: newSettings.targetFps, showFpsIndicator: newSettings.showFpsIndicator, showDeviceName: newSettings.showDeviceName });
    },

    toggleFpsIndicator: () => {
        const newValue = !get().showFpsIndicator;
        const newSettings = { ...get(), showFpsIndicator: newValue };
        set({ showFpsIndicator: newValue });
        saveSettings({ targetFps: newSettings.targetFps, showFpsIndicator: newSettings.showFpsIndicator, showDeviceName: newSettings.showDeviceName });
    },

    toggleDeviceName: () => {
        const newValue = !get().showDeviceName;
        const newSettings = { ...get(), showDeviceName: newValue };
        set({ showDeviceName: newValue });
        saveSettings({ targetFps: newSettings.targetFps, showFpsIndicator: newSettings.showFpsIndicator, showDeviceName: newSettings.showDeviceName });
    },

    updateSettings: (partial) => {
        const current = get();
        const updated = {
            targetFps: partial.targetFps ?? current.targetFps,
            showFpsIndicator: partial.showFpsIndicator ?? current.showFpsIndicator,
            showDeviceName: partial.showDeviceName ?? current.showDeviceName,
        };
        set(updated);
        saveSettings(updated);
    },
}));
