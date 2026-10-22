/**
 * Webcam hand tracking (Google MediaPipe Hand Landmarker, runs fully in the browser).
 * Gives 21 real 3D landmarks of the user's hand per frame; `handClosure` turns them into
 * a grip intent: 0 = open hand, 1 = closed fist.
 */
import { FilesetResolver, HandLandmarker, ObjectDetector, type NormalizedLandmark } from "@mediapipe/tasks-vision";

export type Landmark = NormalizedLandmark;

let filesetPromise: ReturnType<typeof FilesetResolver.forVisionTasks> | null = null;
const fileset = () => (filesetPromise ??= FilesetResolver.forVisionTasks("/mediapipe/wasm"));

/** Everyday-object detector (EfficientDet-Lite0, 80 COCO classes), served from public/models. */
export async function createObjectDetector(): Promise<ObjectDetector> {
  const fs = await fileset();
  const options = (delegate: "GPU" | "CPU") => ({
    baseOptions: { modelAssetPath: "/models/efficientdet_lite0.tflite", delegate },
    runningMode: "VIDEO" as const,
    scoreThreshold: 0.35,
    maxResults: 5,
  });
  try {
    return await ObjectDetector.createFromOptions(fs, options("GPU"));
  } catch {
    return ObjectDetector.createFromOptions(fs, options("CPU"));
  }
}

export async function createHandTracker(): Promise<HandLandmarker> {
  const fs = await fileset();
  const options = (delegate: "GPU" | "CPU") => ({
    baseOptions: { modelAssetPath: "/models/hand_landmarker.task", delegate },
    runningMode: "VIDEO" as const,
    numHands: 1,
    minHandDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  try {
    return await HandLandmarker.createFromOptions(fs, options("GPU"));
  } catch {
    return HandLandmarker.createFromOptions(fs, options("CPU"));
  }
}

const dist = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** [mcp, tip] landmark indices for index, middle, ring and little fingers. */
const FINGERS: [number, number][] = [
  [5, 8],
  [9, 12],
  [13, 16],
  [17, 20],
];

/**
 * Grip intent from finger curl. For each finger, tip-to-wrist distance relative to
 * knuckle-to-wrist distance is about 1.9 when straight and about 1.0 when curled into a fist.
 * The ratio does not depend on how far the hand is from the camera.
 */
export function handClosure(lm: Landmark[]): number {
  const wrist = lm[0];
  let sum = 0;
  for (const [mcp, tip] of FINGERS) {
    const ratio = dist(wrist, lm[tip]) / Math.max(1e-6, dist(wrist, lm[mcp]));
    sum += Math.min(1, Math.max(0, (1.85 - ratio) / (1.85 - 1.05)));
  }
  return sum / FINGERS.length;
}

/** Bones to draw on the camera preview. */
export const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
];
