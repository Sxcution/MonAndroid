/**
 * Video Tile Worker - Decodes and renders H.264 stream independently of main thread
 * 
 * Features:
 * - WebSocket connection for receiving H.264 NAL units
 * - VideoDecoder with backpressure handling (drop frames when queue > 3)
 * - IDR detection for intelligent frame dropping
 * - Watchdog (800ms) for auto-recovery from decoder stalls
 * - Pause/Resume API for visibility management
 */

/// <reference lib="webworker" />

interface WorkerMessage {
    type: 'init' | 'pause' | 'resume' | 'terminate' | 'quality';
    canvas?: OffscreenCanvas;
    deviceId?: string;
    wsUrl?: string;
    maxSize?: number;
    maxFps?: number;
}

interface StatsMessage {
    type: 'stats';
    fps: number;
    decodeMs: number;
    queueLen: number;
    dropped: number;
}

interface KeyframeRequestMessage {
    type: 'request-keyframe';
    reason: string;
}

let canvas: OffscreenCanvas;
let ctx: OffscreenCanvasRenderingContext2D | null = null;
let decoder: VideoDecoder | null = null;
let ws: WebSocket | null = null;
let deviceId: string = '';

// State
let frameNo = 0;                      // Monotonic timestamp (μs)
let dropping = false;                 // Dropping frames until next IDR
let droppedCount = 0;                 // Count of dropped frames
let lastOutput = performance.now();   // Last successful frame output
let paused = false;
let terminated = false;

// SPS/PPS cache for decoder configuration
let spsData: Uint8Array | null = null;
let ppsData: Uint8Array | null = null;
let hasConfigured = false;
let waitingForKeyframe = true;

// FPS tracking
let frameCount = 0;
let lastFpsUpdate = performance.now();
let decodeLatencyAcc = 0;
let decodeLatencyCount = 0;
let lastDecodeStart = 0;

/**
 * Detect if NAL unit is an IDR (keyframe) - Annex B format
 * NAL type 5 = IDR slice
 */
function isAnnexBKey(buf: Uint8Array): boolean {
    const nalType = getNALType(buf);
    return nalType === 5; // IDR
}

/**
 * Get NAL unit type from Annex B data
 */
function getNALType(data: Uint8Array): number {
    // Find start code to get NAL type
    let offset = -1;
    if (data.length > 4 && data[0] === 0 && data[1] === 0 && data[2] === 0 && data[3] === 1) {
        offset = 4;
    } else if (data.length > 3 && data[0] === 0 && data[1] === 0 && data[2] === 1) {
        offset = 3;
    }

    if (offset !== -1 && offset < data.length) {
        return data[offset] & 0x1F;
    }
    return -1;
}

/**
 * Setup or reset the VideoDecoder
 */
function setupDecoder(codecString: string = 'avc1.64001f') {
    if (decoder && decoder.state !== 'closed') {
        try { decoder.close(); } catch { }
    }

    decoder = new VideoDecoder({
        output: (frame) => {
            try {
                if (ctx && !paused && !terminated) {
                    // Resize canvas if needed (only when dimensions actually change)
                    if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
                        canvas.width = frame.displayWidth;
                        canvas.height = frame.displayHeight;
                    }
                    ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
                }
            } finally {
                frame.close(); // ⚠️ CRITICAL: Must close to prevent GPU memory leak
            }

            lastOutput = performance.now();

            // Track latency
            if (lastDecodeStart > 0) {
                const lat = performance.now() - lastDecodeStart;
                decodeLatencyAcc += lat;
                decodeLatencyCount++;
            }

            // FPS counter
            frameCount++;
            const now = performance.now();
            const elapsed = now - lastFpsUpdate;
            if (elapsed >= 1000) {
                const currentFps = Math.round((frameCount * 1000) / elapsed);
                const avgLatency = decodeLatencyCount > 0
                    ? Math.round(decodeLatencyAcc / decodeLatencyCount)
                    : 0;

                // Send stats to main thread
                const statsMsg: StatsMessage = {
                    type: 'stats',
                    fps: currentFps,
                    decodeMs: avgLatency,
                    queueLen: decoder?.decodeQueueSize || 0,
                    dropped: droppedCount
                };
                self.postMessage(statsMsg);

                // Reset counters
                frameCount = 0;
                lastFpsUpdate = now;
                decodeLatencyAcc = 0;
                decodeLatencyCount = 0;
                droppedCount = 0;
            }
        },
        error: (e) => {
            console.error(`❌ [Worker ${deviceId}] Decoder error:`, e);
            resetDecoder('decoder_error');
        }
    });

    decoder.configure({
        codec: codecString,
        optimizeForLatency: true,
        hardwareAcceleration: 'prefer-hardware'
    });

    hasConfigured = true;
    waitingForKeyframe = true; // Must wait for keyframe after configure
    console.log(`🔧 [Worker ${deviceId}] Decoder configured: ${codecString}`);
}

