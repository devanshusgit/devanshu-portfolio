import type { HandLandmarker } from "@mediapipe/tasks-vision";
import { Camera, CameraOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { errorMessage } from "@/api/client";
import { Badge, Button, Notice } from "@/components/ui";
import { createHandTracker, HAND_CONNECTIONS, handClosure } from "@/lib/handTracker";

export interface WebcamFrame {
  /** Smoothed grip intent 0 (open) .. 1 (fist); null when no hand is visible. */
  closure: number | null;
  fps: number;
}

/**
 * Laptop webcam + MediaPipe hand tracking. Calls `onFrame` for every processed video frame
 * (about 30 per second) with the user's real grip intent.
 */
export function WebcamControl({ onFrame, onStop }: { onFrame: (f: WebcamFrame) => void; onStop?: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tracker = useRef<HandLandmarker | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const raf = useRef<number | null>(null);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;
  const [status, setStatus] = useState<"off" | "loading" | "tracking" | "nohand">("off");
  const [error, setError] = useState<string | null>(null);
  const [fps, setFps] = useState(0);

  const stop = () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setStatus("off");
    onFrameRef.current({ closure: null, fps: 0 });
    onStop?.();
  };

  useEffect(() => () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const start = async () => {
    setError(null);
    setStatus("loading");
    try {
      const [t, s] = await Promise.all([
        tracker.current ? Promise.resolve(tracker.current) : createHandTracker(),
        navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: "user" }, audio: false }),
      ]);
      tracker.current = t;
      stream.current = s;
      const v = video.current!;
      v.srcObject = s;
      await v.play();
      loop();
    } catch (e) {
      setStatus("off");
      setError(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "Camera permission was denied. Allow the camera for this site (address bar → camera icon), then try again."
          : `Could not start hand tracking: ${errorMessage(e)}`,
      );
    }
  };

  const loop = () => {
    let smooth: number | null = null;
    let lastTime = -1;
    let frames = 0;
    let fpsStart = performance.now();
    let lastFps = 0;
    const step = () => {
      const v = video.current;
      const t = tracker.current;
      if (!v || !t || !stream.current) return;
      if (v.readyState >= 2 && v.currentTime !== lastTime) {
        lastTime = v.currentTime;
        const res = t.detectForVideo(v, performance.now());
        const lm = res.landmarks?.[0];
        draw(lm);
        if (lm) {
          const c = handClosure(lm);
          smooth = smooth === null ? c : smooth * 0.55 + c * 0.45;
          setStatus("tracking");
        } else {
          smooth = null;
          setStatus("nohand");
        }
        frames++;
        const now = performance.now();
        if (now - fpsStart >= 1000) {
          lastFps = (frames * 1000) / (now - fpsStart);
          setFps(lastFps);
          frames = 0;
          fpsStart = now;
        }
        onFrameRef.current({ closure: smooth, fps: lastFps });
      }
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
  };

  const draw = (lm: { x: number; y: number }[] | undefined) => {
    const c = canvas.current;
    const v = video.current;
    if (!c || !v) return;
    c.width = v.videoWidth || 640;
    c.height = v.videoHeight || 480;
    const g = c.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, c.width, c.height);
    if (!lm) return;
    g.strokeStyle = "#22d3ee";
    g.lineWidth = 3;
    for (const [a, b] of HAND_CONNECTIONS) {
      g.beginPath();
      g.moveTo(lm[a].x * c.width, lm[a].y * c.height);
      g.lineTo(lm[b].x * c.width, lm[b].y * c.height);
      g.stroke();
    }
    g.fillStyle = "#f59e0b";
    for (const p of lm) {
      g.beginPath();
      g.arc(p.x * c.width, p.y * c.height, 4, 0, Math.PI * 2);
      g.fill();
    }
  };

  const running = status !== "off";

  return (
    <div className="space-y-2" data-testid="webcam-control">
      <div className="flex flex-wrap items-center gap-2">
        {!running ? (
          <Button variant="primary" onClick={start} icon={<Camera className="h-4 w-4" />}>
            Start webcam
          </Button>
        ) : (
          <Button onClick={stop} icon={<CameraOff className="h-4 w-4" />}>
            Stop webcam
          </Button>
        )}
        <Badge tone={status === "tracking" ? "good" : status === "off" ? "neutral" : "warn"} dot>
          {status === "tracking" ? "HAND TRACKED" : status === "nohand" ? "SHOW YOUR HAND" : status === "loading" ? "LOADING TRACKER…" : "CAMERA OFF"}
        </Badge>
        {running && <span className="font-mono text-xs text-muted">{fps.toFixed(0)} fps · 21 landmarks</span>}
        <Badge tone="accent">REAL INPUT</Badge>
      </div>
      {error && <Notice tone="bad">{error}</Notice>}
      <div className={running ? "relative w-full max-w-[260px] overflow-hidden rounded-xl border border-line bg-black" : "hidden"}>
        {/* Mirrored like a mirror, so moving your right hand moves the right side of the picture. */}
        <video ref={video} playsInline muted className="block w-full -scale-x-100" />
        <canvas ref={canvas} className="pointer-events-none absolute inset-0 h-full w-full -scale-x-100" />
      </div>
    </div>
  );
}
