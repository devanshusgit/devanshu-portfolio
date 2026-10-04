/**
 * Time-based tweening for the 3D hand. The grasp controller sets targets and
 * awaits their completion; the R3F scene samples the channel values every frame
 * (no React re-render per frame).
 */

export type Channel =
  | "approach" // 0 = hand retracted, 1 = palm at the object
  | "closure" // 0 = open pre-shape, 1 = fingertips in contact
  | "squeeze" // 0..1 progress of the commanded grip force
  | "lift" // 0..1 of the commanded lift height
  | "sensors"; // tactile sensor activation 0..1

interface Tween {
  from: number;
  to: number;
  start: number;
  duration: number;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class MotionController {
  private tweens: Record<Channel, Tween>;
  speed = 1;
  reduced = false;
  /** Bumped on every reset so stale awaits from a cancelled run stop early. */
  epoch = 0;

  constructor() {
    const now = performance.now();
    const t = (v: number): Tween => ({ from: v, to: v, start: now, duration: 0 });
    this.tweens = { approach: t(0), closure: t(0), squeeze: t(0), lift: t(0), sensors: t(0) };
  }

  value(ch: Channel, now = performance.now()): number {
    const tw = this.tweens[ch];
    if (tw.duration <= 0) return tw.to;
    const p = Math.min(1, Math.max(0, (now - tw.start) / tw.duration));
    return tw.from + (tw.to - tw.from) * easeInOut(p);
  }

  target(ch: Channel): number {
    return this.tweens[ch].to;
  }

  /** Effective duration after playback speed and reduced-motion preferences. */
  scaled(ms: number): number {
    return this.reduced ? Math.min(ms, 120) / this.speed : ms / this.speed;
  }

  to(ch: Channel, target: number, ms: number): Promise<void> {
    const now = performance.now();
    const duration = this.scaled(ms);
    this.tweens[ch] = { from: this.value(ch, now), to: target, start: now, duration };
    return this.wait(duration, false);
  }

  set(ch: Channel, v: number) {
    this.tweens[ch] = { from: v, to: v, start: performance.now(), duration: 0 };
  }

  /** Resolves after `ms` (already scaled when raw=false). Rejects if reset meanwhile. */
  wait(ms: number, scale = true): Promise<void> {
    const epoch = this.epoch;
    const d = scale ? this.scaled(ms) : ms;
    return new Promise((resolve, reject) =>
      setTimeout(() => (epoch === this.epoch ? resolve() : reject(new CancelledError())), d),
    );
  }

  reset() {
    this.epoch++;
    const now = performance.now();
    (Object.keys(this.tweens) as Channel[]).forEach((ch) => {
      const v = this.value(ch, now);
      this.tweens[ch] = { from: v, to: 0, start: now, duration: this.reduced ? 0 : 700 };
    });
  }
}

export class CancelledError extends Error {
  constructor() {
    super("cancelled");
  }
}
