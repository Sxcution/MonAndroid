import { WS_URL } from '@/utils/constants';

type MessageHandler = (data: ArrayBuffer | string) => void;

class WebSocketService {
    private ws: WebSocket | null = null;
    private subscribers: Set<MessageHandler> = new Set();
    private reconnectTimeout: NodeJS.Timeout | null = null;
    private isConnecting = false;

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
        };

        this.ws.onmessage = (event) => {
            // Phát tin nhắn tới tất cả component đang lắng nghe
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

    // Các component sẽ gọi hàm này để đăng ký nhận dữ liệu
    public subscribe(handler: MessageHandler) {
        this.subscribers.add(handler);
        return () => {
            this.subscribers.delete(handler);
        };
    }

    public sendMessage(msg: any) {
        if (this.ws?.readyState === WebSocket.OPEN) {
            const payload = typeof msg === 'string' ? msg : JSON.stringify(msg);
            this.ws.send(payload);
        } else {
            console.warn('⚠️ Cannot send message: WebSocket not open');
        }
    }

    public get isConnected() {
        return this.ws?.readyState === WebSocket.OPEN;
    }
}

// Xuất ra 1 instance duy nhất (Singleton)
export const wsService = new WebSocketService();
