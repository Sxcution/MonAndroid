import { useEffect, useState, useCallback, useRef } from 'react';
import { WS_URL } from '@/utils/constants';

export function useWebSocket() {
    const [isConnected, setIsConnected] = useState(false);
    const [lastMessage, setLastMessage] = useState<string | ArrayBuffer | null>(null);
    const wsRef = useRef<WebSocket | null>(null);

    useEffect(() => {
        let reconnectTimeout: NodeJS.Timeout;
        let isComponentMounted = true;

        const connect = () => {
            if (!isComponentMounted) return;

            const ws = new WebSocket(WS_URL);
            ws.binaryType = 'arraybuffer'; // Important: receive binary as ArrayBuffer
            wsRef.current = ws;

            ws.onopen = () => {
                console.log('WebSocket connected');
                setIsConnected(true);
            };

            ws.onmessage = (event) => {
                // Handle both binary (ArrayBuffer) and text (string) messages
                setLastMessage(event.data);
            };

            ws.onerror = (error) => {
                console.error('WebSocket error:', error);
            };

            ws.onclose = () => {
                console.log('WebSocket disconnected');
                setIsConnected(false);

                if (isComponentMounted) {
                    console.log('Attempting to reconnect...');
                    reconnectTimeout = setTimeout(connect, 2000);
                }
            };
        };

        connect();

        return () => {
            isComponentMounted = false;
            clearTimeout(reconnectTimeout);
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                wsRef.current.close();
            }
        };
    }, []);

    const sendMessage = useCallback((message: any) => {
        const ws = wsRef.current;

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(message));
        } else {
            console.warn('WebSocket is not connected, will retry...');
            // Retry after a short delay
            setTimeout(() => {
                if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
                    wsRef.current.send(JSON.stringify(message));
                }
            }, 500);
        }
    }, []);

    return {
        isConnected,
        lastMessage,
        sendMessage,
    };
}
