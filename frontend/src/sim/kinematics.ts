/**
 * Prosthetic hand kinematics.
 *
 * Hand-local frame: wrist at the origin, fingers extend along +Y, the palm's
 * contact face points to +Z, the thumb sits on the +X side. Every digit is a planar
 * chain of three phalanges that flexes about the local X axis.
 *
 * The contact pose for an object is not hand-tuned per object: a wrap solver curls
 * each phalanx until it touches the object's cross-section at that digit's height
 * (circle for cylinders/spheres/bottles, square for boxes). The grip decision from
 * the backend then adds a force-dependent squeeze beyond contact.
 */
import type { Finger, VirtualObject } from "@/api/types";

export interface DigitSpec {
  x: number; // height of the digit's plane in hand-local X
  base: [number, number]; // (y, z) of the first joint in hand-local coordinates
  heading: number; // initial direction angle in the YZ plane (0 = +Y)
  sign: 1 | -1; // flexion direction (towards +Z)
  lengths: [number, number, number];
}

export const HAND = {
  palmLength: 0.95,
  palmWidth: 0.86,
  palmThickness: 0.26,
  fingerRadius: 0.068,
  gap: 0.012,
  maxJoint: [1.65, 1.9, 1.45] as const,
  digits: {
    thumb: { x: 0.37, base: [0.24, 0.07], heading: Math.PI, sign: -1, lengths: [0.36, 0.28, 0.22] },
    index: { x: 0.29, base: [0.95, 0], heading: 0, sign: 1, lengths: [0.42, 0.26, 0.2] },
    middle: { x: 0.095, base: [0.97, 0], heading: 0, sign: 1, lengths: [0.46, 0.29, 0.21] },
    ring: { x: -0.1, base: [0.95, 0], heading: 0, sign: 1, lengths: [0.43, 0.27, 0.2] },
    little: { x: -0.29, base: [0.9, 0], heading: 0, sign: 1, lengths: [0.34, 0.22, 0.17] },
  } satisfies Record<Finger, DigitSpec>,
};

export const DIGITS: Finger[] = ["thumb", "index", "middle", "ring", "little"];

export type JointAngles = [number, number, number];
export type HandPose = Record<Finger, JointAngles>;

/** Open (pre-shape) pose: fingers straight, thumb up (see thumbAbduction) with a relaxed curl toward the palm. */
export const OPEN_POSE: HandPose = {
  thumb: [0.4, 0.45, 0.3],
  index: [-0.05, 0.02, 0.02],
  middle: [-0.05, 0.02, 0.02],
  ring: [-0.05, 0.02, 0.02],
  little: [-0.05, 0.02, 0.02],
};

/** Relaxed curl for digits that have nothing to touch. */
const RELAXED: JointAngles = [0.55, 0.7, 0.45];

type Section = { kind: "circle"; r: number } | { kind: "square"; h: number } | null;

/** Cross-section of the object at world height y (object base at y = 0). */
export function sectionAt(obj: VirtualObject, y: number): Section {
  const d = obj.dimensions;
  const height = d.height ?? (d.radius ?? 0.4) * 2;
  if (y < 0 || y > height) return null;
  switch (obj.shape) {
    case "sphere": {
      const r = d.radius;
      const dy = y - r;
      return Math.abs(dy) < r ? { kind: "circle", r: Math.sqrt(r * r - dy * dy) } : null;
    }
    case "box":
      return { kind: "square", h: (d.size ?? 0.7) / 2 };
    case "bottle": {
      const shoulder = d.shoulder ?? height * 0.65;
      const neckStart = shoulder + 0.22;
      if (y <= shoulder) return { kind: "circle", r: d.radius };
      if (y >= neckStart) return { kind: "circle", r: d.neck_radius };
      const t = (y - shoulder) / (neckStart - shoulder);
      return { kind: "circle", r: d.radius + (d.neck_radius - d.radius) * (t * t * (3 - 2 * t)) };
    }
    default:
      return { kind: "circle", r: d.radius };
  }
}

export function objectHeight(obj: VirtualObject): number {
  return obj.dimensions.height ?? obj.dimensions.radius * 2;
}

export interface GraspPlacement {
  handY: number; // world Y of the hand-local origin
  originX: number; // world X of the hand-local origin when in contact
  center: [number, number]; // object axis in hand-local (y, z)
}

export function placement(obj: VirtualObject, palmHeightFraction?: number): GraspPlacement {
  const height = objectHeight(obj);
  const handY = height * (palmHeightFraction ?? obj.profile.palm_height_fraction);
  const s = sectionAt(obj, Math.min(Math.max(handY, 0.01), height - 0.01));
  const reach = s ? (s.kind === "circle" ? s.r : s.h) : obj.dimensions.radius ?? 0.3;
  const originX = reach + HAND.gap + HAND.palmThickness / 2;
  return { handY, originX, center: [HAND.palmLength / 2, originX] };
}