/**
 * Reset decoder and request new keyframe
 */
function resetDecoder(reason: string) {
    console.log(`🔄 [Worker ${deviceId}] Resetting decoder: ${reason}`);

    hasConfigured = false;
    waitingForKeyframe = true;
    spsData = null;
    ppsData = null;
    frameNo = 0;
    dropping = false;

    // Request new keyframe from backend
    const msg: KeyframeRequestMessage = { type: 'request-keyframe', reason };
    self.postMessage(msg);
}

/**
 * Enqueue NAL unit for decoding with backpressure handling
 */
function enqueue(nalUnit: Uint8Array) {
    if (!decoder || decoder.state === 'closed' || terminated || paused) return;

    const nalType = getNALType(nalUnit);

    // 1. Cache SPS/PPS
    if (nalType === 7) {
        spsData = nalUnit;
        return;
    } else if (nalType === 8) {
        ppsData = nalUnit;
        return;
    }

    // 2. Configure decoder when we have SPS + PPS
    if (!hasConfigured && spsData && ppsData) {
        // Extract codec string from SPS
        const sps = spsData;
        const startCodeLen = (sps[2] === 1) ? 3 : 4;
        const profile = sps[startCodeLen + 1].toString(16).padStart(2, '0').toUpperCase();
        const compat = sps[startCodeLen + 2].toString(16).padStart(2, '0').toUpperCase();
        const level = sps[startCodeLen + 3].toString(16).padStart(2, '0').toUpperCase();
        const codecString = `avc1.${profile}${compat}${level}`;

        setupDecoder(codecString);
    }

    // 3. Skip non-video NAL units
    if (nalType !== 1 && nalType !== 5) return;

    // 4. Backpressure: if queue > 3, start dropping until IDR
    if (decoder.decodeQueueSize > 3) {
        if (!dropping) {
            console.log(`⚠️ [Worker ${deviceId}] Backpressure! Dropping frames until IDR`);
            dropping = true;
        }
        droppedCount++;
        return;
    }

    // 5. If dropping, only accept IDR frames
    if (dropping) {
        if (!isAnnexBKey(nalUnit)) {
            droppedCount++;
            return;
        }
        console.log(`✅ [Worker ${deviceId}] Got IDR, resuming decode`);
        dropping = false;
    }

    // 6. Must receive keyframe first after configure
    if (waitingForKeyframe && nalType !== 5) {
        return;
    }
    if (nalType === 5) {
        waitingForKeyframe = false;
    }

    // 7. Decode
    try {
        let chunkData = nalUnit;

        // Prepend SPS/PPS to keyframes for decoder context
        if (nalType === 5 && spsData && ppsData) {
            const newData = new Uint8Array(spsData.length + ppsData.length + nalUnit.length);
            newData.set(spsData, 0);
            newData.set(ppsData, spsData.length);
            newData.set(nalUnit, spsData.length + ppsData.length);
            chunkData = newData;
        }

        const ts = (++frameNo) * 33333; // ~30fps → 33,333 μs per frame
        const chunk = new EncodedVideoChunk({
            type: nalType === 5 ? 'key' : 'delta',
            timestamp: ts,
            data: chunkData
        });

        lastDecodeStart = performance.now();
        decoder.decode(chunk);
    } catch (e) {
        console.error(`❌ [Worker ${deviceId}] Decode error:`, e);
        droppedCount++;
    }
}

