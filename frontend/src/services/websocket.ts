import { WS_URL } from '@/utils/constants';

type MessageHandler = (data: ArrayBuffer | string) => void;

class WebSocketService {
    private ws: WebSocket | null = null;
    private subscribers: Set<MessageHandler> = new Set();
    private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    private isConnecting = false;

    // Track device subscriptions - will auto-resubscribe on reconnect
    private deviceSubs = new Set<string>();
    // Queue messages when socket is not open
    private sendQueue: string[] = [];

    constructor() {
        this.connect();
    }

    private connect() {
        if (this.ws?.readyState === WebSocket.OPEN || this.isConnecting) return;

        this.isConnecting = true;
        console.log('🔌 WebSocket Connecting to', WS_URL);

        this.ws = new WebSocket(WS_URL);
        this.ws.binaryType = 'arraybuffer';

        this.ws.onopen = () => {
            console.log('✅ WebSocket Connected');
            this.isConnecting = false;

            // Re-subscribe all tracked devices after reconnect
            if (this.deviceSubs.size > 0) {
                console.log(`🔄 Re-subscribing ${this.deviceSubs.size} devices...`);
                for (const deviceId of this.deviceSubs) {
                    this.ws!.send(JSON.stringify({ type: 'subscribe', device_id: deviceId }));
                }
            }

            // Flush any queued messages
            while (this.sendQueue.length > 0) {
                const msg = this.sendQueue.shift()!;
                this.ws!.send(msg);
            }
        };

        this.ws.onmessage = (event) => {
            // Dispatch to all listening components
            this.subscribers.forEach(handler => handler(event.data));
        };

        this.ws.onclose = () => {
            console.log('❌ WebSocket Disconnected');
            this.isConnecting = false;
            this.scheduleReconnect();
        };

        this.ws.onerror = (err) => {
            console.error('⚠️ WebSocket Error', err);
            this.isConnecting = false;
        };
    }

    private scheduleReconnect() {
        if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
        this.reconnectTimeout = setTimeout(() => {
            console.log('🔄 Attempting reconnect...');
            this.connect();
        }, 2000);
    }

    // Components register to receive binary data
    public subscribe(handler: MessageHandler) {
        this.subscribers.add(handler);
        return () => {
            this.subscribers.delete(handler);
        };
    }

    // Subscribe to a specific device's stream (tracked for reconnect)
    public subscribeDevice(deviceId: string) {
        this.deviceSubs.add(deviceId);
        this.sendMessage({ type: 'subscribe', device_id: deviceId });
    }

    // Unsubscribe from a device's stream
    public unsubscribeDevice(deviceId: string) {
        this.deviceSubs.delete(deviceId);
        this.sendMessage({ type: 'unsubscribe', device_id: deviceId });
    }

    public sendMessage(msg: any) {
        const payload = typeof msg === 'string' ? msg : JSON.stringify(msg);
        if (this.ws?.readyState === WebSocket.OPEN) {
            this.ws.send(payload);
        } else {
            // Queue message to be sent when connection is restored
            this.sendQueue.push(payload);
        }
    }

    public get isConnected() {
        return this.ws?.readyState === WebSocket.OPEN;
    }
}

// Singleton instance
export const wsService = new WebSocketService();
