export interface Device {
    id: string;
    name: string;
    adb_device_id: string;
    status: 'online' | 'offline';
    resolution: string;
    battery: number;
    android_version: string;
    last_seen: number;
    frame?: string; // base64 encoded screen frame
    tags?: string[]; // Device tags
}

export interface DeviceGroup {
    id: string;
    name: string;
    description: string;
    device_ids: string[];
    created_at: number;
}
