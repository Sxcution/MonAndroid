// API Configuration
export const API_BASE_URL = 'http://localhost:8080/api';
export const WS_URL = 'ws://localhost:8080/ws';

// API Endpoints
export const API_ENDPOINTS = {
    DEVICES: '/devices',
    DEVICES_SCAN: '/devices/scan',
    ACTIONS: '/actions',
    ACTIONS_BATCH: '/actions/batch',
    STREAMING_START: '/streaming/start',
    STREAMING_STOP: '/streaming/stop',
    STREAMING_START_ALL: '/streaming/start-all',
    STREAMING_STOP_ALL: '/streaming/stop-all',
    STREAMING_STATUS: '/streaming/status',
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
