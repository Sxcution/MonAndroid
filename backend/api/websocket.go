package api

import (
	"androidcontrol/service"
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

const (
	writeWait  = 10 * time.Second
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
	closed     atomic.Bool               // Cờ đóng an toàn - tránh race condition
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
				client.closed.Store(true) // Đánh dấu closed - KHÔNG close(client.send)
				// Channel sẽ được GC thu gom
			}
			h.mu.Unlock()
			log.Printf("Client disconnected (total: %d)", len(h.clients))
		}
	}
}

// trySend sends message with drop-oldest policy, safe for concurrent use
func (c *Client) trySend(msg []byte) {
	if c.closed.Load() {
		return
	}
	select {
	case c.send <- msg:
		return
	default:
		// Channel full - drop oldest frame(s)
		select {
		case <-c.send: // Drop oldest
			select {
			case c.send <- msg:
			default:
			}
		default:
		}
	}
}

// drainAndSend clears all pending frames then sends the message
// Used for critical data like SPS/PPS/IDR on subscribe to ensure delivery
func (c *Client) drainAndSend(msg []byte) {
	if c.closed.Load() {
		return
	}
	// Drain old frames (they're stale for a new subscriber anyway)
	for len(c.send) > 0 {
		select {
		case <-c.send:
		default:
		}
	}
	// Send critical data
	select {
	case c.send <- msg:
	default:
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
			client.trySend(messageBytes) // Sử dụng trySend an toàn
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
		client.trySend(messageBytes) // Sử dụng trySend an toàn
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
		send:       make(chan []byte, 16), // Real-time mode: small buffer, drop old frames
		subscribed: make(map[string]bool),
		ss:         ss, // Gán service
	}

	client.hub.register <- client

	// Start goroutines for reading and writing
	go client.writePump()
	go client.readPump()
}

// readPump handles incoming messages from the client (subscriptions)
func (c *Client) readPump() {
	defer func() {
		// Warm session: decrement viewer count for all subscribed devices
		if c.ss != nil {
			for deviceID := range c.subscribed {
				c.ss.RemoveViewer(deviceID)
			}
		}
		c.hub.unregister <- c
		c.conn.Close()
	}()

	c.conn.SetReadLimit(1 << 20) // 1MB max message size
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

						// Warm session: increment viewer count
						if c.ss != nil {
							c.ss.AddViewer(deviceID)

							// Send cached SPS + PPS + IDR separately (frontend expects 1 NAL per message)
							sps, pps, idr := c.ss.GetStreamData(deviceID)
							if sps != nil {
								c.drainAndSend(sps) // Drain old frames, send SPS
							}
							if pps != nil {
								c.trySend(pps)
							}
							if idr != nil {
								log.Printf("⚡ Sending cached SPS+PPS+IDR to new subscriber for %s", deviceID)
								c.trySend(idr)
							}
						}
					}
				case "unsubscribe":
					if deviceID, ok := msg["device_id"].(string); ok {
						delete(c.subscribed, deviceID)
						log.Printf("Client unsubscribed from device %s", deviceID)

						// Warm session: decrement viewer count
						if c.ss != nil {
							c.ss.RemoveViewer(deviceID)
						}
					}

				case "key":
					// Keyboard key press/release
					if c.ss != nil {
						deviceID, _ := msg["device_id"].(string)
						action := int(msg["action"].(float64)) // 0=down, 1=up
						keycode := int(msg["keycode"].(float64))
						meta := 0
						if m, ok := msg["meta"].(float64); ok {
							meta = int(m)
						}
						if err := c.ss.SendKeyEvent(deviceID, action, keycode, meta); err != nil {
							log.Printf("⚠️ Key event failed: %v", err)
						}
					}

				case "text":
					// Direct text injection
					if c.ss != nil {
						deviceID, _ := msg["device_id"].(string)
						text, _ := msg["text"].(string)
						if err := c.ss.SendText(deviceID, text); err != nil {
							log.Printf("⚠️ Text injection failed: %v", err)
						}
					}

				case "clipboard":
					// Clipboard set/paste
					if c.ss != nil {
						deviceID, _ := msg["device_id"].(string)
						text, _ := msg["text"].(string)
						paste := false
						if p, ok := msg["paste"].(bool); ok {
							paste = p
						}
						if err := c.ss.SendClipboard(deviceID, text, paste); err != nil {
							log.Printf("⚠️ Clipboard operation failed: %v", err)
						} else {
							log.Printf("📋 Clipboard %s for %s (%d chars)", map[bool]string{true: "pasted", false: "set"}[paste], deviceID, len(text))
						}
					}

				case "request-keyframe":
					// Client requesting keyframe (e.g., after stall or decoder reset)
					if c.ss != nil {
						deviceID, _ := msg["device_id"].(string)
						if deviceID == "" {
							break
						}
						// Send SPS+PPS+IDR as separate packets
						sps, pps, idr := c.ss.GetStreamData(deviceID)
						if sps != nil {
							c.drainAndSend(sps) // Drain old frames, send SPS
						}
						if pps != nil {
							c.trySend(pps)
						}
						if idr != nil {
							c.trySend(idr)
						}
					}
				}
			}
		}
	}
}

// firstNonSpace returns the first non-whitespace byte
func firstNonSpace(b []byte) byte {
	for _, c := range b {
		if c != ' ' && c != '\n' && c != '\r' && c != '\t' {
			return c
		}
	}
	return 0
}

// isJSONPayload detects if payload is JSON (starts with { or [)
func isJSONPayload(b []byte) bool {
	if len(b) == 0 {
		return false
	}
	c := firstNonSpace(b)
	return c == '{' || c == '['
}

// writePump handles outgoing messages to the client (H.264 frames + ping)
func (c *Client) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
		c.closed.Store(true) // Chốt cửa - không close(c.send) để GC thu gom
	}()

	for {
		select {
		case frame, ok := <-c.send:
			if !ok || c.closed.Load() {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			c.conn.SetWriteDeadline(time.Now().Add(writeWait))

			// Detect Binary vs JSON using robust check
			msgType := websocket.BinaryMessage
			if isJSONPayload(frame) {
				msgType = websocket.TextMessage
			}

			if err := c.conn.WriteMessage(msgType, frame); err != nil {
				return
			}

		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}
