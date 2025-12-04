package api

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins for development
	},
	ReadBufferSize:  1024,
	WriteBufferSize: 1024 * 1024, // 1MB for screen frames
}

type Client struct {
	hub        *WebSocketHub
	conn       *websocket.Conn
	send       chan []byte
	deviceID   string // Subscribe to specific device
	subscribed map[string]bool
}

type WebSocketHub struct {
	clients    map[*Client]bool
	broadcast  chan interface{}
	register   chan *Client
	unregister chan *Client
	mu         sync.RWMutex
}

func NewWebSocketHub() *WebSocketHub {
	return &WebSocketHub{
		clients:    make(map[*Client]bool),
		broadcast:  make(chan interface{}, 256),
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

		case message := <-h.broadcast:
			h.mu.RLock()
			messageBytes, _ := json.Marshal(message)
			for client := range h.clients {
				select {
				case client.send <- messageBytes:
				default:
					close(client.send)
					delete(h.clients, client)
				}
			}
			h.mu.RUnlock()
		}
	}
}

// BroadcastToDevice sends a message to all clients subscribed to a specific device
func (h *WebSocketHub) BroadcastToDevice(deviceID string, message interface{}) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	messageBytes, err := json.Marshal(message)
	if err != nil {
		log.Printf("Failed to marshal message: %v", err)
		return
	}

	subscribedCount := 0
	for client := range h.clients {
		// Send to clients subscribed to this device or subscribed to all
		if client.subscribed[deviceID] || client.subscribed["all"] {
			subscribedCount++
			select {
			case client.send <- messageBytes:
			default:
				// Channel full, skip this client
				log.Printf("⚠️ Client channel full, skipping")
			}
		}
	}
	
	log.Printf("📡 WebSocket: Sent %d bytes to %d/%d clients subscribed to device %s", 
		len(messageBytes), subscribedCount, len(h.clients), deviceID)
}

// BroadcastToAll sends a message to all connected clients
func (h *WebSocketHub) BroadcastToAll(message interface{}) {
	h.broadcast <- message
}

func HandleWebSocket(hub *WebSocketHub, c *gin.Context) {
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}

	client := &Client{
		hub:        hub,
		conn:       conn,
		send:       make(chan []byte, 10), // Increased buffer for large frames
		subscribed: make(map[string]bool),
	}

	// Default: subscribe to all devices
	client.subscribed["all"] = true

	client.hub.register <- client

	// Start goroutines for reading and writing
	go client.writePump()
	go client.readPump()
}

// readPump handles incoming messages from the client
func (c *Client) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()

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
					}
				case "unsubscribe":
					if deviceID, ok := msg["device_id"].(string); ok {
						delete(c.subscribed, deviceID)
						log.Printf("Client unsubscribed from device %s", deviceID)
					}
				case "ping":
					// Respond with pong
					pong := map[string]string{"type": "pong"}
					if pongBytes, err := json.Marshal(pong); err == nil {
						c.send <- pongBytes
					}
				}
			}
		}
	}
}

// writePump handles outgoing messages to the client
func (c *Client) writePump() {
	defer func() {
		c.conn.Close()
	}()

	for {
		select {
		case message, ok := <-c.send:
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{})
				return
			}

			if err := c.conn.WriteMessage(websocket.TextMessage, message); err != nil {
				return
			}
		}
	}
}
