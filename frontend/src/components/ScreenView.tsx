import React, { useRef, useEffect, useState, useCallback } from 'react';
import { cn } from '@/utils/helpers';
import { deviceService } from '@/services/deviceService';
import { Device } from '@/types/device';
import { wsService } from '@/services/websocket';
import { useSettingsStore } from '@/store/useSettingsStore';

interface ScreenViewProps {
    device: Device;
    className?: string;
    interactive?: boolean; // Cho phép điều khiển hay không
    quality?: 'low' | 'high';
}

export const ScreenView: React.FC<ScreenViewProps> = ({
    device,
    className,
    interactive = true
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [dimensions, setDimensions] = useState({ width: 288, height: 600 });
    const [fps, setFps] = useState(0);

    // Settings
    const { showFpsIndicator } = useSettingsStore();

    const decoderRef = useRef<VideoDecoder | null>(null);
    const frameCountRef = useRef(0);
    const lastFpsUpdateRef = useRef(Date.now());
    const canvasSizeRef = useRef({ width: 0, height: 0 }); // Track canvas size to avoid unnecessary resets

    // Cache SPS/PPS để ghép vào Keyframe
    const spsRef = useRef<Uint8Array | null>(null);
    const ppsRef = useRef<Uint8Array | null>(null);
    const hasConfiguredRef = useRef(false);
    const waitingForKeyframeRef = useRef(false); // Track if waiting for keyframe after configure

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
        if (canvasRef.current) {
            canvasRef.current.width = dimensions.width;
            canvasRef.current.height = dimensions.height;
        }
    }, [dimensions]);

    // --- 2. Decoder Setup (Annex B Mode) ---
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

                // Only set canvas size if it actually changed (to prevent context reset/blur)
                if (canvasSizeRef.current.width !== frame.displayWidth ||
                    canvasSizeRef.current.height !== frame.displayHeight) {
                    canvas.width = frame.displayWidth;
                    canvas.height = frame.displayHeight;
                    canvasSizeRef.current = { width: frame.displayWidth, height: frame.displayHeight };
                    console.log(`🖼️ Canvas resized to ${canvas.width}x${canvas.height}`);
                }

                // Draw frame
                ctx.drawImage(frame, 0, 0, canvas.width, canvas.height);
                frame.close();

                // FPS Counter - count rendered frames
                frameCountRef.current++;
                const now = performance.now();
                const elapsed = now - lastFpsUpdateRef.current;
                if (elapsed >= 1000) {
                    const currentFps = Math.round((frameCountRef.current * 1000) / elapsed);
                    setFps(currentFps);
                    console.log(`📊 FPS: ${currentFps}, showFpsIndicator: ${showFpsIndicator}`);
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
    }, [resetDecoder]); // REMOVED targetFps - we don't want to reset decoder when FPS changes!

    // --- 3. Handle Data ---
    useEffect(() => {
        const handleMessage = (data: ArrayBuffer | string) => {
            if (!decoderRef.current || decoderRef.current.state === 'closed') return;
            if (!(data instanceof ArrayBuffer)) return;

            const buf = new Uint8Array(data);

            // Protocol mới: [1 byte ID_LENGTH] + [ID_BYTES] + [NAL_DATA]
            if (buf.byteLength < 2) return;

            const idLen = buf[0];
            if (buf.byteLength < 1 + idLen) return;

            // Đọc Device ID từ gói tin
            const msgDeviceId = new TextDecoder().decode(buf.subarray(1, 1 + idLen));

            // 🔥 LỌC: Nếu không phải ID của máy mình -> Bỏ qua ngay lập tức
            if (msgDeviceId !== device.id) {
                return;
            }

            // Lấy NAL Data thực sự
            const nalUnit = buf.subarray(1 + idLen);
            const nalType = getNALType(nalUnit);

            // 1. Lưu SPS/PPS
            if (nalType === 7) spsRef.current = nalUnit; // SPS
            else if (nalType === 8) ppsRef.current = nalUnit; // PPS

            // 2. Cấu hình Decoder (khi có SPS lần đầu)
            if (!hasConfiguredRef.current && spsRef.current && ppsRef.current) {
                const sps = spsRef.current;
                // Auto detect profile string
                // Byte 1, 2, 3 sau start code là Profile, Compatibility, Level
                // Start code có thể là 3 hoặc 4 byte
                const startCodeLen = (sps[2] === 1) ? 3 : 4;
                const profile = sps[startCodeLen + 1].toString(16).padStart(2, '0').toUpperCase();
                const compat = sps[startCodeLen + 2].toString(16).padStart(2, '0').toUpperCase();
                const level = sps[startCodeLen + 3].toString(16).padStart(2, '0').toUpperCase();
                const codecString = `avc1.${profile}${compat}${level}`;

                console.log(`🔧 Config Codec: ${codecString} (AnnexB Mode)`);

                try {
                    decoderRef.current.configure({
                        codec: codecString,
                        optimizeForLatency: true,
                        // KHÔNG truyền description khi dùng chế độ Annex B
                    });
                    hasConfiguredRef.current = true;
                    waitingForKeyframeRef.current = true; // MUST wait for keyframe after configure!
                } catch (e) {
                    console.error('Config failed:', e);
                    resetDecoder();
                }
            }

            // 3. Giải mã
            if (hasConfiguredRef.current && (nalType === 1 || nalType === 5)) {
                // MUST receive keyframe first after configure!
                if (waitingForKeyframeRef.current && nalType !== 5) {
                    // Still waiting for keyframe, skip P-frames
                    return;
                }

                // Clear waiting flag when we receive keyframe
                if (nalType === 5) {
                    waitingForKeyframeRef.current = false;
                }

                try {
                    let chunkData = nalUnit;

                    // Nếu là Keyframe (IDR - 5), chúng ta NÊN ghép thêm SPS/PPS vào trước
                    // để đảm bảo decoder có context (phòng trường hợp reset)
                    if (nalType === 5 && spsRef.current && ppsRef.current) {
                        const newData = new Uint8Array(spsRef.current.length + ppsRef.current.length + nalUnit.length);
                        newData.set(spsRef.current, 0);
                        newData.set(ppsRef.current, spsRef.current.length);
                        newData.set(nalUnit, spsRef.current.length + ppsRef.current.length);
                        chunkData = newData;
                        // console.log("🔑 Decoding IDR Frame with headers");
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

        // Gửi lệnh start
        wsService.sendMessage({ type: 'subscribe', device_id: device.id });
        fetch(`http://localhost:8080/api/streaming/start/${device.id}`, { method: 'POST' }).catch(() => { });

        return () => {
            unsubscribe();
            wsService.sendMessage({ type: 'unsubscribe', device_id: device.id });
            fetch(`http://localhost:8080/api/streaming/stop/${device.id}`, { method: 'POST' }).catch(() => { });
        };
    }, [device.id, resetDecoder]);

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

        // Ngưỡng để coi là Swipe (di chuyển > 10 pixel)
        if (dist > 10) {
            console.log("Swiping:", start.x, start.y, "->", endCoords.x, endCoords.y);
            try {
                await deviceService.swipe(
                    device.id,
                    start.x, start.y,
                    endCoords.x, endCoords.y,
                    Math.max(duration, 100) // Duration tối thiểu
                );
            } catch (err) {
                console.error("Swipe error:", err);
            }
        } else {
            // Nếu di chuyển ít -> Coi là Tap
            console.log("Tapping:", endCoords.x, endCoords.y);
            try {
                await deviceService.tap(device.id, endCoords.x, endCoords.y);
            } catch (err) {
                console.error("Tap error:", err);
            }
        }

        dragStartRef.current = null;
    };

    const handleMouseLeave = () => {
        dragStartRef.current = null;
    };

    // ... (Giữ nguyên logic fullscreen) ...
    const toggleFullscreen = () => {
        if (!canvasRef.current) return;
        if (!isFullscreen) {
            canvasRef.current.requestFullscreen();
            setIsFullscreen(true);
        } else {
            document.exitFullscreen();
            setIsFullscreen(false);
        }
    };

    useEffect(() => {
        const handler = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', handler);
        return () => document.removeEventListener('fullscreenchange', handler);
    }, []);

    return (
        <div className={cn('relative bg-black w-full h-full', className)}>
            <canvas
                ref={canvasRef}
                onMouseDown={handleMouseDown}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseLeave}
                className={cn("absolute inset-0 w-full h-full object-fill select-none", interactive ? "cursor-pointer" : "cursor-default")}
                // Tắt menu chuột phải mặc định để trải nghiệm app tốt hơn
                onContextMenu={(e) => e.preventDefault()}
            />
            {/* FPS Counter (Chỉ hiển thị nếu bật trong Settings) */}
            {showFpsIndicator && fps > 0 && (
                <div className="absolute top-2 left-2 bg-black/60 backdrop-blur-sm text-white px-2 py-1 rounded text-xs font-mono pointer-events-none z-10">
                    {fps} FPS | {device.name || device.adb_device_id}
                </div>
            )}
        </div>
    );
};

function getNALType(data: Uint8Array): number {
    // Tìm start code để lấy NAL type chính xác
    let offset = -1;
    if (data.length > 4 && data[0] === 0 && data[1] === 0 && data[2] === 0 && data[3] === 1) offset = 4;
    else if (data.length > 3 && data[0] === 0 && data[1] === 0 && data[2] === 1) offset = 3;

    if (offset !== -1 && offset < data.length) return data[offset] & 0x1F;
    return -1;
}
