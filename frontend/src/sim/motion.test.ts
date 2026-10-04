import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CancelledError, MotionController } from "./motion";

describe("MotionController", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("tweens a channel and resolves when the motion completes", async () => {
    const m = new MotionController();
    const done = m.to("closure", 1, 1000);
    expect(m.target("closure")).toBe(1);
    vi.advanceTimersByTime(1000);
    await expect(done).resolves.toBeUndefined();
  });

  it("playback speed shortens durations", () => {
    const m = new MotionController();
    m.speed = 2;
    expect(m.scaled(1000)).toBe(500);
    m.reduced = true;
    expect(m.scaled(1000)).toBe(60);
  });

  it("reset cancels pending waits", async () => {
    const m = new MotionController();
    const p = m.wait(500);
    m.reset();
    vi.advanceTimersByTime(600);
    await expect(p).rejects.toBeInstanceOf(CancelledError);
  });
});
