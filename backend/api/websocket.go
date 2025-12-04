package api

import (
	"androidcontrol/service"
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

const (
	writeWait  = 5 * time.Second  // ⚡ Giảm từ 10s xuống 5s
	pongWait   = 60 * time.Second
	pingPeriod = (pongWait * 9) / 10 // 54 seconds
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for development
	},
	ReadBufferSize:  1024,
	WriteBufferSize: 2 * 1024 * 1024, // 2MB for H.264 frames
}

type Client struct {
	hub        *WebSocketHub
	conn       *websocket.Conn
	send       chan []byte // Buffered channel for binary frames
	subscribed map[string]bool
	ss         *service.StreamingService // Reference tới StreamingService để lấy cached headers
}

type WebSocketHub struct {
	clients    map[*Client]bool
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex
}

func NewWebSocketHub() *WebSocketHub {
	return &WebSocketHub{
		clients:    make(map[*Client]bool),
		register:   make(chan *Client),
		unregister: make(chan *Client),
	}
}

func (h *WebSocketHub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()
			log.Printf("Client connected (total: %d)", len(h.clients))

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.send)
			}
			h.mu.Unlock()
			log.Printf("Client disconnected (total: %d)", len(h.clients))
		}
	}
}

// BroadcastToDevice sends message to clients subscribed to a specific device
// message can be []byte (binary H.264 frame) or map (JSON control message)
func (h *WebSocketHub) BroadcastToDevice(deviceID string, message interface{}) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	var messageBytes []byte

	// Handle both binary and JSON messages
	switch msg := message.(type) {
	case []byte:
		// Binary message (H.264 frame with length prefix)
		messageBytes = msg
	default:
		// JSON message
		var err error
		messageBytes, err = json.Marshal(message)
		if err != nil {
			log.Printf("Failed to marshal message: %v", err)
			return
		}
	}

	subscribedCount := 0
	for client := range h.clients {
		// Send to clients subscribed to this device or subscribed to all
		if client.subscribed[deviceID] || client.subscribed["all"] {
			subscribedCount++
			// ⚡ Queue nhỏ + drop: nếu queue đầy -> drop frame cũ, giữ mới nhất
			select {
			case client.send <- messageBytes:
				// Success
			default:
				// Queue đầy -> drop frame cũ, giữ mới nhất
				select {
				case <-client.send: // Drop oldest
				default:
				}
				select {
				case client.send <- messageBytes: // Try to send new
				default:
					// Still full, skip this frame
				}
			}
		}
	}

	// Only log non-H.264 frames to reduce spam
	if _, isBinary := message.([]byte); !isBinary {
		log.Printf("📡 WebSocket: Sent %d bytes to %d/%d clients for device %s",
			len(messageBytes), subscribedCount, len(h.clients), deviceID)
	}
}

// BroadcastToAll sends a message to all connected clients
func (h *WebSocketHub) BroadcastToAll(message interface{}) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	messageBytes, err := json.Marshal(message)
	if err != nil {
		log.Printf("Failed to marshal message: %v", err)
		return
	}

	for client := range h.clients {
		select {
		case client.send <- messageBytes:
		default:
			log.Printf("⚠️ Client channel full, skipping")
		}
	}
}

func HandleWebSocket(hub *WebSocketHub, ss *service.StreamingService, c *gin.Context) {
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}

	client := &Client{
		hub:        hub,
		conn:       conn,
		send:       make(chan []byte, 3), // ⚡ Giảm queue xuống 2-3 để tránh backlog
		subscribed: make(map[string]bool),
		ss:         ss, // Gán service
	}

	// ❌ XÓA: Đừng auto subscribe tất cả nữa! Client chỉ nhận video của device nó subscribe
	// client.subscribed["all"] = true

	client.hub.register <- client

	// Start goroutines for reading and writing
	go client.writePump()
	go client.readPump()
}

// readPump handles incoming messages from the client (subscriptions)
func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(64 << 20) // ⚡ 64MB frame limit để không choke khi burst
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})

	for {
		_, message, err := c.conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error: %v", err)
			}
			break
		}

		// Handle subscription messages
		var msg map[string]interface{}
		if err := json.Unmarshal(message, &msg); err == nil {
			if msgType, ok := msg["type"].(string); ok {
				switch msgType {
				case "subscribe":
					if deviceID, ok := msg["device_id"].(string); ok {
						c.subscribed[deviceID] = true
						log.Printf("Client subscribed to device %s", deviceID)

						// 🔥 THÊM ĐOẠN NÀY: Tự động Start Streaming khi có người xem
						if c.ss != nil {
							// Gọi StartStreaming ngay tại đây (Goroutine để không block)
							go func(id string) {
								if err := c.ss.StartStreaming(id); err != nil {
									log.Printf("Auto-start stream failed for %s: %v", id, err)
								}
							}(deviceID)

							// Logic gửi cached header cũ giữ nguyên...
							sps, pps := c.ss.GetStreamHeaders(deviceID)
							if sps != nil {
								select {
								case c.send <- sps:
								default:
									log.Printf("⚠️ Failed to send cached SPS (channel full)")
								}
							}
							if pps != nil {
								select {
								case c.send <- pps:
								default:
									log.Printf("⚠️ Failed to send cached PPS (channel full)")
								}
							}
						}
					}
				case "unsubscribe":
					if deviceID, ok := msg["device_id"].(string); ok {
						delete(c.subscribed, deviceID)
						log.Printf("Client unsubscribed from device %s", deviceID)
					}
				}
			}
		}
	}
}

// writePump handles outgoing messages to the client (H.264 frames + ping)
func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()

	for {
		select {
		case frame, ok := <-c.send:
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			// ⚡ Coalesce backlog: chỉ giữ frame mới nhất để tránh nghẽn
			drain := frame
			for i := 0; i < len(c.send) && i < 5; i++ {
				select {
				case nextFrame := <-c.send:
					drain = nextFrame // Giữ frame mới nhất
				default:
					break
				}
			}

			c.conn.SetWriteDeadline(time.Now().Add(writeWait))

			// Detect if this is binary (H.264) or JSON
			isBinary := len(drain) > 4 && (drain[0] != '{' && drain[0] != '[')

			if isBinary {
				// Send as BinaryMessage using NextWriter for better performance
				w, err := c.conn.NextWriter(websocket.BinaryMessage)
				if err != nil {
					return
				}
				if _, err = w.Write(drain); err != nil {
					w.Close()
					return
				}
				if err := w.Close(); err != nil {
					return
				}
			} else {
				// Send as TextMessage (JSON)
				if err := c.conn.WriteMessage(websocket.TextMessage, drain); err != nil {
					return
				}
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
