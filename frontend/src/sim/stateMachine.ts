/**
 * Prosthetic hand simulation state machine.
 *
 * Pure and framework-free so the allowed transitions can be unit-tested. The
 * controller (useGraspRun) only advances a state when the real event that state
 * waits for has happened: an animation finished, a sensor sample was acquired,
 * or the prediction API answered.
 */

export const HAND_STATES = [
  "IDLE",
  "OPEN",
  "APPROACHING",
  "SENSING",
  "CONTACT",
  "ANALYZING",
  "PREDICTED",
  "GRIP_DECISION",
  "GRIPPING",
  "HOLDING",
  "LIFTING",
  "RELEASING",
  "COMPLETED",
  "ERROR",
] as const;

export type HandState = (typeof HAND_STATES)[number];

/** The canonical forward sequence of a full grasp cycle. */
export const SEQUENCE: HandState[] = [
  "OPEN",
  "APPROACHING",
  "SENSING",
  "CONTACT",
  "ANALYZING",
  "PREDICTED",
  "GRIP_DECISION",
  "GRIPPING",
  "HOLDING",
  "LIFTING",
  "RELEASING",
  "COMPLETED",
];

export const TRANSITIONS: Record<HandState, HandState[]> = {
  IDLE: ["OPEN"],
  OPEN: ["APPROACHING", "IDLE", "ERROR"],
  APPROACHING: ["SENSING", "RELEASING", "ERROR"],
  SENSING: ["CONTACT", "RELEASING", "ERROR"],
  CONTACT: ["ANALYZING", "RELEASING", "ERROR"],
  ANALYZING: ["PREDICTED", "RELEASING", "ERROR"],
  PREDICTED: ["GRIP_DECISION", "RELEASING", "ERROR"],
  GRIP_DECISION: ["GRIPPING", "RELEASING", "ERROR"],
  GRIPPING: ["HOLDING", "RELEASING", "ERROR"],
  // HOLDING -> SENSING re-senses the next sample during dataset playback.
  HOLDING: ["LIFTING", "SENSING", "RELEASING", "ERROR"],
  LIFTING: ["RELEASING", "ERROR"],
  RELEASING: ["COMPLETED", "ERROR"],
  COMPLETED: ["OPEN", "IDLE"],
  ERROR: ["OPEN", "IDLE"],
};

export const STATE_INFO: Record<HandState, { label: string; description: string }> = {
  IDLE: { label: "Idle", description: "Hand at rest, waiting for a command." },
  OPEN: { label: "Open", description: "Fingers extend to pre-shape the grasp aperture." },
  APPROACHING: { label: "Approaching", description: "Hand moves towards the object." },
  SENSING: { label: "Sensing", description: "Tactile sensors arm and acquire a reading from the data source." },
  CONTACT: { label: "Contact", description: "Fingertips touch the object; reading captured." },
  ANALYZING: { label: "Analyzing", description: "Sample sent through validation, preprocessing and the random forest." },
  PREDICTED: { label: "Predicted", description: "Material and confidence returned by the model." },
  GRIP_DECISION: { label: "Grip decision", description: "Grip engine computed force, mode and safety status." },
  GRIPPING: { label: "Gripping", description: "Fingers close to the commanded grip at the commanded speed." },
  HOLDING: { label: "Holding", description: "Grip maintained; sensors monitor contact." },
  LIFTING: { label: "Lifting", description: "Object lifted at the commanded lift speed." },
  RELEASING: { label: "Releasing", description: "Object lowered, fingers open, hand retracts." },
  COMPLETED: { label: "Completed", description: "Cycle finished and result stored." },
  ERROR: { label: "Error", description: "A stage failed; the hand returned to a safe open pose." },
};

export class InvalidTransitionError extends Error {}

export function canTransition(from: HandState, to: HandState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function transition(from: HandState, to: HandState): HandState {
  if (!canTransition(from, to)) throw new InvalidTransitionError(`Invalid transition ${from} -> ${to}`);
  return to;
}

/** Which pipeline stage (0-5) a hand state corresponds to, for the visualiser. */
export function pipelineStageFor(state: HandState): number {
  switch (state) {
    case "SENSING":
    case "CONTACT":
      return 0;
    case "ANALYZING":
      return 2;
    case "PREDICTED":
      return 3;
    case "GRIP_DECISION":
      return 4;
    case "GRIPPING":
    case "HOLDING":
    case "LIFTING":
    case "RELEASING":
    case "COMPLETED":
      return 5;
    default:
      return -1;
  }
}
