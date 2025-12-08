/**
 * startTileStream - Factory for creating video tile workers
 * Manages worker lifecycle and canvas transfer
 */

// Track canvases that have been transferred to workers
const canvasWorkerMap = new WeakMap<HTMLCanvasElement, {
    worker: Worker;
    deviceId: string;
}>();

// All active workers for visibility broadcast
const activeWorkers = new Set<Worker>();

export interface TileStreamHandle {
    worker: Worker;
    deviceId: string;
    pause: () => void;
    resume: () => void;
    terminate: () => void;
}

/**
 * Start a video tile stream for a device
 * @param canvas - The canvas element to render to
 * @param deviceId - The device ID to stream
 * @param wsUrl - WebSocket URL (e.g., ws://localhost:8080/ws)
 * @returns Handle to control the stream, or null if canvas already in use
 */
export function startTileStream(
    canvas: HTMLCanvasElement,
    deviceId: string,
    wsUrl: string = 'ws://localhost:8080/ws'
): TileStreamHandle | null {
    // Check if canvas already has a worker
    const existing = canvasWorkerMap.get(canvas);
    if (existing) {
        // If same device, return existing handle
        if (existing.deviceId === deviceId) {
            return {
                worker: existing.worker,
                deviceId,
                pause: () => existing.worker.postMessage({ type: 'pause', payload: true }),
                resume: () => existing.worker.postMessage({ type: 'pause', payload: false }),
                terminate: () => terminateStream(canvas),
            };
        }
        // Different device - terminate old stream first
        terminateStream(canvas);
    }

    // Transfer canvas to offscreen
    let offscreen: OffscreenCanvas;
    try {
        offscreen = canvas.transferControlToOffscreen();
    } catch (e) {
        console.error(`❌ Failed to transfer canvas for ${deviceId}:`, e);
        return null;
    }

    // Create worker
    const worker = new Worker(
        new URL('../workers/video-tile.worker.ts', import.meta.url),
        { type: 'module' }
    );

    // Initialize worker with canvas
    worker.postMessage(
        {
            type: 'init',
            payload: {
                deviceId,
                wsUrl,
                canvas: offscreen,
                decoderConfig: {
                    codec: 'avc1.640028',
                    optimizeForLatency: true,
                    hardwareAcceleration: 'prefer-hardware',
                },
            },
        },
        [offscreen] // Transfer ownership
    );

    // Track worker
    canvasWorkerMap.set(canvas, { worker, deviceId });
    activeWorkers.add(worker);

    const handle: TileStreamHandle = {
        worker,
        deviceId,
        pause: () => worker.postMessage({ type: 'pause', payload: true }),
        resume: () => worker.postMessage({ type: 'pause', payload: false }),
        terminate: () => terminateStream(canvas),
    };

    return handle;
}

/**
 * Terminate stream for a canvas
 */
export function terminateStream(canvas: HTMLCanvasElement): void {
    const entry = canvasWorkerMap.get(canvas);
    if (!entry) return;

    entry.worker.postMessage({ type: 'terminate' });
    entry.worker.terminate();
    activeWorkers.delete(entry.worker);
    canvasWorkerMap.delete(canvas);
}

/**
 * Broadcast visibility change to all workers
 * Call this from document.visibilitychange event
 */
export function broadcastVisibility(hidden: boolean): void {
    activeWorkers.forEach(worker => {
        worker.postMessage({ type: 'visibility', payload: { hidden } });
    });
}

/**
 * Get all active workers (for IntersectionObserver pause/resume)
 */
export function getActiveWorkers(): Set<Worker> {
    return activeWorkers;
}

/**
 * Check if a canvas has an active stream
 */
export function hasActiveStream(canvas: HTMLCanvasElement): boolean {
    return canvasWorkerMap.has(canvas);
}

// Auto-setup visibility listener
if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
        broadcastVisibility(document.hidden);
    });
}
