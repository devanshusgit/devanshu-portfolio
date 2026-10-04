import * as THREE from "three";

/** Procedural textures (generated once, no network assets). */
function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): THREE.CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let woodTex: THREE.CanvasTexture | null | undefined;
let fabricTex: THREE.CanvasTexture | null | undefined;

function woodTexture() {
  if (woodTex !== undefined) return woodTex;
  woodTex = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = "#b7773d";
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 70; i++) {
      const y = (i / 70) * s + Math.sin(i * 1.7) * 3;
      ctx.strokeStyle = `rgba(${90 + (i % 5) * 8}, ${50 + (i % 3) * 6}, 20, ${0.18 + (i % 4) * 0.06})`;
      ctx.lineWidth = 1 + (i % 3);
      ctx.beginPath();
      for (let x = 0; x <= s; x += 8) ctx.lineTo(x, y + Math.sin(x / 23 + i) * 2.5);
      ctx.stroke();
    }
  });
  return woodTex;
}

function fabricTexture() {
  if (fabricTex !== undefined) return fabricTex;
  fabricTex = canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = "#7c63c9";
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < s; i += 4) {
      ctx.fillStyle = i % 8 ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.12)";
      ctx.fillRect(i, 0, 2, s);
      ctx.fillRect(0, i, s, 2);
    }
  });
  if (fabricTex) fabricTex.repeat.set(4, 4);
  return fabricTex;
}

export type Appearance = "Glass" | "Steel" | "Plastic" | "Wood" | "Rubber" | "Fabric" | "Unknown";

const cache = new Map<Appearance, THREE.Material>();

/** Physical look of the object's material in the scene (not the chart palette). */
export function objectMaterial(kind: Appearance): THREE.Material {
  const hit = cache.get(kind);
  if (hit) return hit;
  let m: THREE.Material;
  switch (kind) {
    case "Glass":
      m = new THREE.MeshPhysicalMaterial({
        color: "#e6f6ff",
        transmission: 0.92,
        roughness: 0.04,
        thickness: 0.06,
        ior: 1.5,
        transparent: true,
        opacity: 0.55,
        clearcoat: 1,
        side: THREE.DoubleSide,
      });
      break;
    case "Steel":
      m = new THREE.MeshStandardMaterial({ color: "#d9dfe7", metalness: 0.72, roughness: 0.28 });
      break;
    case "Plastic":
      m = new THREE.MeshPhysicalMaterial({ color: "#2fc4b2", roughness: 0.32, clearcoat: 0.6, clearcoatRoughness: 0.3 });
      break;
    case "Wood":
      m = new THREE.MeshStandardMaterial({ color: "#ffffff", map: woodTexture() ?? undefined, roughness: 0.78 });
      break;
    case "Rubber":
      m = new THREE.MeshStandardMaterial({ color: "#d4442b", roughness: 0.9 });
      break;
    case "Fabric":
      m = new THREE.MeshStandardMaterial({ color: "#ffffff", map: fabricTexture() ?? undefined, roughness: 1 });
      break;
    default:
      m = new THREE.MeshStandardMaterial({ color: "#7a889c", roughness: 0.55, transparent: true, opacity: 0.8 });
  }
  cache.set(kind, m);
  return m;
}

export const HAND_MATERIALS = {
  shell: new THREE.MeshStandardMaterial({ color: "#e7ecf3", roughness: 0.38, metalness: 0.08 }),
  joint: new THREE.MeshStandardMaterial({ color: "#1c2535", roughness: 0.42, metalness: 0.65 }),
  carbon: new THREE.MeshStandardMaterial({ color: "#232c3b", roughness: 0.5, metalness: 0.35 }),
  accent: new THREE.MeshStandardMaterial({ color: "#22d3ee", emissive: "#22d3ee", emissiveIntensity: 1.2, roughness: 0.3 }),
};
