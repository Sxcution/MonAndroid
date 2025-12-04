export interface Action {
    id: string;
    device_id: string;
    type: 'tap' | 'swipe' | 'input' | 'key' | 'open_app' | 'install_apk' | 'push_file';
    params: Record<string, any>;
    timestamp: number;
    status: 'pending' | 'executing' | 'done' | 'failed';
    result?: string;
}

export interface ActionRequest {
    device_id?: string;
    device_ids?: string[]; // For batch operations
    action: {
        type: Action['type'];
        params: Record<string, any>;
    };
}

export interface Macro {
    id: string;
    name: string;
    description: string;
    actions: Omit<Action, 'id' | 'device_id' | 'timestamp' | 'status'>[];
    created_at: number;
}
