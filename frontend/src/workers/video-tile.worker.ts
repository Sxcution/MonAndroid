/**
 * Video Tile Worker - Handles H.264 decoding with watchdog and throttle
 * Runs in a Web Worker to offload main thread
 */

// ==== GLOBALS ====
let ws: WebSocket | null = null;
let wsUrl = "";
let deviceId = "";
let paused = false;
let terminated = false;
let hasConfigured = false;
let lastOutput = performance.now();
let lastKeyframeRequestTime = 0;

// Decoder globals
let decoder: VideoDecoder | null = null;
let decoderConfig: VideoDecoderConfig | null = null;

// OffscreenCanvas for rendering
let offscreen: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

// Cached SPS/PPS
let cachedSPS: Uint8Array | null = null;
let cachedPPS: Uint8Array | null = null;
let waitingForKeyframe = false;

// ==== KEYFRAME REQUEST (Throttle 1s) ====
function requestKeyframe(reason: string) {
    const now = performance.now();
    if (now - lastKeyframeRequestTime < 1000) return; // anti-flood
    lastKeyframeRequestTime = now;
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "request-keyframe", device_id: deviceId, reason }));
        console.debug(`[KF] ${deviceId} <- ${reason}`);
    }
}

// ==== WATCHDOG ====
function heartbeat() {
    if (terminated) return;
    const now = performance.now();
    const stall = now - lastOutput;

    // Level 1: Request keyframe when >800ms without render
    if (!paused && hasConfigured && stall > 800) {
        requestKeyframe(`stall:${Math.round(stall)}ms`);
    }
    // Level 2: Hard reset decoder when >2000ms
    if (!paused && hasConfigured && stall > 2000) {
        resetDecoder("stall_hard_reset");
    }
    setTimeout(heartbeat, 500);
}

// ==== DECODER OUTPUT HOOK ====
function onFrameRendered() {
    lastOutput = performance.now();
}

// ==== RESET / RECONFIG DECODER ====
function resetDecoder(reason: string) {
    console.log(`🔄 [${deviceId}] Resetting decoder: ${reason}`);
    try { decoder?.flush?.(); } catch { }
    try { decoder?.reset?.(); } catch { }
    try { decoder?.close?.(); } catch { }
    hasConfigured = false;
    waitingForKeyframe = false;
    cachedSPS = null;
    cachedPPS = null;
    if (decoderConfig) {
        configureDecoder(decoderConfig);
        requestKeyframe(`decoder_reset:${reason}`);
    }
}

// ==== WS HANDLERS ====
function onWsOpen() {
    console.log(`🔌 [${deviceId}] WS connected`);
    // Request keyframe immediately for instant picture
    requestKeyframe("ws_open");
}

function onWsMessage(ev: MessageEvent) {
    if (paused || !decoder) return;
    if (typeof ev.data === "string") {
        // Control messages - ignore for now
        return;
    }

    const buf = new Uint8Array(ev.data as ArrayBuffer);
    if (buf.byteLength < 2) return;

    // Protocol: [1 byte ID_LENGTH] + [ID_BYTES] + [NAL_DATA]
    const idLen = buf[0];
    if (buf.byteLength < 1 + idLen) return;

    const msgDeviceId = new TextDecoder().decode(buf.subarray(1, 1 + idLen));
    if (msgDeviceId !== deviceId) return; // Filter: only our device

    const nalUnit = buf.subarray(1 + idLen);
    const nalType = getNALType(nalUnit);

    // Cache SPS/PPS
    if (nalType === 7) cachedSPS = nalUnit;
    else if (nalType === 8) cachedPPS = nalUnit;

    // Configure decoder on first SPS+PPS
    if (!hasConfigured && cachedSPS && cachedPPS) {
        const sps = cachedSPS;
        const startCodeLen = (sps[2] === 1) ? 3 : 4;
        const profile = sps[startCodeLen + 1].toString(16).padStart(2, '0').toUpperCase();
        const compat = sps[startCodeLen + 2].toString(16).padStart(2, '0').toUpperCase();
        const level = sps[startCodeLen + 3].toString(16).padStart(2, '0').toUpperCase();
        const codecString = `avc1.${profile}${compat}${level}`;

        console.log(`🔧 [${deviceId}] Config Codec: ${codecString}`);
        try {
            decoder.configure({
                codec: codecString,
                optimizeForLatency: true,
            });
            hasConfigured = true;
            waitingForKeyframe = true;
            lastOutput = performance.now();
        } catch (e) {
            console.error(`❌ [${deviceId}] Config failed:`, e);
            resetDecoder("config_error");
        }
    }

    // Decode video frames
    if (hasConfigured && (nalType === 1 || nalType === 5)) {
        // Must wait for keyframe after configure
        if (waitingForKeyframe && nalType !== 5) return;
        if (nalType === 5) waitingForKeyframe = false;

        try {
            let chunkData = nalUnit;

            // Stitch SPS+PPS+IDR for keyframes
            if (nalType === 5 && cachedSPS && cachedPPS) {
                const newData = new Uint8Array(cachedSPS.length + cachedPPS.length + nalUnit.length);
                newData.set(cachedSPS, 0);
                newData.set(cachedPPS, cachedSPS.length);
                newData.set(nalUnit, cachedSPS.length + cachedPPS.length);
                chunkData = newData;
            }

            // Drop policy: skip old frames or when queue is large
            const queue = (decoder as any).decodeQueueSize ?? 0;
            if (nalType !== 5 && queue > 2) return; // Keep only keyframes when congested

            const chunk = new EncodedVideoChunk({
                type: nalType === 5 ? 'key' : 'delta',
                timestamp: performance.now() * 1000,
                data: chunkData
            });

            decoder.decode(chunk);
        } catch (e) {
            console.error(`❌ [${deviceId}] Decode error:`, e);
        }
    }
}

