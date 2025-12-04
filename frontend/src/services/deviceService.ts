import { api } from './api';
import { ActionRequest } from '@/types/action';
import { ACTION_TYPES, KEY_CODES } from '@/utils/constants';

/**
 * Device service with high-level device control operations
 */
export const deviceService = {
    /**
     * Tap at coordinates
     */
    async tap(deviceId: string, x: number, y: number) {
        return api.action.executeAction(deviceId, {
            type: ACTION_TYPES.TAP,
            params: { x, y },
        });
    },

    /**
     * Swipe from one point to another
     */
    async swipe(deviceId: string, x1: number, y1: number, x2: number, y2: number, duration: number = 300) {
        return api.action.executeAction(deviceId, {
            type: ACTION_TYPES.SWIPE,
            params: { x1, y1, x2, y2, duration },
        });
    },

    /**
     * Input text
     */
    async input(deviceId: string, text: string) {
        return api.action.executeAction(deviceId, {
            type: ACTION_TYPES.INPUT,
            params: { text },
        });
    },

    /**
     * Press key
     */
    async pressKey(deviceId: string, keycode: number) {
        return api.action.executeAction(deviceId, {
            type: ACTION_TYPES.KEY,
            params: { keycode },
        });
    },

    /**
     * Open app by package name
     */
    async openApp(deviceId: string, packageName: string) {
        return api.action.executeAction(deviceId, {
            type: ACTION_TYPES.OPEN_APP,
            params: { package: packageName },
        });
    },

    /**
     * Install APK
     */
    async installApk(deviceId: string, apkPath: string) {
        return api.action.executeAction(deviceId, {
            type: ACTION_TYPES.INSTALL_APK,
            params: { apk_path: apkPath },
        });
    },

    /**
     * Push file to device
     */
    async pushFile(deviceId: string, localPath: string, remotePath: string) {
        return api.action.executeAction(deviceId, {
            type: ACTION_TYPES.PUSH_FILE,
            params: { local: localPath, remote: remotePath },
        });
    },

    /**
     * Batch operations
     */
    async batchTap(deviceIds: string[], x: number, y: number) {
        return api.action.executeBatchAction(deviceIds, {
            type: ACTION_TYPES.TAP,
            params: { x, y },
        });
    },

    async batchInput(deviceIds: string[], text: string) {
        return api.action.executeBatchAction(deviceIds, {
            type: ACTION_TYPES.INPUT,
            params: { text },
        });
    },

    /**
     * Common key shortcuts
     */
    async goBack(deviceId: string) {
        return this.pressKey(deviceId, KEY_CODES.BACK);
    },

    async goHome(deviceId: string) {
        return this.pressKey(deviceId, KEY_CODES.HOME);
    },

    async openMenu(deviceId: string) {
        return this.pressKey(deviceId, KEY_CODES.MENU);
    },

    /**
     * Send key event (alias for pressKey for compatibility)
     */
    async sendKey(deviceId: string, keycode: number) {
        return this.pressKey(deviceId, keycode);
    },
};
