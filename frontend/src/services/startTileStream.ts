/**
 * Start Tile Stream - API for initializing Worker-based video stream
 * 
 * Usage:
 * const handle = startTileStream(canvasRef.current, device.id);
 * handle.onStats((stats) => { ... }); // Optional stats callback
 * handle.pause();  // When card leaves viewport
 * handle.resume(); // When card enters viewport
 * handle.terminate(); // Cleanup
 */

import { WS_URL } from '@/utils/constants';

export interface StreamStats {
    fps: number;
    decodeMs: number;
    queueLen: number;
    dropped: number;
}

export interface TileStreamHandle {
    worker: Worker;
    pause: () => void;
    resume: () => void;
    terminate: () => void;
    onStats: (callback: (stats: StreamStats) => void) => void;
    onKeyframeRequest: (callback: (reason: string) => void) => void;
}

/**
 * Initialize a Worker-based video stream for a device
 * 
 * @param canvas - The canvas element to render video to
 * @param deviceId - The device ID to stream from
 * @returns Handle for controlling the stream
 */
export function startTileStream(
    canvas: HTMLCanvasElement,
    deviceId: string
): TileStreamHandle {
    // Transfer canvas control to worker
    const offscreen = canvas.transferControlToOffscreen();

    // Create worker
    const worker = new Worker(
        new URL('../workers/video-tile.worker.ts', import.meta.url),
        { type: 'module' }
    );

    // Stats and keyframe request callbacks
    let statsCallback: ((stats: StreamStats) => void) | null = null;
    let keyframeCallback: ((reason: string) => void) | null = null;

    // Handle messages from worker
    worker.onmessage = (e) => {
        const msg = e.data;

        if (msg.type === 'stats' && statsCallback) {
            statsCallback({
                fps: msg.fps,
                decodeMs: msg.decodeMs,
                queueLen: msg.queueLen,
                dropped: msg.dropped
            });
        }

        if (msg.type === 'request-keyframe' && keyframeCallback) {
            keyframeCallback(msg.reason);
        }
    };

    worker.onerror = (e) => {
        console.error(`❌ [TileStream ${deviceId}] Worker error:`, e);
    };

    // Initialize worker with canvas and connection info
    worker.postMessage(
        {
            type: 'init',
            canvas: offscreen,
            deviceId: deviceId,
            wsUrl: WS_URL
        },
        [offscreen] // Transfer the OffscreenCanvas
    );

    // Trigger streaming start on backend
    fetch(`http://localhost:8080/api/streaming/start/${deviceId}`, { method: 'POST' })
        .catch(() => { /* Silently ignore - stream might already be running */ });

    return {
        worker,

        pause: () => {
            worker.postMessage({ type: 'pause' });
        },

        resume: () => {
            worker.postMessage({ type: 'resume' });
        },

        terminate: () => {
            worker.postMessage({ type: 'terminate' });
            // Worker will close itself after cleanup
        },

        onStats: (callback) => {
            statsCallback = callback;
        },

        onKeyframeRequest: (callback) => {
            keyframeCallback = callback;
        }
    };
}

/**
 * Check if browser supports OffscreenCanvas transfer
 */
export function supportsOffscreenCanvas(): boolean {
    if (typeof HTMLCanvasElement === 'undefined') return false;
    return typeof HTMLCanvasElement.prototype.transferControlToOffscreen === 'function';
}
