import { Check } from "lucide-react";
import { cx } from "@/components/ui";
import { SEQUENCE, STATE_INFO, type HandState } from "@/sim/stateMachine";
import type { Visit } from "@/sim/useGraspRun";

/** Live hand-state machine display: visited states, the current state and its meaning. */
export function StateTimeline({ state, visits }: { state: HandState; visits: Visit[] }) {
  const visited = new Set(visits.map((v) => v.state));
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted">Hand state</span>
          <span
            data-testid="hand-state"
            className={cx(
              "rounded-md px-2 py-0.5 font-mono text-xs font-semibold tracking-wider",
              state === "ERROR" ? "bg-bad-soft text-bad" : state === "COMPLETED" ? "bg-good-soft text-good" : state === "IDLE" ? "bg-surface-3 text-ink-2" : "bg-accent-soft text-accent",
            )}
          >
            {state}
          </span>
        </div>
        <span className="hidden truncate text-xs text-muted sm:block" aria-live="polite">
          {STATE_INFO[state].description}
        </span>
      </div>
      <ol className="mt-2.5 flex flex-wrap gap-1" aria-label="State sequence">
        {SEQUENCE.map((s) => {
          const current = s === state;
          const past = visited.has(s) && !current;
          return (
            <li
              key={s}
              title={STATE_INFO[s].description}
              className={cx(
                "flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[9.5px] font-medium tracking-wide",
                current && "border-accent bg-accent text-[#04121a]",
                past && "border-good/30 bg-good-soft text-good",
                !current && !past && "border-line text-muted",
              )}
            >
              {past && <Check className="h-2.5 w-2.5" aria-hidden />}
              {s.replace("_", " ")}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
