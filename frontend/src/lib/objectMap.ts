import type { Material } from "@/api/types";

/** What the camera recognised, mapped to a NeuroGrip virtual object and its typical material. */
export interface ObjectGuess {
  coco: string;
  score: number;
  objectId: string;
  material: Material;
  label: string;
  /** Visual metallic score 0..1 of the object's pixels (containers only), if measured. */
  metallic?: number;
}

/**
 * COCO class (from the webcam object detector) -> virtual object + typical material.
 * The camera recognises the object type; the material is the usual one for that type,
 * except for containers that look metallic (see `withLook`).
 */
export const COCO_TO_OBJECT: Record<string, { objectId: string; material: Material; label: string }> = {
  "wine glass": { objectId: "glass", material: "Glass", label: "Wine glass" },
  cup: { objectId: "glass", material: "Glass", label: "Cup / mug" },
  vase: { objectId: "glass", material: "Glass", label: "Vase" },
  bottle: { objectId: "bottle", material: "Plastic", label: "Bottle" },
  bowl: { objectId: "container", material: "Plastic", label: "Bowl" },
  spoon: { objectId: "steel", material: "Steel", label: "Spoon" },
  fork: { objectId: "steel", material: "Steel", label: "Fork" },
  knife: { objectId: "steel", material: "Steel", label: "Knife" },
  scissors: { objectId: "steel", material: "Steel", label: "Scissors" },
  "sports ball": { objectId: "ball", material: "Rubber", label: "Ball" },
  orange: { objectId: "ball", material: "Rubber", label: "Orange (soft)" },
  apple: { objectId: "ball", material: "Rubber", label: "Apple (soft)" },
  "teddy bear": { objectId: "ball", material: "Fabric", label: "Soft toy" },
  backpack: { objectId: "container", material: "Fabric", label: "Bag" },
  handbag: { objectId: "container", material: "Fabric", label: "Bag" },
  "cell phone": { objectId: "cube", material: "Plastic", label: "Phone" },
  remote: { objectId: "cube", material: "Plastic", label: "Remote" },
  mouse: { objectId: "cube", material: "Plastic", label: "Mouse" },
  book: { objectId: "cube", material: "Wood", label: "Book (paper)" },
};

/** Best recognised object in one detection result, ignoring people and unmapped classes. */
export function pickObject(dets: { coco: string; score: number }[], minScore = 0.45): ObjectGuess | null {
  let best: ObjectGuess | null = null;
  for (const d of dets) {
    const m = COCO_TO_OBJECT[d.coco];
    if (!m || d.score < minScore) continue;
    if (!best || d.score > best.score) best = { coco: d.coco, score: d.score, ...m };
  }
  return best;
}

/** Containers that also come in stainless steel (steel bottle, steel mug, steel bowl…). */
export const METAL_CAPABLE = new Set(["bottle", "cup", "bowl", "vase", "wine glass"]);

/** Apply the visual metallic verdict: a metallic-looking bottle becomes a steel bottle. */
export function withLook(guess: ObjectGuess, metallic: number | undefined, isMetal: boolean): ObjectGuess {
  if (!METAL_CAPABLE.has(guess.coco)) return guess;
  if (!isMetal) return { ...guess, metallic };
  return { ...guess, metallic, material: "Steel", label: `Steel ${guess.label.toLowerCase()}` };
}
