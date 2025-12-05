// Android keycode mappings for keyboard events
// Reference: https://developer.android.com/reference/android/view/KeyEvent

// JavaScript key codes to Android keycodes
export const JS_TO_ANDROID: Record<string, number> = {
    // Letters A-Z
    'KeyA': 29, 'KeyB': 30, 'KeyC': 31, 'KeyD': 32, 'KeyE': 33,
    'KeyF': 34, 'KeyG': 35, 'KeyH': 36, 'KeyI': 37, 'KeyJ': 38,
    'KeyK': 39, 'KeyL': 40, 'KeyM': 41, 'KeyN': 42, 'KeyO': 43,
    'KeyP': 44, 'KeyQ': 45, 'KeyR': 46, 'KeyS': 47, 'KeyT': 48,
    'KeyU': 49, 'KeyV': 50, 'KeyW': 51, 'KeyX': 52, 'KeyY': 53,
    'KeyZ': 54,

    // Numbers 0-9
    'Digit0': 7, 'Digit1': 8, 'Digit2': 9, 'Digit3': 10, 'Digit4': 11,
    'Digit5': 12, 'Digit6': 13, 'Digit7': 14, 'Digit8': 15, 'Digit9': 16,

    // Function keys
    'Enter': 66,
    'Backspace': 67,
    'Delete': 112,
    'Tab': 61,
    'Space': 62,
    'Escape': 111,

    // Arrow keys
    'ArrowUp': 19,
    'ArrowDown': 20,
    'ArrowLeft': 21,
    'ArrowRight': 22,

    // Modifiers (for reference, usually handled via metastate)
    'ShiftLeft': 59, 'ShiftRight': 60,
    'ControlLeft': 113, 'ControlRight': 114,
    'AltLeft': 57, 'AltRight': 58,

    // Navigation
    'Home': 122,
    'End': 123,
    'PageUp': 92,
    'PageDown': 93,

    // Symbols (main keyboard)
    'Minus': 69,        // -
    'Equal': 70,        // =
    'BracketLeft': 71,  // [
    'BracketRight': 72, // ]
    'Backslash': 73,    // \
    'Semicolon': 74,    // ;
    'Quote': 75,        // '
    'Comma': 55,        // ,
    'Period': 56,       // .
    'Slash': 76,        // /
    'Backquote': 68,    // `

    // Numpad
    'Numpad0': 144, 'Numpad1': 145, 'Numpad2': 146, 'Numpad3': 147, 'Numpad4': 148,
    'Numpad5': 149, 'Numpad6': 150, 'Numpad7': 151, 'Numpad8': 152, 'Numpad9': 153,
    'NumpadAdd': 157,
    'NumpadSubtract': 156,
    'NumpadMultiply': 155,
    'NumpadDivide': 154,
    'NumpadDecimal': 158,
    'NumpadEnter': 160,
};

// Android meta state flags
export const META_NONE = 0;
export const META_SHIFT = 0x1;
export const META_ALT = 0x2;
export const META_CTRL = 0x1000;
export const META_META = 0x10000; // Windows/Command key

// Get Android keycode from JavaScript KeyboardEvent
export function getAndroidKeycode(e: { code: string }): number | null {
    return JS_TO_ANDROID[e.code] ?? null;
}

// Get meta state from KeyboardEvent
export function getMetaState(e: { shiftKey: boolean; altKey: boolean; ctrlKey: boolean; metaKey: boolean }): number {
    let meta = 0;
    if (e.shiftKey) meta |= META_SHIFT;
    if (e.altKey) meta |= META_ALT;
    if (e.ctrlKey) meta |= META_CTRL;
    if (e.metaKey) meta |= META_META;
    return meta;
}

// Check if this is a printable character (for text injection)
export function isPrintableKey(e: { key: string; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): boolean {
    // Single character keys that should be injected as text
    return e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey;
}
