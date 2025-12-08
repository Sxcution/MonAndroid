import React, { useRef, useEffect, useState, useCallback } from 'react';
import { cn } from '@/utils/helpers';
import { deviceService } from '@/services/deviceService';
import { Device } from '@/types/device';
import { wsService } from '@/services/websocket';
import { useSettingsStore } from '@/store/useSettingsStore';
import { useAppStore } from '@/store/useAppStore';
import { getAndroidKeycode, getMetaState, isPrintableKey } from '@/utils/keymap';
import { startTileStream, supportsOffscreenCanvas, TileStreamHandle, StreamStats } from '@/services/startTileStream';

interface ScreenViewProps {
    device: Device;
    className?: string;
    interactive?: boolean;
    quality?: 'low' | 'high';
    syncWithSelected?: boolean; // Sync actions with other selected devices
    paused?: boolean;
}

export const ScreenView: React.FC<ScreenViewProps> = ({
    device,
    className,
    interactive = true,
    syncWithSelected = false,
    paused: externalPaused = false
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [dimensions, setDimensions] = useState({ width: 288, height: 600 });

    // Stats stored in ref to avoid re-renders, displayed via overlay update
    const statsRef = useRef<StreamStats>({ fps: 0, decodeMs: 0, queueLen: 0, dropped: 0 });
    const overlayRef = useRef<HTMLDivElement>(null);

    // Worker handle
    const workerHandleRef = useRef<TileStreamHandle | null>(null);
    const isVisibleRef = useRef(true);
    const useWorkerDecoding = supportsOffscreenCanvas();

    // Fallback: main-thread decoding refs (for browsers without OffscreenCanvas support)
    const decoderRef = useRef<VideoDecoder | null>(null);
    const spsRef = useRef<Uint8Array | null>(null);
    const ppsRef = useRef<Uint8Array | null>(null);
    const hasConfiguredRef = useRef(false);
    const waitingForKeyframeRef = useRef(false);
    const frameCountRef = useRef(0);
    const lastFpsUpdateRef = useRef(performance.now());

    // Settings and store
    const { showFpsIndicator } = useSettingsStore();
    const { selectedDevices } = useAppStore();

    // Refs cho Swipe logic
    const dragStartRef = useRef<{ x: number, y: number, t: number } | null>(null);

    // --- 1. Layout ---
    useEffect(() => {
        if (device.resolution) {
            const match = device.resolution.match(/(\d+)x(\d+)/);
            if (match) {
                const w = parseInt(match[1]);
                const h = parseInt(match[2]);
                setDimensions({ width: w * 0.4, height: h * 0.4 });
            }
        }
    }, [device.resolution]);

    useEffect(() => {
        if (canvasRef.current && !useWorkerDecoding) {
            canvasRef.current.width = dimensions.width;
            canvasRef.current.height = dimensions.height;
        }
    }, [dimensions, useWorkerDecoding]);

    // --- 2. Stats Overlay Update (no React re-render) ---
    useEffect(() => {
        if (!showFpsIndicator) return;

        const updateOverlay = () => {
            if (overlayRef.current) {
                const s = statsRef.current;
                overlayRef.current.textContent = `${s.fps} FPS | ${s.decodeMs}ms | Q:${s.queueLen}`;
            }
            requestAnimationFrame(updateOverlay);
        };

        const rafId = requestAnimationFrame(updateOverlay);
        return () => cancelAnimationFrame(rafId);
    }, [showFpsIndicator]);

    // --- 3. Worker-based Decoding (Primary) ---
    useEffect(() => {
        if (!useWorkerDecoding || !canvasRef.current) return;

        console.log(`🔧 [ScreenView ${device.id}] Using Worker-based decoding`);

        // Start the worker
        const handle = startTileStream(canvasRef.current, device.id);
        workerHandleRef.current = handle;

        // Listen for stats updates
        handle.onStats((stats) => {
            statsRef.current = stats;
        });

        // Listen for keyframe requests (for future backend integration)
        handle.onKeyframeRequest((reason) => {
            console.log(`🔑 [ScreenView ${device.id}] Keyframe requested: ${reason}`);
            // TODO: Send request to backend for new IDR frame
        });

        return () => {
            handle.terminate();
            workerHandleRef.current = null;
        };
    }, [device.id, useWorkerDecoding]);

    // --- 4. IntersectionObserver for Visibility-based Pause/Resume ---
    useEffect(() => {
        if (!useWorkerDecoding || !containerRef.current) return;

        const observer = new IntersectionObserver(
            ([entry]) => {
                const isVisible = entry.isIntersecting;
                isVisibleRef.current = isVisible;

                if (workerHandleRef.current) {
                    if (isVisible && !externalPaused) {
                        workerHandleRef.current.resume();
                    } else {
                        workerHandleRef.current.pause();
                    }
                }
            },
            { threshold: 0.1 }
        );

        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, [useWorkerDecoding, externalPaused]);

    // Handle external pause prop changes
    useEffect(() => {
        if (!workerHandleRef.current) return;

        if (externalPaused) {
            workerHandleRef.current.pause();
        } else if (isVisibleRef.current) {
            workerHandleRef.current.resume();
        }
    }, [externalPaused]);

    // --- 5. Fallback: Main-thread Decoding (for browsers without OffscreenCanvas) ---
    const resetDecoder = useCallback(() => {
        if (decoderRef.current && decoderRef.current.state !== 'closed') {
            try { decoderRef.current.reset(); } catch { }
        }
        hasConfiguredRef.current = false;
        waitingForKeyframeRef.current = false;
        spsRef.current = null;
        ppsRef.current = null;
        console.log("🔄 Decoder reset");
    }, []);

    useEffect(() => {
        if (useWorkerDecoding) return; // Skip if using worker

        const decoder = new VideoDecoder({
            output: (frame) => {
                const canvas = canvasRef.current;
                if (!canvas) {
                    frame.close();
                    return;
                }

                const ctx = canvas.getContext('2d');
                if (!ctx) {
                    frame.close();
                    return;
                }

                if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
                    canvas.width = frame.displayWidth;
                    canvas.height = frame.displayHeight;
                }

                ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
                frame.close();

                // Update stats
                frameCountRef.current++;
                const now = performance.now();
                const elapsed = now - lastFpsUpdateRef.current;
                if (elapsed >= 1000) {
                    const currentFps = Math.round((frameCountRef.current * 1000) / elapsed);
                    statsRef.current = { ...statsRef.current, fps: currentFps, queueLen: decoder.decodeQueueSize };
                    frameCountRef.current = 0;
                    lastFpsUpdateRef.current = now;
                }
            },
            error: (e) => {
                console.error('❌ Decoder Error:', e);
                resetDecoder();
            }
        });

        decoderRef.current = decoder;

        return () => {
            if (decoder.state !== 'closed') decoder.close();
        };
    }, [resetDecoder, useWorkerDecoding]);

    // Fallback: Handle WebSocket data in main thread
    useEffect(() => {
        if (useWorkerDecoding) return; // Skip if using worker

        const handleMessage = (data: ArrayBuffer | string) => {
            if (!decoderRef.current || decoderRef.current.state === 'closed') return;
            if (!(data instanceof ArrayBuffer)) return;

            const buf = new Uint8Array(data);
            if (buf.byteLength < 2) return;

            const idLen = buf[0];
            if (buf.byteLength < 1 + idLen) return;

            const msgDeviceId = new TextDecoder().decode(buf.subarray(1, 1 + idLen));
            if (msgDeviceId !== device.id) return;

            const nalUnit = buf.subarray(1 + idLen);
            const nalType = getNALType(nalUnit);

            if (nalType === 7) spsRef.current = nalUnit;
            else if (nalType === 8) ppsRef.current = nalUnit;

            if (!hasConfiguredRef.current && spsRef.current && ppsRef.current) {
                const sps = spsRef.current;
                const startCodeLen = (sps[2] === 1) ? 3 : 4;
                const profile = sps[startCodeLen + 1].toString(16).padStart(2, '0').toUpperCase();
                const compat = sps[startCodeLen + 2].toString(16).padStart(2, '0').toUpperCase();
                const level = sps[startCodeLen + 3].toString(16).padStart(2, '0').toUpperCase();
                const codecString = `avc1.${profile}${compat}${level}`;

                try {
                    decoderRef.current.configure({
                        codec: codecString,
                        optimizeForLatency: true,
                    });
                    hasConfiguredRef.current = true;
                    waitingForKeyframeRef.current = true;
                } catch (e) {
                    console.error('Config failed:', e);
                    resetDecoder();
                }
            }

            if (hasConfiguredRef.current && (nalType === 1 || nalType === 5)) {
                if (waitingForKeyframeRef.current && nalType !== 5) return;
                if (nalType === 5) waitingForKeyframeRef.current = false;

                try {
                    let chunkData = nalUnit;
                    if (nalType === 5 && spsRef.current && ppsRef.current) {
                        const newData = new Uint8Array(spsRef.current.length + ppsRef.current.length + nalUnit.length);
                        newData.set(spsRef.current, 0);
                        newData.set(ppsRef.current, spsRef.current.length);
                        newData.set(nalUnit, spsRef.current.length + ppsRef.current.length);
                        chunkData = newData;
                    }

                    const chunk = new EncodedVideoChunk({
                        type: nalType === 5 ? 'key' : 'delta',
                        timestamp: performance.now() * 1000,
                        data: chunkData
                    });

                    if (decoderRef.current.decodeQueueSize < 5) {
                        decoderRef.current.decode(chunk);
                    }
                } catch (e) {
                    console.error('Decode error:', e);
                }
            }
        };

        const unsubscribe = wsService.subscribe(handleMessage);
        wsService.subscribeDevice(device.id);
        fetch(`http://localhost:8080/api/streaming/start/${device.id}`, { method: 'POST' }).catch(() => { });

        return () => {
            unsubscribe();
            wsService.unsubscribeDevice(device.id);
        };
    }, [device.id, resetDecoder, useWorkerDecoding]);

    // --- XỬ LÝ TƯƠNG TÁC (SWIPE vs TAP) ---

    const getCoords = (e: React.MouseEvent) => {
        if (!canvasRef.current || !device.resolution) return null;
        const match = device.resolution.match(/(\d+)x(\d+)/);
        if (!match) return null;

        const origW = parseInt(match[1]);
        const origH = parseInt(match[2]);
        const rect = canvasRef.current.getBoundingClientRect();

        const x = Math.floor((e.clientX - rect.left) / rect.width * origW);
        const y = Math.floor((e.clientY - rect.top) / rect.height * origH);
        return { x, y };
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        if (!interactive) return;
        if (e.button !== 0 || e.ctrlKey) return;
        const coords = getCoords(e);
        if (coords) {
            dragStartRef.current = { x: coords.x, y: coords.y, t: Date.now() };
        }
    };

    const handleMouseUp = async (e: React.MouseEvent) => {
        if (!interactive || !dragStartRef.current) return;

        const endCoords = getCoords(e);
        if (!endCoords) return;

        const start = dragStartRef.current;
        const diffX = endCoords.x - start.x;
        const diffY = endCoords.y - start.y;
        const dist = Math.sqrt(diffX * diffX + diffY * diffY);
        const duration = Date.now() - start.t;

        const targetDevices = syncWithSelected && selectedDevices.length > 1
            ? selectedDevices
            : [device.id];

        if (dist > 10) {
            for (const deviceId of targetDevices) {
                deviceService.swipe(
                    deviceId,
                    start.x, start.y,
                    endCoords.x, endCoords.y,
                    Math.max(duration, 100)
                ).catch(err => console.error(`Swipe error on ${deviceId}:`, err));
            }
        } else {
            for (const deviceId of targetDevices) {
                deviceService.tap(deviceId, endCoords.x, endCoords.y)
                    .catch(err => console.error(`Tap error on ${deviceId}:`, err));
            }
        }

        dragStartRef.current = null;
    };

    const handleMouseLeave = () => {
        dragStartRef.current = null;
    };

    // --- KEYBOARD HANDLERS ---
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (!interactive) return;
        e.preventDefault();

        if (e.ctrlKey && e.key === 'v') {
            navigator.clipboard.readText().then(text => {
                if (text) {
                    wsService.sendMessage({
                        type: 'clipboard',
                        device_id: device.id,
                        text: text,
                        paste: true
                    });
                }
            }).catch(err => console.error('Clipboard read failed:', err));
            return;
        }

        if (e.ctrlKey && e.key === 'c') {
            wsService.sendMessage({
                type: 'key',
                device_id: device.id,
                action: 0,
                keycode: 31,
                meta: 0x1000
            });
            setTimeout(() => {
                wsService.sendMessage({
                    type: 'key',
                    device_id: device.id,
                    action: 1,
                    keycode: 31,
                    meta: 0
                });
            }, 50);
            return;
        }

        if (isPrintableKey(e)) {
            wsService.sendMessage({
                type: 'text',
                device_id: device.id,
                text: e.key
            });
            return;
        }

        const keycode = getAndroidKeycode(e);
        if (keycode !== null) {
            wsService.sendMessage({
                type: 'key',
                device_id: device.id,
                action: 0,
                keycode: keycode,
                meta: getMetaState(e)
            });
        }
    }, [device.id, interactive]);

    const handleKeyUp = useCallback((e: React.KeyboardEvent) => {
        if (!interactive) return;
        e.preventDefault();

        if (isPrintableKey(e)) return;
        if (e.ctrlKey && (e.key === 'v' || e.key === 'c')) return;

        const keycode = getAndroidKeycode(e);
        if (keycode !== null) {
            wsService.sendMessage({
                type: 'key',
                device_id: device.id,
                action: 1,
                keycode: keycode,
                meta: getMetaState(e)
            });
        }
    }, [device.id, interactive]);



    return (
        <div ref={containerRef} className={cn('relative bg-black w-full h-full', className)}>
            <canvas
                ref={canvasRef}
                tabIndex={0}
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseLeave}
                onKeyDown={handleKeyDown}
                onKeyUp={handleKeyUp}
                className={cn("absolute inset-0 w-full h-full object-fill select-none outline-none", interactive ? "cursor-pointer" : "cursor-default")}
                onContextMenu={(e) => e.preventDefault()}
            />
            {/* FPS/Stats Overlay - Updated via requestAnimationFrame, no React re-render */}
            {showFpsIndicator && (
                <div
                    ref={overlayRef}
                    className="absolute top-1 left-1 bg-black/70 backdrop-blur-sm text-white px-1.5 py-0.5 rounded text-[10px] font-mono pointer-events-none z-10 leading-tight"
                >
                    0 FPS | 0ms | Q:0
                </div>
            )}
        </div>
    );
};

function getNALType(data: Uint8Array): number {
    let offset = -1;
    if (data.length > 4 && data[0] === 0 && data[1] === 0 && data[2] === 0 && data[3] === 1) offset = 4;
    else if (data.length > 3 && data[0] === 0 && data[1] === 0 && data[2] === 1) offset = 3;

    if (offset !== -1 && offset < data.length) return data[offset] & 0x1F;
    return -1;
}
