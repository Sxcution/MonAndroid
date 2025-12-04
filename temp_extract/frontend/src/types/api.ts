export interface APIResponse<T = any> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
}

export interface WebSocketMessage {
    type: 'device_status' | 'screen_frame' | 'action_result' | 'action';
    device_id?: string;
    status?: string;
    frame_data?: string;
    action_id?: string;
    action?: any;
    [key: string]: any;
}
