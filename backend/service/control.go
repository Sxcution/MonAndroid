package service

import (
	"encoding/binary"
)

// Control message types (scrcpy 3.x protocol)
const (
	CtrlInjectKeycode    = 0
	CtrlInjectText       = 1
	CtrlInjectTouchEvent = 2
	CtrlSetClipboard     = 9
)

// Android key event actions
const (
	ActionDown = 0
	ActionUp   = 1
)

// Android meta state flags
const (
	MetaNone    = 0
	MetaShiftOn = 0x1
	MetaAltOn   = 0x2
	MetaCtrlOn  = 0x1000
	MetaMetaOn  = 0x10000
)

// Common Android keycodes
const (
	AKEYCODE_0           = 7
	AKEYCODE_A           = 29
	AKEYCODE_Z           = 54
	AKEYCODE_TAB         = 61
	AKEYCODE_SPACE       = 62
	AKEYCODE_ENTER       = 66
	AKEYCODE_DEL         = 67 // Backspace
	AKEYCODE_ESCAPE      = 111
	AKEYCODE_FORWARD_DEL = 112 // Delete
	AKEYCODE_DPAD_UP     = 19
	AKEYCODE_DPAD_DOWN   = 20
	AKEYCODE_DPAD_LEFT   = 21
	AKEYCODE_DPAD_RIGHT  = 22
	AKEYCODE_HOME        = 3
	AKEYCODE_BACK        = 4
	AKEYCODE_VOLUME_UP   = 24
	AKEYCODE_VOLUME_DOWN = 25
)

// SerializeKeycode creates a binary message for key injection
// Format: [type:1] [action:1] [keycode:4] [repeat:4] [metastate:4] = 14 bytes
func SerializeKeycode(action, keycode, repeat, metastate int) []byte {
	buf := make([]byte, 14)
	buf[0] = CtrlInjectKeycode
	buf[1] = byte(action)
	binary.BigEndian.PutUint32(buf[2:6], uint32(keycode))
	binary.BigEndian.PutUint32(buf[6:10], uint32(repeat))
	binary.BigEndian.PutUint32(buf[10:14], uint32(metastate))
	return buf
}

// SerializeText creates a binary message for text injection
// Format: [type:1] [length:4] [text:N] = 5+N bytes
// Max text length: 300 bytes (SC_CONTROL_MSG_INJECT_TEXT_MAX_LENGTH)
func SerializeText(text string) []byte {
	textBytes := []byte(text)
	if len(textBytes) > 300 {
		textBytes = textBytes[:300]
	}

	buf := make([]byte, 5+len(textBytes))
	buf[0] = CtrlInjectText
	binary.BigEndian.PutUint32(buf[1:5], uint32(len(textBytes)))
	copy(buf[5:], textBytes)
	return buf
}

// SerializeClipboard creates a binary message for clipboard set
// Format: [type:1] [sequence:8] [paste:1] [length:4] [text:N] = 14+N bytes
func SerializeClipboard(text string, paste bool, sequence uint64) []byte {
	textBytes := []byte(text)

	buf := make([]byte, 14+len(textBytes))
	buf[0] = CtrlSetClipboard
	binary.BigEndian.PutUint64(buf[1:9], sequence)
	if paste {
		buf[9] = 1
	} else {
		buf[9] = 0
	}
	binary.BigEndian.PutUint32(buf[10:14], uint32(len(textBytes)))
	copy(buf[14:], textBytes)
	return buf
}

// SerializeBackOrScreenOn creates a message for back button or screen on
// Format: [type:1] [action:1] = 2 bytes
func SerializeBackOrScreenOn(action int) []byte {
	buf := make([]byte, 2)
	buf[0] = 4 // SC_CONTROL_MSG_TYPE_BACK_OR_SCREEN_ON
	buf[1] = byte(action)
	return buf
}
