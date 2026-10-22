// Copies the MediaPipe hand-tracking engine (WASM) into public/ so the app serves it itself.
import { cpSync, mkdirSync } from "node:fs";
const src = new URL("../node_modules/@mediapipe/tasks-vision/wasm/", import.meta.url);
const dest = new URL("../public/mediapipe/wasm/", import.meta.url);
mkdirSync(dest, { recursive: true });
for (const f of ["vision_wasm_internal.js", "vision_wasm_internal.wasm", "vision_wasm_nosimd_internal.js", "vision_wasm_nosimd_internal.wasm"]) {
  cpSync(new URL(f, src), new URL(f, dest));
}
console.log("MediaPipe WASM copied to public/mediapipe/wasm");
