package models

type Action struct {
	ID        string                 `json:"id"`
	DeviceID  string                 `json:"device_id"`
	Type      string                 `json:"type"` // tap, swipe, input, key, open_app
	Params    map[string]interface{} `json:"params"`
	Timestamp int64                  `json:"timestamp"`
	Status    string                 `json:"status"` // pending, executing, done, failed
	Result    string                 `json:"result,omitempty"`
}

type ActionRequest struct {
	DeviceID  string                 `json:"device_id,omitempty"`
	DeviceIDs []string               `json:"device_ids,omitempty"` // For batch operations
	Action    ActionData             `json:"action"`
}

type ActionData struct {
	Type   string                 `json:"type"`
	Params map[string]interface{} `json:"params"`
}

type Macro struct {
	ID          string       `json:"id"`
	Name        string       `json:"name"`
	Description string       `json:"description"`
	Actions     []ActionData `json:"actions"`
	CreatedAt   int64        `json:"created_at"`
}
