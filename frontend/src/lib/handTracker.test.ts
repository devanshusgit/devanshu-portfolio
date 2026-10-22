import { describe, expect, it } from "vitest";
import { handClosure, type Landmark } from "./handTracker";

/** Synthetic hand: wrist at origin, knuckles 0.1 above it, fingertips at `tipRatio` × knuckle distance. */
function hand(tipRatio: number): Landmark[] {
  const lm: Landmark[] = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }));
  [5, 9, 13, 17].forEach((mcp, i) => {
    const x = (i - 1.5) * 0.03;
    lm[mcp] = { x, y: -0.1, z: 0, visibility: 1 };
    lm[mcp + 3] = { x: x * tipRatio, y: -0.1 * tipRatio, z: 0, visibility: 1 };
  });
  return lm;
}

describe("handClosure", () => {
  it("is about 0 for an open hand and about 1 for a fist", () => {
    expect(handClosure(hand(1.95))).toBeLessThan(0.05);
    expect(handClosure(hand(1.0))).toBeGreaterThan(0.95);
  });
  it("increases as the hand closes", () => {
    expect(handClosure(hand(1.6))).toBeLessThan(handClosure(hand(1.3)));
  });
});