function sdf(section: Exclude<Section, null>, c: [number, number], p: [number, number]): number {
  const dy = p[0] - c[0];
  const dz = p[1] - c[1];
  if (section.kind === "circle") return Math.hypot(dy, dz) - section.r - HAND.fingerRadius;
  const qy = Math.abs(dy) - section.h;
  const qz = Math.abs(dz) - section.h;
  const outside = Math.hypot(Math.max(qy, 0), Math.max(qz, 0));
  return outside + Math.min(Math.max(qy, qz), 0) - HAND.fingerRadius;
}

/** Curl one digit chain until each phalanx touches the cross-section. */
export function solveDigit(spec: DigitSpec, section: Section, center: [number, number]): JointAngles {
  if (!section) return [...RELAXED] as JointAngles;
  const angles: number[] = [];
  let p: [number, number] = [spec.base[0], spec.base[1]];
  let theta = spec.heading;
  const minDist = (phi: number, len: number) => {
    const a = theta + spec.sign * phi;
    let m = Infinity;
    for (const t of [0.35, 0.7, 1]) m = Math.min(m, sdf(section, center, [p[0] + Math.cos(a) * len * t, p[1] + Math.sin(a) * len * t]));
    return m;
  };
  for (let i = 0; i < 3; i++) {
    const len = spec.lengths[i];
    const maxJ = HAND.maxJoint[i];
    let phi = 0;
    if (minDist(0, len) > 0) {
      let prev = 0;
      let found = -1;
      let best = 0;
      let bestD = Infinity;
      for (let f = 0.02; f <= maxJ + 1e-9; f += 0.02) {
        const dd = minDist(f, len);
        if (dd < bestD) {
          bestD = dd;
          best = f;
        }
        if (dd <= 0) {
          found = f;
          break;
        }
        prev = f;
      }
      if (found >= 0) {
        let lo = prev;
        let hi = found;
        for (let k = 0; k < 14; k++) {
          const mid = (lo + hi) / 2;
          if (minDist(mid, len) > 0) lo = mid;
          else hi = mid;
        }
        phi = lo;
      } else {
        // Cannot reach yet: curl to the closest approach so distal phalanges can wrap.
        phi = best;
      }
    }
    angles.push(phi);
    theta += spec.sign * phi;
    p = [p[0] + Math.cos(theta) * len, p[1] + Math.sin(theta) * len];
  }
  return angles as JointAngles;
}

/** Contact pose for an object: every digit wrapped onto the object surface. */
export function contactPose(obj: VirtualObject, palmHeightFraction?: number): HandPose {
  const { handY, center } = placement(obj, palmHeightFraction);
  const height = objectHeight(obj);
  const pose = {} as HandPose;
  for (const finger of DIGITS) {
    const spec = HAND.digits[finger] as DigitSpec;
    let y = handY + spec.x;
    // The thumb hooks over the top edge of short objects instead of missing them.
    if (finger === "thumb") y = Math.min(y, height - 0.04);
    pose[finger] = solveDigit(spec, sectionAt(obj, y), center);
  }
  return pose;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Thumb swing about the palm normal when fully open: points it along +X (up in the lab) instead of back along the forearm. */
export const THUMB_OPEN_ABDUCTION = Math.PI / 2;

/**
 * Thumb abduction (radians, about the palm normal) for a given closure. The thumb
 * stands up while the hand is open and swings into the opposing plane the wrap
 * solver uses as the fingers close, reaching it before contact (closure 0.75).
 */
export function thumbAbduction(closure: number): number {
  const t = Math.min(1, Math.max(0, closure / 0.75));
  return THUMB_OPEN_ABDUCTION * (1 - t * t * (3 - 2 * t));
}

/**
 * Blend open -> contact by `closure` (0..1), then add a force-dependent squeeze.
 * `force` is the per-digit normalised force from the backend's SimulationCommand,
 * `squeeze` (0..1) is the GRIPPING animation progress.
 */
export function blendPose(
  contact: HandPose,
  closure: number,
  squeeze: number,
  force: Partial<Record<Finger, number>>,
  compliance: number,
): HandPose {
  const out = {} as HandPose;
  for (const f of DIGITS) {
    const extra = squeeze * (force[f] ?? 0) * (0.07 + 0.32 * compliance);
    out[f] = [0, 1, 2].map((j) => lerp(OPEN_POSE[f][j], contact[f][j], closure) + extra * (j === 0 ? 0.6 : 1)) as JointAngles;
  }
  return out;
}

/** Fingertip position of a digit in hand-local coordinates (for sensor markers). */
export function fingertip(finger: Finger, angles: JointAngles): [number, number, number] {
  const spec = HAND.digits[finger] as DigitSpec;
  let y = spec.base[0];
  let z = spec.base[1];
  let theta = spec.heading;
  for (let i = 0; i < 3; i++) {
    theta += spec.sign * angles[i];
    y += Math.cos(theta) * spec.lengths[i];
    z += Math.sin(theta) * spec.lengths[i];
  }
  return [spec.x, y, z];
}
