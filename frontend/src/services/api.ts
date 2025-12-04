import axios from 'axios';
import { API_BASE_URL, ROUTES } from '@/utils/constants';
import { Device } from '@/types/device';
import { ActionRequest, Action } from '@/types/action';
import { APIResponse } from '@/types/api';

// Create axios instance
const apiClient = axios.create({
    baseURL: API_BASE_URL,
    timeout: 10000,
    headers: {
        'Content-Type': 'application/json',
    },
});

// Response interceptor for error handling
apiClient.interceptors.response.use(
    (response) => response,
    (error) => {
        console.error('API Error:', error);
        return Promise.reject(error);
    }
);

// Device APIs
export const deviceAPI = {
    /**
     * Get all devices
     */
    async getDevices(): Promise<Device[]> {
        const response = await apiClient.get<APIResponse<Device[]>>(ROUTES.DEVICES);
        return response.data.data || [];
    },

    /**
     * Get device by ID
     */
    async getDevice(id: string): Promise<Device> {
        const response = await apiClient.get<APIResponse<Device>>(ROUTES.DEVICE_DETAIL(id));
        return response.data.data!;
    },

    /**
     * Scan for new devices
     */
    async scanDevices(): Promise<Device[]> {
        const response = await apiClient.post<APIResponse<Device[]>>(ROUTES.DEVICES + '/scan');
        return response.data.data || [];
    },

    /**
     * Remove device
     */
    async removeDevice(id: string): Promise<void> {
        await apiClient.delete(ROUTES.DEVICE_DETAIL(id));
    },
};

// Action APIs
export const actionAPI = {
    /**
     * Execute action on single device
     */
    async executeAction(deviceId: string, action: ActionRequest['action']): Promise<Action> {
        const response = await apiClient.post<APIResponse<Action>>(ROUTES.ACTIONS, {
            device_id: deviceId,
            action,
        });
        return response.data.data!;
    },

    /**
     * Execute batch action on multiple devices
     */
    async executeBatchAction(deviceIds: string[], action: ActionRequest['action']): Promise<Action[]> {
        const response = await apiClient.post<APIResponse<Action[]>>(ROUTES.ACTIONS_BATCH, {
            device_ids: deviceIds,
            action,
        });
        return response.data.data || [];
    },

    /**
     * Get action status
     */
    async getActionStatus(actionId: string): Promise<Action> {
        const response = await apiClient.get<APIResponse<Action>>(ROUTES.ACTION_DETAIL(actionId));
        return response.data.data!;
    },
};

export const api = {
    device: deviceAPI,
    action: actionAPI,
};