/**
 * Watchdog: Auto-reset decoder if no output for > 800ms
 */
function heartbeat() {
    if (terminated) return;

    const now = performance.now();
    if (now - lastOutput > 800 && !paused && hasConfigured) {
        console.log(`⏰ [Worker ${deviceId}] Watchdog triggered - no output for 800ms`);
        resetDecoder('stall_watchdog');
    }

    setTimeout(heartbeat, 500);
}

/**
 * Handle messages from main thread
 */
self.onmessage = (e: MessageEvent<WorkerMessage>) => {
    const msg = e.data;

    if (msg.type === 'init') {
        if (!msg.canvas || !msg.deviceId || !msg.wsUrl) {
            console.error('❌ Worker init missing required params');
            return;
        }

        canvas = msg.canvas;
        deviceId = msg.deviceId;
        ctx = canvas.getContext('2d');

        if (!ctx) {
            console.error('❌ Failed to get 2D context from OffscreenCanvas');
            return;
        }

        console.log(`🔧 [Worker ${deviceId}] Initialized`);

        // Start watchdog
        heartbeat();

        // Connect to WebSocket
        ws = new WebSocket(msg.wsUrl);
        ws.binaryType = 'arraybuffer';

        ws.onopen = () => {
            console.log(`✅ [Worker ${deviceId}] WebSocket connected`);
            // Subscribe to this device's stream
            ws!.send(JSON.stringify({ type: 'subscribe', device_id: deviceId }));
        };

        ws.onmessage = ({ data }) => {
            if (!(data instanceof ArrayBuffer)) return;

            const buf = new Uint8Array(data);
            if (buf.byteLength < 2) return;

            // Protocol: [1 byte ID_LENGTH] + [ID_BYTES] + [NAL_DATA]
            const idLen = buf[0];
            if (buf.byteLength < 1 + idLen) return;

            const msgDeviceId = new TextDecoder().decode(buf.subarray(1, 1 + idLen));

            // Filter: Only process our device's data
            if (msgDeviceId !== deviceId) return;

            const nalUnit = buf.subarray(1 + idLen);
            enqueue(nalUnit);
        };

        ws.onclose = () => {
            console.log(`❌ [Worker ${deviceId}] WebSocket closed`);
            if (!terminated) {
                // Attempt reconnect after 2s
                setTimeout(() => {
                    if (!terminated && msg.wsUrl) {
                        console.log(`🔄 [Worker ${deviceId}] Reconnecting WebSocket...`);
                        ws = new WebSocket(msg.wsUrl);
                        ws.binaryType = 'arraybuffer';
                        ws.onopen = () => ws!.send(JSON.stringify({ type: 'subscribe', device_id: deviceId }));
                        ws.onmessage = ({ data }) => {
                            if (!(data instanceof ArrayBuffer)) return;
                            const buf = new Uint8Array(data);
                            if (buf.byteLength < 2) return;
                            const idLen = buf[0];
                            if (buf.byteLength < 1 + idLen) return;
                            const msgDeviceId = new TextDecoder().decode(buf.subarray(1, 1 + idLen));
                            if (msgDeviceId !== deviceId) return;
                            const nalUnit = buf.subarray(1 + idLen);
                            enqueue(nalUnit);
                        };
                    }
                }, 2000);
            }
        };

        ws.onerror = (err) => {
            console.error(`⚠️ [Worker ${deviceId}] WebSocket error:`, err);
        };
    }

    if (msg.type === 'pause') {
        paused = true;
        console.log(`⏸️ [Worker ${deviceId}] Paused`);
    }

    if (msg.type === 'resume') {
        paused = false;
        lastOutput = performance.now(); // Reset watchdog timer
        console.log(`▶️ [Worker ${deviceId}] Resumed`);
    }

    if (msg.type === 'terminate') {
        terminated = true;
        paused = true;

        if (ws && ws.readyState === WebSocket.OPEN) {
            ws.close();
        }

        if (decoder && decoder.state !== 'closed') {
            try { decoder.close(); } catch { }
        }

        console.log(`🛑 [Worker ${deviceId}] Terminated`);
        self.close();
    }
};

export { }; // Make this a module
