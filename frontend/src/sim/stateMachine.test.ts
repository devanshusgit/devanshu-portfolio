import { describe, expect, it } from "vitest";
import { canTransition, HAND_STATES, InvalidTransitionError, pipelineStageFor, SEQUENCE, transition, TRANSITIONS } from "./stateMachine";

describe("hand state machine", () => {
  it("allows the full canonical grasp sequence in order", () => {
    let s = transition("IDLE", "OPEN");
    for (const next of SEQUENCE.slice(1)) s = transition(s, next);
    expect(s).toBe("COMPLETED");
  });

  it("covers every required state", () => {
    for (const s of ["IDLE", "OPEN", "APPROACHING", "SENSING", "CONTACT", "ANALYZING", "PREDICTED", "GRIP_DECISION", "GRIPPING", "HOLDING", "LIFTING", "RELEASING", "COMPLETED"]) {
      expect(HAND_STATES).toContain(s);
    }
  });

  it("rejects skipping the AI stages", () => {
    expect(() => transition("CONTACT", "GRIPPING")).toThrow(InvalidTransitionError);
    expect(() => transition("SENSING", "PREDICTED")).toThrow(InvalidTransitionError);
    expect(() => transition("ANALYZING", "GRIP_DECISION")).toThrow(InvalidTransitionError);
    expect(() => transition("IDLE", "GRIPPING")).toThrow(InvalidTransitionError);
  });

  it("supports dataset playback re-sensing and error recovery", () => {
    expect(canTransition("HOLDING", "SENSING")).toBe(true);
    expect(canTransition("ANALYZING", "ERROR")).toBe(true);
    expect(canTransition("ERROR", "OPEN")).toBe(true);
    expect(canTransition("COMPLETED", "OPEN")).toBe(true);
  });

  it("every transition target is a known state", () => {
    for (const targets of Object.values(TRANSITIONS)) for (const t of targets) expect(HAND_STATES).toContain(t);
  });

  it("maps states onto pipeline stages", () => {
    expect(pipelineStageFor("SENSING")).toBe(0);
    expect(pipelineStageFor("ANALYZING")).toBe(2);
    expect(pipelineStageFor("PREDICTED")).toBe(3);
    expect(pipelineStageFor("GRIP_DECISION")).toBe(4);
    expect(pipelineStageFor("GRIPPING")).toBe(5);
    expect(pipelineStageFor("IDLE")).toBe(-1);
  });
});
