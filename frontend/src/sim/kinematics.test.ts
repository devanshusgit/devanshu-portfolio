import { describe, expect, it } from "vitest";
import type { VirtualObject } from "@/api/types";
import { blendPose, contactPose, fingertip, HAND, OPEN_POSE, placement, sectionAt, THUMB_OPEN_ABDUCTION, thumbAbduction } from "./kinematics";

const profile = {
  id: "p",
  name: "p",
  grasp_type: "t",
  description: "",
  finger_participation: { thumb: 1, index: 1, middle: 1, ring: 1, little: 1 },
  closure_speed_factor: 1,
  finger_spread: 0,
  palm_height_fraction: 0.48,
  lift_height: 0.5,
  object_fragility: 1,
  max_safe_grip: 40,
};
const glass: VirtualObject = { id: "glass", name: "Glass", shape: "cylinder", default_material: "Glass", dimensions: { radius: 0.34, height: 0.95 }, description: "", profile };
const ball: VirtualObject = { ...glass, id: "ball", shape: "sphere", dimensions: { radius: 0.4, height: 0.8 }, profile: { ...profile, palm_height_fraction: 0.42 } };
const cube: VirtualObject = { ...glass, id: "cube", shape: "box", dimensions: { size: 0.7, height: 0.7 }, profile: { ...profile, palm_height_fraction: 0.5 } };

/** Distance from a fingertip to the object surface in the digit's cross-section. */
function tipGap(obj: VirtualObject, finger: "index" | "middle" | "thumb") {
  const pose = contactPose(obj);
  const { handY, center } = placement(obj);
  const [x, y, z] = fingertip(finger, pose[finger]);
  const sec = sectionAt(obj, handY + x)!;
  const r = sec.kind === "circle" ? sec.r : sec.h;
  return Math.hypot(y - center[0], z - center[1]) - r;
}

describe("kinematics", () => {
  it("computes object cross-sections", () => {
    expect(sectionAt(glass, 0.5)).toEqual({ kind: "circle", r: 0.34 });
    expect(sectionAt(glass, 1.2)).toBeNull();
    const s = sectionAt(ball, 0.4);
    expect(s?.kind === "circle" && s.r).toBeCloseTo(0.4);
    const top = sectionAt(ball, 0.75);
    expect(top?.kind === "circle" && top.r).toBeLessThan(0.4);
    expect(sectionAt(cube, 0.3)).toEqual({ kind: "square", h: 0.35 });
  });

  it("places the palm against the object surface", () => {
    const p = placement(glass);
    expect(p.originX).toBeCloseTo(0.34 + HAND.gap + HAND.palmThickness / 2);
    expect(p.handY).toBeCloseTo(0.95 * 0.48);
  });

  it("wraps fingertips onto the surface rather than through it", () => {
    for (const obj of [glass, ball]) {
      const gap = tipGap(obj, "index");
      // fingertip centre sits about one finger radius from the surface
      expect(gap).toBeGreaterThan(HAND.fingerRadius * 0.4);
      expect(gap).toBeLessThan(HAND.fingerRadius * 2.5);
    }
  });

  it("curls more around a thinner object", () => {
    const thin: VirtualObject = { ...glass, dimensions: { radius: 0.22, height: 0.95 } };
    const sum = (o: VirtualObject) => contactPose(o).index.reduce((a, b) => a + b, 0);
    expect(sum(thin)).toBeGreaterThan(sum(glass));
  });

  it("blends from open pose to contact and squeezes with force", () => {
    const contact = contactPose(glass);
    expect(blendPose(contact, 0, 0, {}, 0)).toEqual(OPEN_POSE);
    const closed = blendPose(contact, 1, 0, {}, 0);
    expect(closed.index[1]).toBeCloseTo(contact.index[1]);
    const gentle = blendPose(contact, 1, 1, { index: 0.2 }, 0);
    const firm = blendPose(contact, 1, 1, { index: 0.8 }, 0);
    expect(firm.index[1]).toBeGreaterThan(gentle.index[1]);
    const compliant = blendPose(contact, 1, 1, { index: 0.8 }, 0.5);
    expect(compliant.index[1]).toBeGreaterThan(firm.index[1]);
  });

  it("stands the thumb up when open and swings it into the grasp plane before contact", () => {
    expect(thumbAbduction(0)).toBeCloseTo(THUMB_OPEN_ABDUCTION);
    expect(thumbAbduction(0.4)).toBeLessThan(THUMB_OPEN_ABDUCTION);
    expect(thumbAbduction(0.4)).toBeGreaterThan(0);
    expect(thumbAbduction(0.75)).toBe(0);
    expect(thumbAbduction(1)).toBe(0);
  });
});