function onWsClose() {
    console.log(`🔌 [${deviceId}] WS closed, reconnecting...`);
    setTimeout(ensureWs, 500);
}

function onWsError() {
    try { ws?.close(); } catch { }
    setTimeout(ensureWs, 500);
}

function ensureWs() {
    if (terminated) return;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;

    const url = `${wsUrl}?device_id=${encodeURIComponent(deviceId)}`;
    ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    ws.addEventListener("open", onWsOpen);
    ws.addEventListener("message", onWsMessage);
    ws.addEventListener("close", onWsClose);
    ws.addEventListener("error", onWsError);
}

// ==== VISIBILITY/PAUSE FROM MAIN ====
function onPause(v: boolean) {
    paused = v;
    if (!v) {
        lastOutput = performance.now();
        requestKeyframe("resume");
    }
}

function onVisibilityChange(hidden: boolean) {
    paused = hidden;
    if (!hidden) {
        lastOutput = performance.now();
        requestKeyframe("resume_visible");
    }
}

// ==== CONFIGURE DECODER ====
function configureDecoder(cfg?: VideoDecoderConfig) {
    if (cfg) decoderConfig = cfg;
    if (!offscreen) return;

    try { decoder?.close?.(); } catch { }

    ctx = offscreen.getContext('2d');

    decoder = new VideoDecoder({
        output: (frame: VideoFrame) => {
            try {
                if (ctx && offscreen) {
                    // Resize canvas if needed
                    if (offscreen.width !== frame.displayWidth || offscreen.height !== frame.displayHeight) {
                        offscreen.width = frame.displayWidth;
                        offscreen.height = frame.displayHeight;
                    }
                    ctx.drawImage(frame, 0, 0, offscreen.width, offscreen.height);
                }
            } finally {
                frame.close();
                onFrameRendered();
            }
        },
        error: (e) => {
            console.warn(`⚠️ [${deviceId}] Decoder error:`, e);
            resetDecoder("decoder_error");
        }
    });

    hasConfigured = false;
    waitingForKeyframe = false;
    lastOutput = performance.now();
}

// ==== NAL TYPE HELPER ====
function getNALType(data: Uint8Array): number {
    let offset = -1;
    if (data.length > 4 && data[0] === 0 && data[1] === 0 && data[2] === 0 && data[3] === 1) offset = 4;
    else if (data.length > 3 && data[0] === 0 && data[1] === 0 && data[2] === 1) offset = 3;
    if (offset !== -1 && offset < data.length) return data[offset] & 0x1F;
    return -1;
}

// ==== BOOT ====
heartbeat();

// ==== MESSAGE PORT FROM MAIN ====
self.onmessage = (e: MessageEvent) => {
    const { type, payload } = e.data || {};
    switch (type) {
        case "init":
            deviceId = payload.deviceId;
            wsUrl = payload.wsUrl;
            offscreen = payload.canvas as OffscreenCanvas;
            if (payload.decoderConfig) {
                configureDecoder(payload.decoderConfig);
            } else {
                configureDecoder({ codec: 'avc1.640028', optimizeForLatency: true });
            }
            ensureWs();
            // Subscribe to device stream
            setTimeout(() => {
                if (ws && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ type: "subscribe", device_id: deviceId }));
                }
            }, 100);
            break;

        case "pause":
            onPause(!!payload);
            break;

        case "visibility":
            onVisibilityChange(!!payload?.hidden);
            break;

        case "decode": {
            // If main thread pushes chunk via postMessage instead of WS
            if (!decoder || !hasConfigured) break;
            const { chunkInit, nalType } = payload;
            const chunk = new EncodedVideoChunk(chunkInit);
            // Drop policy
            const q = (decoder as any).decodeQueueSize ?? 0;
            if (nalType !== 5 && q > 2) break;
            decoder.decode(chunk);
            break;
        }

        case "terminate":
            terminated = true;
            try { ws?.close(); } catch { }
            try { decoder?.close(); } catch { }
            break;
    }
};
