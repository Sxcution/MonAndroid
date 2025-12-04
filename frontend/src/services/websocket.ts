import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '@/store/useAppStore';
import { WS_URL } from '@/utils/constants';
import { WebSocketMessage } from '@/types/api';

/**
 * WebSocket hook for real-time communication with backend
 */
export function useWebSocket() {
    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
    const {
        onDeviceStatusChange,
        onScreenFrameUpdate,
        updateActionStatus,
        setConnected,
    } = useAppStore();

    const connect = useCallback(() => {
        try {
            const ws = new WebSocket(WS_URL);

            ws.onopen = () => {
                console.log('WebSocket connected');
                setConnected(true);
            };

            ws.onmessage = (event) => {
                try {
                    const message: WebSocketMessage = JSON.parse(event.data);

                    switch (message.type) {
                        case 'device_status':
                            if (message.device_id && message.status) {
                                onDeviceStatusChange(message.device_id, message.status as any);
                            }
                            break;

                        case 'screen_frame':
                            if (message.device_id && message.frame_data) {
                                onScreenFrameUpdate(message.device_id, message.frame_data);
                            }
                            break;

                        case 'action_result':
                            if (message.action_id && message.status) {
                                updateActionStatus(message.action_id, message.status as any, message.result);
                            }
                            break;

                        default:
                            console.log('Unknown message type:', message.type);
                    }
                } catch (error) {
                    console.error('Error parsing WebSocket message:', error);
                }
            };

            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
            };

            ws.onclose = () => {
                console.log('WebSocket disconnected');
                setConnected(false);

                // Attempt to reconnect after 3 seconds
                reconnectTimeoutRef.current = setTimeout(() => {
                    console.log('Attempting to reconnect...');
                    connect();
                }, 3000);
            };

            wsRef.current = ws;
        } catch (error) {
            console.error('Error creating WebSocket:', error);
        }
    }, [onDeviceStatusChange, onScreenFrameUpdate, updateActionStatus, setConnected]);

    const disconnect = useCallback(() => {
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
        }
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }
    }, []);

    const sendMessage = useCallback((message: WebSocketMessage) => {
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify(message));
        } else {
            console.warn('WebSocket is not connected');
        }
    }, []);

    useEffect(() => {
        connect();
        return () => disconnect();
    }, [connect, disconnect]);

    return {
        sendMessage,
        isConnected: wsRef.current?.readyState === WebSocket.OPEN,
    };
}
