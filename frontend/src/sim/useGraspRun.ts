import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "@/api/client";
import type { DataSource, Features, Material, PredictionResult } from "@/api/types";
import { CancelledError, MotionController } from "./motion";
import { transition, type HandState } from "./stateMachine";

export interface AcquiredSample {
  features: Features;
  sourceLabel: string;
  groundTruth: Material | null;
  simulated: boolean;
  meta?: Record<string, unknown>;
}

/** A data source plugged into the grasp cycle. All three modes implement this. */
export interface GraspSource {
  kind: DataSource;
  /** SENSING: obtain the reading (simulated provider, uploaded row, live buffer). */
  acquire: () => Promise<AcquiredSample>;
  /** ANALYZING: send the reading through the backend's canonical pipeline. */
  analyze: (sample: AcquiredSample) => Promise<PredictionResult>;
}

export interface Visit {
  state: HandState;
  at: number;
}

export interface RunSnapshot {
  state: HandState;
  visits: Visit[];
  sample: AcquiredSample | null;
  result: PredictionResult | null;
  error: string | null;
  running: boolean;
  cycle: number;
}

const INITIAL: RunSnapshot = { state: "IDLE", visits: [], sample: null, result: null, error: null, running: false, cycle: 0 };

export function useGraspRun(options: { speed?: number; reducedMotion?: boolean } = {}) {
  const motion = useMemo(() => new MotionController(), []);
  const [snap, setSnap] = useState<RunSnapshot>(INITIAL);
  const stateRef = useRef<HandState>("IDLE");
  const runToken = useRef(0);
  const pausedRef = useRef(false);
  const [paused, setPausedState] = useState(false);

  motion.speed = options.speed ?? 1;
  motion.reduced = !!options.reducedMotion;

  useEffect(() => () => {
    runToken.current++;
    motion.epoch++;
  }, [motion]);

  const go = useCallback((next: HandState, token: number) => {
    if (token !== runToken.current) throw new CancelledError();
    const state = transition(stateRef.current, next);
    stateRef.current = state;
    setSnap((s) => ({ ...s, state, visits: [...s.visits, { state, at: performance.now() }] }));
  }, []);

  const fail = useCallback(
    (e: unknown, token: number) => {
      if (e instanceof CancelledError || token !== runToken.current) return;
      stateRef.current = "ERROR";
      setSnap((s) => ({ ...s, state: "ERROR", error: errorMessage(e), running: false, visits: [...s.visits, { state: "ERROR", at: performance.now() }] }));
      // Return the hand to a safe, open, retracted pose.
      motion.to("squeeze", 0, 300).catch(() => undefined);
      motion.to("lift", 0, 600).catch(() => undefined);
      motion.to("closure", 0, 600).catch(() => undefined);
      motion.to("sensors", 0, 400).catch(() => undefined);
      motion.to("approach", 0, 900).catch(() => undefined);
    },
    [motion],
  );

  /** OPEN -> APPROACHING -> SENSING -> CONTACT -> ANALYZING -> ... -> HOLDING */
  const acquireAndGrip = useCallback(
    async (source: GraspSource, token: number, resense: boolean) => {
      go("SENSING", token);
      motion.to("sensors", 0.45, 450).catch(() => undefined);
      if (resense) motion.to("squeeze", 0.2, 350).catch(() => undefined);
      const [sample] = await Promise.all([source.acquire(), motion.wait(resense ? 450 : 700)]);
      if (token !== runToken.current) throw new CancelledError();
      setSnap((s) => ({ ...s, sample }));

      go("CONTACT", token);
      motion.to("sensors", 1, 350).catch(() => undefined);
      await motion.to("closure", 1, resense ? 300 : 850);

      go("ANALYZING", token);
      const [result] = await Promise.all([source.analyze(sample), motion.wait(resense ? 350 : 650)]);
      if (token !== runToken.current) throw new CancelledError();
      // The backend echoes the exact features it processed - display those.
      setSnap((s) => ({ ...s, result, sample: { ...sample, features: result.sample } }));

      go("PREDICTED", token);
      await motion.wait(resense ? 500 : 1000);
      go("GRIP_DECISION", token);
      await motion.wait(resense ? 500 : 1000);

      go("GRIPPING", token);
      const speed = Math.max(0.15, result.command.closure_speed);
      await motion.to("squeeze", 1, 400 + 700 / speed);
      go("HOLDING", token);
      return result;
    },
    [go, motion],
  );

  const release = useCallback(
    async (token: number, liftSpeed: number) => {
      go("RELEASING", token);
      await motion.to("lift", 0, 900 / liftSpeed);
      await Promise.all([motion.to("squeeze", 0, 350), motion.to("closure", 0, 700)]);
      motion.to("sensors", 0, 400).catch(() => undefined);
      await motion.to("approach", 0, 900);
      go("COMPLETED", token);
    },
    [go, motion],
  );

  const begin = useCallback(async (token: number) => {
    setSnap((s) => ({ ...INITIAL, cycle: s.cycle + 1, running: true }));
    go("OPEN", token);
    await Promise.all([motion.to("squeeze", 0, 250), motion.to("lift", 0, 250), motion.to("closure", 0, 550), motion.to("approach", 0, 300)]);
    go("APPROACHING", token);
    await motion.to("approach", 1, 1300);
  }, [go, motion]);

  /** Full grasp cycle for a single sample. */
  const run = useCallback(
    async (source: GraspSource): Promise<PredictionResult | null> => {
      const token = ++runToken.current;
      motion.epoch++;
      stateRef.current = ["IDLE", "COMPLETED", "ERROR"].includes(stateRef.current) ? stateRef.current : "IDLE";
      try {
        await begin(token);
        const result = await acquireAndGrip(source, token, false);
        await motion.wait(result.command.hold_ms);
        go("LIFTING", token);
        await motion.to("lift", 1, 1300 / result.command.lift_speed);
        await motion.wait(600);
        await release(token, result.command.lift_speed);
        setSnap((s) => ({ ...s, running: false }));
        return result;
      } catch (e) {
        fail(e, token);
        return null;
      }
    },
    [acquireAndGrip, begin, fail, go, motion, release],
  );

  /**
   * Dataset playback: approach once, then every row re-enters SENSING -> ... ->
   * HOLDING through the same pipeline; the hand re-grips with each row's command.
   */
  const playback = useCallback(
    async (count: number, sourceFor: (i: number) => GraspSource, onIndex?: (i: number) => void, startAt = 0) => {
      const token = ++runToken.current;
      motion.epoch++;
      pausedRef.current = false;
      setPausedState(false);
      stateRef.current = ["IDLE", "COMPLETED", "ERROR"].includes(stateRef.current) ? stateRef.current : "IDLE";
      let liftSpeed = 1;
      try {
        await begin(token);
        for (let i = startAt; i < count; i++) {
          while (pausedRef.current) {
            await motion.wait(120, false);
            if (token !== runToken.current) throw new CancelledError();
          }
          onIndex?.(i);
          const result = await acquireAndGrip(sourceFor(i), token, i !== startAt);
          liftSpeed = result.command.lift_speed;
          await motion.wait(Math.min(result.command.hold_ms, 900));
        }
        await release(token, liftSpeed);
        setSnap((s) => ({ ...s, running: false }));
      } catch (e) {
        fail(e, token);
      }
    },
    [acquireAndGrip, begin, fail, motion, release],
  );

  const setPaused = useCallback((p: boolean) => {
    pausedRef.current = p;
    setPausedState(p);
  }, []);

  /** Abort the current run and return the hand to rest. */
  const reset = useCallback(() => {
    runToken.current++;
    motion.reset();
    pausedRef.current = false;
    setPausedState(false);
    stateRef.current = "IDLE";
    setSnap((s) => ({ ...INITIAL, cycle: s.cycle }));
  }, [motion]);

  return { motion, ...snap, paused, run, playback, setPaused, reset };
}

export type GraspRun = ReturnType<typeof useGraspRun>;
