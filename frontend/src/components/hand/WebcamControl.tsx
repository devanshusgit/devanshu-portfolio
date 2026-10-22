import type { HandLandmarker, ObjectDetector } from "@mediapipe/tasks-vision";
import { Camera, CameraOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { errorMessage } from "@/api/client";
import { Badge, Button, Notice } from "@/components/ui";
import { createHandTracker, createObjectDetector, HAND_CONNECTIONS, handClosure } from "@/lib/handTracker";
import { METAL_OFF, METAL_ON, metallicLook } from "@/lib/materialLook";
import { COCO_TO_OBJECT, METAL_CAPABLE, type ObjectGuess, pickObject, withLook } from "@/lib/objectMap";

export interface WebcamFrame {
  /** Smoothed grip intent 0 (open) .. 1 (fist); null when no hand is visible. */
  closure: number | null;
  fps: number;
}

type Box = { coco: string; score: number; x: number; y: number; w: number; h: number };

/** Object detection runs every DETECT_MS; an object must be seen this many times in a row to count. */
const DETECT_MS = 200;
const STABLE_HITS = 3;
const FORGET_MISSES = 10;

/**
 * Laptop webcam + MediaPipe. Every frame: hand landmarks -> grip intent (`onFrame`).
 * Every 200 ms: everyday-object detection; when an object is seen steadily, `onObject` fires.
 */
export function WebcamControl({
  onFrame,
  onObject,
  detectObjects = true,
}: {
  onFrame: (f: WebcamFrame) => void;
  onObject?: (g: ObjectGuess) => void;
  detectObjects?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const tracker = useRef<HandLandmarker | null>(null);
  const detector = useRef<ObjectDetector | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const raf = useRef<number | null>(null);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;
  const onObjectRef = useRef(onObject);
  onObjectRef.current = onObject;
  const detectRef = useRef(detectObjects);
  detectRef.current = detectObjects;
  const [status, setStatus] = useState<"off" | "loading" | "tracking" | "nohand">("off");
  const [error, setError] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const [sees, setSees] = useState<{ coco: string; score: number; metal?: boolean; metallic?: number } | null>(null);
  const sampler = useRef<HTMLCanvasElement | null>(null);

  /** Metallic-look score of the pixels inside a detection box (centre 70 %, to skip the background). */
  const sampleLook = (v: HTMLVideoElement, b: Box): number | null => {
    const c = (sampler.current ??= document.createElement("canvas"));
    c.width = 64;
    c.height = 64;
    const g = c.getContext("2d", { willReadFrequently: true });
    if (!g || b.w < 8 || b.h < 8) return null;
    const sx = b.x + b.w * 0.15;
    const sy = b.y + b.h * 0.15;
    try {
      g.drawImage(v, sx, sy, b.w * 0.7, b.h * 0.7, 0, 0, 64, 64);
      return metallicLook(g.getImageData(0, 0, 64, 64).data).score;
    } catch {
      return null;
    }
  };

  const stop = () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setStatus("off");
    setSees(null);
    onFrameRef.current({ closure: null, fps: 0 });
  };

  useEffect(() => () => {
    if (raf.current) cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const start = async () => {
    setError(null);
    setStatus("loading");
    try {
      const [t, d, s] = await Promise.all([
        tracker.current ? Promise.resolve(tracker.current) : createHandTracker(),
        detector.current ? Promise.resolve(detector.current) : createObjectDetector(),
        navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: "user" }, audio: false }),
      ]);
      tracker.current = t;
      detector.current = d;
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
          : `Could not start the webcam AI: ${errorMessage(e)}`,
      );
    }
  };

  const loop = () => {
    let smooth: number | null = null;
    let lastTime = -1;
    let frames = 0;
    let fpsStart = performance.now();
    let lastFps = 0;
    let lastDetect = 0;
    let boxes: Box[] = [];
    let candidate: string | null = null;
    let hits = 0;
    let misses = 0;
    let committed: string | null = null;
    let lookClass: string | null = null;
    let lookScores: number[] = [];
    let isMetal = false;
    let metalBoxes: { coco: string; metal: boolean; metallic: number } | null = null;

    const step = () => {
      const v = video.current;
      const t = tracker.current;
      if (!v || !t || !stream.current) return;
      if (v.readyState >= 2 && v.currentTime !== lastTime) {
        lastTime = v.currentTime;
        const now = performance.now();

        // Everyday-object detection (a few times per second).
        const d = detector.current;
        if (d && detectRef.current && now - lastDetect >= DETECT_MS) {
          lastDetect = now;
          const res = d.detectForVideo(v, now);
          boxes = (res.detections ?? []).map((det) => {
            const c = det.categories[0];
            const b = det.boundingBox!;
            return { coco: c?.categoryName ?? "?", score: c?.score ?? 0, x: b.originX, y: b.originY, w: b.width, h: b.height };
          });
          const raw = pickObject(boxes);
          // Containers: measure how metallic the object looks (rolling average over ~1 s).
          let metallic: number | undefined;
          if (raw && METAL_CAPABLE.has(raw.coco)) {
            if (raw.coco !== lookClass) {
              lookClass = raw.coco;
              lookScores = [];
              isMetal = false;
            }
            const box = boxes.filter((b) => b.coco === raw.coco).sort((a, b) => b.score - a.score)[0];
            const s = box ? sampleLook(v, box) : null;
            if (s !== null) lookScores = [...lookScores.slice(-4), s];
            if (lookScores.length) {
              metallic = lookScores.reduce((a, b) => a + b, 0) / lookScores.length;
              isMetal = isMetal ? metallic >= METAL_OFF : metallic >= METAL_ON;
            }
          }
          const guess = raw ? withLook(raw, metallic, isMetal) : null;
          metalBoxes = guess && metallic !== undefined ? { coco: guess.coco, metal: isMetal, metallic } : null;
          setSees(guess ? { coco: guess.coco, score: guess.score, metal: guess.material === "Steel" && METAL_CAPABLE.has(guess.coco), metallic } : null);
          if (guess) {
            misses = 0;
            // A plastic bottle and a steel bottle count as different detections.
            const key = `${guess.coco}:${guess.material}`;
            hits = key === candidate ? hits + 1 : 1;
            candidate = key;
            if (hits >= STABLE_HITS && key !== committed) {
              committed = key;
              onObjectRef.current?.(guess);
            }
          } else if (++misses >= FORGET_MISSES) {
            // Object left the view: showing it again counts as a new detection.
            committed = null;
            candidate = null;
            hits = 0;
            lookClass = null;
          }
        } else if (!detectRef.current) {
          boxes = [];
        }

        // Hand tracking (every frame).
        const res = t.detectForVideo(v, now);
        const lm = res.landmarks?.[0];
        draw(lm, boxes, metalBoxes);
        if (lm) {
          const c = handClosure(lm);
          smooth = smooth === null ? c : smooth * 0.55 + c * 0.45;
          setStatus("tracking");
        } else {
          smooth = null;
          setStatus("nohand");
        }
        frames++;
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

  const draw = (lm: { x: number; y: number }[] | undefined, boxes: Box[], look: { coco: string; metal: boolean; metallic: number } | null) => {
    const c = canvas.current;
    const v = video.current;
    if (!c || !v) return;
    c.width = v.videoWidth || 640;
    c.height = v.videoHeight || 480;
    const g = c.getContext("2d");
    if (!g) return;
    g.clearRect(0, 0, c.width, c.height);

    for (const b of boxes) {
      if (b.coco === "person") continue;
      const known = !!COCO_TO_OBJECT[b.coco];
      g.strokeStyle = known ? "#34d399" : "rgba(255,255,255,0.55)";
      g.lineWidth = known ? 4 : 2;
      g.strokeRect(b.x, b.y, b.w, b.h);
      // The canvas is mirrored with CSS; un-mirror the text so it reads normally.
      const lookText = look && look.coco === b.coco ? (look.metal ? ` · METAL ${(look.metallic * 100).toFixed(0)}%` : ` · not metal ${(look.metallic * 100).toFixed(0)}%`) : "";
      const text = `${b.coco} ${(b.score * 100).toFixed(0)}%${lookText}`;
      g.save();
      g.scale(-1, 1);
      g.font = "bold 22px ui-monospace, monospace";
      const tw = g.measureText(text).width + 12;
      const tx = -(b.x + b.w);
      const ty = Math.max(0, b.y - 30);
      g.fillStyle = known ? "#34d399" : "rgba(0,0,0,0.6)";
      g.fillRect(tx, ty, tw, 28);
      g.fillStyle = known ? "#04121a" : "#fff";
      g.fillText(text, tx + 6, ty + 21);
      g.restore();
    }

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
          {status === "tracking" ? "HAND TRACKED" : status === "nohand" ? "SHOW YOUR HAND" : status === "loading" ? "LOADING CAMERA AI…" : "CAMERA OFF"}
        </Badge>
        {running && detectObjects && (
          <Badge tone={sees ? "good" : "neutral"} dot>
            {sees ? `SEES: ${sees.metal ? "STEEL " : ""}${sees.coco.toUpperCase()} ${(sees.score * 100).toFixed(0)}%${sees.metallic !== undefined ? ` · metallic look ${(sees.metallic * 100).toFixed(0)}%` : ""}` : "NO OBJECT"}
          </Badge>
        )}
        {running && <span className="font-mono text-xs text-muted">{fps.toFixed(0)} fps</span>}
        <Badge tone="accent">LIVE CAMERA</Badge>
      </div>
      {error && <Notice tone="bad">{error}</Notice>}
      {/* Floating camera window: stays visible next to the 3D hand while the page scrolls. */}
      <div
        className={running ? "fixed bottom-4 right-4 z-40 w-[300px] overflow-hidden rounded-xl border border-line-strong bg-black shadow-2xl sm:w-[360px]" : "hidden"}
        data-testid="webcam-window"
      >
        <div className="relative">
          {/* Mirrored like a mirror, so moving your right hand moves the right side of the picture. */}
          <video ref={video} playsInline muted className="block w-full -scale-x-100" />
          <canvas ref={canvas} className="pointer-events-none absolute inset-0 h-full w-full -scale-x-100" />
          <div className="absolute left-2 top-2 flex flex-wrap gap-1">
            <Badge tone="bad" dot>
              LIVE
            </Badge>
            {detectObjects && sees && <Badge tone="good">{`${sees.metal ? "steel " : ""}${sees.coco} ${(sees.score * 100).toFixed(0)}%`}</Badge>}
          </div>
        </div>
      </div>
    </div>
  );
}
