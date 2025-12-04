export const API_BASE_URL = 'http://localhost:8080';
export const WS_URL = 'ws://localhost:8081/ws';

export const ROUTES = {
    DEVICES: '/api/devices',
    DEVICE_DETAIL: (id: string) => `/api/devices/${id}`,
    DEVICE_SCAN: (id: string) => `/api/devices/${id}/scan`,
    ACTIONS: '/api/actions',
    ACTIONS_BATCH: '/api/actions/batch',
    ACTION_DETAIL: (id: string) => `/api/actions/${id}`,
    PROFILES: '/api/profiles',
    PROFILE_DETAIL: (id: string) => `/api/profiles/${id}`,
} as const;

export const ACTION_TYPES = {
    TAP: 'tap',
    SWIPE: 'swipe',
    INPUT: 'input',
    KEY: 'key',
    OPEN_APP: 'open_app',
    INSTALL_APK: 'install_apk',
    PUSH_FILE: 'push_file',
} as const;

export const KEY_CODES = {
    BACK: 4,
    HOME: 3,
    MENU: 82,
    POWER: 26,
    VOLUME_UP: 24,
    VOLUME_DOWN: 25,
    ENTER: 66,
} as const;

export const SCREEN_REFRESH_RATE = 30; // FPS
export const SCREEN_REFRESH_INTERVAL = 1000 / SCREEN_REFRESH_RATE;
