import axios from 'axios';
import { API_BASE_URL, API_ENDPOINTS } from '@/utils/constants';
import { Device } from '@/types/device';
import { Action, ActionRequest } from '@/types/action';
import { APIResponse } from '@/types/api';

// Create axios instance with base configuration
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
        const response = await apiClient.get<APIResponse<Device[]>>(API_ENDPOINTS.DEVICES);
        return response.data.data || [];
    },

    /**
     * Scan for new devices
     */
    async scanDevices(): Promise<Device[]> {
        const response = await apiClient.post<APIResponse<Device[]>>(API_ENDPOINTS.DEVICES_SCAN);
        return response.data.data || [];
    },
};

// Action APIs
export const actionAPI = {
    /**
     * Execute action on single device
     */
    async executeAction(deviceId: string, action: ActionRequest['action']): Promise<Action> {
        const response = await apiClient.post<APIResponse<Action>>(API_ENDPOINTS.ACTIONS, {
            device_id: deviceId,
            action,
        });
        return response.data.data!;
    },

    /**
     * Execute batch action on multiple devices
     */
    async executeBatchAction(deviceIds: string[], action: ActionRequest['action']): Promise<Action[]> {
        const response = await apiClient.post<APIResponse<Action[]>>(API_ENDPOINTS.ACTIONS_BATCH, {
            device_ids: deviceIds,
            action,
        });
        return response.data.data || [];
    },
};

export const api = {
    device: deviceAPI,
    action: actionAPI,
};
