import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { ArrowRight, BrainCircuit, Cpu, Database, Fingerprint, Gauge, Hand, Radio, ShieldAlert } from "lucide-react";
import { useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import { HandScene } from "@/components/hand/HandScene";
import { Logo } from "@/components/layout/Logo";
import { useAuth } from "@/lib/auth";
import { MATERIAL_ORDER, pct } from "@/lib/format";
import { useReducedMotion } from "@/lib/prefs";
import { MotionController } from "@/sim/motion";

/** Decorative hero preview: a looping open/close on the glass, labelled as a preview. */
function HeroScene() {
  const objects = useQuery({ queryKey: ["objects"], queryFn: api.objects, staleTime: Infinity, retry: 0 });
  const reduced = useReducedMotion();
  const motionCtl = useMemo(() => {
    const m = new MotionController();
    m.set("approach", 1);
    m.set("sensors", 1);
    m.set("closure", 1);
    m.set("squeeze", 0.6);
    return m;
  }, []);
  useEffect(() => {
    if (reduced) return;
    let alive = true;
    const loop = async () => {
      while (alive) {
        try {
          await motionCtl.to("closure", 1, 1400);
          await motionCtl.to("squeeze", 0.8, 700);
          await motionCtl.to("lift", 0.6, 1300);
          await motionCtl.wait(900);
          await motionCtl.to("lift", 0, 1100);
          await motionCtl.to("squeeze", 0, 400);
          await motionCtl.to("closure", 0.15, 1100);
          await motionCtl.wait(600);
        } catch {
          return;
        }
      }
    };
    loop();
    return () => {
      alive = false;
      motionCtl.epoch++;
    };
  }, [motionCtl, reduced]);
  const glass = objects.data?.objects.find((o) => o.id === "glass");
  if (!glass) return <div className="h-full w-full animate-pulse rounded-3xl bg-surface-2" aria-hidden />;
  const command = {
    object_id: "glass",
    profile_id: glass.profile.id,
    grasp_type: glass.profile.grasp_type,
    grip_percent: 22,
    finger_force: glass.profile.finger_participation,
    finger_spread: glass.profile.finger_spread,
    closure_speed: 0.4,
    palm_height_fraction: glass.profile.palm_height_fraction,
    hold_ms: 1000,
    lift_height: 0.55,
    lift_speed: 1,
    lift_permitted: true,
    object_deformation: 0,
    sensor_intensity: 0.5,
  };
  return (
    <HandScene className="h-full w-full" object={glass} appearance="Glass" motion={motionCtl} command={command} compliance={0} state="HOLDING" cameraPosition={[-2.9, 1.7, -1.9]} />
  );
}

function Step({ verb, title, text, icon, i }: { verb: string; title: string; text: string; icon: ReactNode; i: number }) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ type: "spring", stiffness: 100, damping: 20, delay: i * 0.08 }}
      className="relative border-t border-line-strong pt-5"
    >
      <span className="absolute -top-px left-0 h-px w-12 bg-accent" aria-hidden />
      <div className="flex items-center gap-2 font-mono text-xs tracking-[0.2em] text-accent">
        {icon}
        {verb}
      </div>
      <h3 className="mt-3 font-display text-xl font-semibold tracking-tight">{title}</h3>
      <p className="mt-2 text-[15px] leading-relaxed text-ink-2">{text}</p>
    </motion.li>
  );
}

const STACK = [
  { slug: "react", name: "React" },
  { slug: "typescript", name: "TypeScript" },
  { slug: "vite", name: "Vite" },
  { slug: "tailwindcss", name: "Tailwind CSS" },
  { slug: "threedotjs", name: "Three.js" },
  { slug: "fastapi", name: "FastAPI" },
  { slug: "python", name: "Python" },
  { slug: "scikitlearn", name: "scikit-learn" },
  { slug: "postgresql", name: "PostgreSQL" },
  { slug: "docker", name: "Docker" },
];

export default function Landing() {
  const token = useAuth((s) => s.token);
  const model = useQuery({ queryKey: ["model-status"], queryFn: api.modelStatus, retry: 0 });
  const materials = useQuery({ queryKey: ["materials"], queryFn: api.materials, retry: 0, staleTime: Infinity });
  const labTarget = token ? "/lab" : "/login";

  return (
    <div className="min-h-[100dvh] bg-bg text-ink">
      <header className="sticky top-0 z-20 border-b border-line bg-bg/85 backdrop-blur-md">
        <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5" aria-label="Primary">
          <Logo to="/" />
          <div className="hidden items-center gap-6 text-sm text-ink-2 md:flex">
            <a href="#how" className="hover:text-ink">How it works</a>
            <a href="#grip" className="hover:text-ink">Adaptive grip</a>
            <a href="#hardware" className="hover:text-ink">Hardware path</a>
            <a href="#limits" className="hover:text-ink">Limitations</a>
          </div>
          <div className="flex items-center gap-2">
            {!token && (
              <Link to="/login" className="hidden rounded-lg px-3 py-2 text-sm text-ink-2 hover:text-ink sm:block">
                Sign in
              </Link>
            )}
            <Link to={labTarget} className="hidden h-9 items-center gap-2 whitespace-nowrap rounded-lg bg-accent px-4 text-sm font-semibold sm:inline-flex text-[#04121a] transition-transform hover:brightness-110 active:scale-[0.98]">
              Enter virtual lab
            </Link>
          </div>
        </nav>
      </header>

      <main>
        {/* Hero: text left, the real 3D scene right. Single column below lg. */}
        <section className="relative overflow-hidden bg-lab-grid">
          <div className="mx-auto grid max-w-7xl items-center gap-10 px-5 pb-16 pt-12 lg:min-h-[calc(100dvh-4rem)] lg:grid-cols-[1fr_1.15fr] lg:pt-16">
            <div>
              <h1 className="max-w-[20ch] font-display text-4xl font-semibold leading-[1.05] tracking-tighter md:text-5xl lg:text-[3.4rem]">
                The intelligence layer of a prosthetic hand.
              </h1>
              <p className="mt-5 max-w-[46ch] text-lg leading-relaxed text-ink-2">
                Tactile readings are classified by a trained model, turned into a safe grip, and executed by a 3D prosthetic hand you can watch.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link to={labTarget} className="inline-flex h-12 items-center gap-2 rounded-xl bg-accent px-6 text-sm font-semibold tracking-wide text-[#04121a] transition-transform hover:brightness-110 active:scale-[0.98]">
                  ENTER VIRTUAL LAB <ArrowRight className="h-4 w-4" />
                </Link>
                <a href="#how" className="inline-flex h-12 items-center rounded-xl border border-line-strong px-6 text-sm font-medium text-ink hover:bg-surface-2 active:scale-[0.98]">
                  How it works
                </a>
              </div>
            </div>
            <figure className="relative">
              <div className="aspect-[4/3] w-full overflow-hidden rounded-3xl border border-line-strong bg-[#070c16] shadow-panel">
                <HeroScene />
              </div>
              <figcaption className="mt-3 text-sm text-muted">Looping 3D preview. Inside the lab every grasp is driven by live model output.</figcaption>
            </figure>
          </div>
        </section>

        {/* Problem: stacked header, two-column body */}
        <section className="border-t border-line">
          <div className="mx-auto max-w-7xl px-5 py-20">
            <h2 className="max-w-[22ch] font-display text-3xl font-semibold tracking-tight md:text-4xl">A hand that cannot feel has to guess.</h2>
            <div className="mt-8 grid gap-8 md:grid-cols-2">
              <p className="max-w-[60ch] text-[17px] leading-relaxed text-ink-2">
                Most myoelectric prostheses close with whatever force the user commands. Without touch, a wine glass and a steel bar get the same treatment, so users either
                crush fragile objects or drop heavy ones and must watch every grasp.
              </p>
              <p className="max-w-[60ch] text-[17px] leading-relaxed text-ink-2">
                NeuroGrip explores the missing layer: fingertip sensing, on-board material recognition and a grip policy that knows when it is unsure. It is a software
                prototype that makes each decision visible and testable.
              </p>
            </div>
          </div>
        </section>

        {/* Pipeline: four-step horizontal flow */}
        <section id="how" className="border-t border-line bg-surface/40">
          <div className="mx-auto max-w-7xl px-5 py-20">
            <h2 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">Sense, understand, decide, act.</h2>
            <p className="mt-3 max-w-[60ch] text-ink-2">One canonical pipeline serves simulated, uploaded and live data. The browser renders results; it never re-implements them.</p>
            <ol className="mt-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
              <Step i={0} verb="SENSE" icon={<Fingerprint className="h-4 w-4" />} title="Tactile sensors" text="Pressure, temperature, vibration, conductivity and settling time from eight virtual fingertip and palm sensors." />
              <Step i={1} verb="UNDERSTAND" icon={<BrainCircuit className="h-4 w-4" />} title="Material recognition" text="Validated, log-transformed and scaled, then classified by a random forest that reports a probability for each material." />
              <Step i={2} verb="DECIDE" icon={<Gauge className="h-4 w-4" />} title="Grip engine" text="Base grip plus sensor adjustment, minus fragility protection, with a confidence penalty and object limits." />
              <Step i={3} verb="ACT" icon={<Hand className="h-4 w-4" />} title="Prosthetic response" text="Fingers wrap the object geometry and squeeze to the commanded force, then hold, lift and release." />
            </ol>
          </div>
        </section>

        {/* Adaptive grip: live data visual + text */}
        <section id="grip" className="border-t border-line">
          <div className="mx-auto grid max-w-7xl gap-12 px-5 py-20 lg:grid-cols-[1fr_1.1fr]">
            <div>
              <h2 className="max-w-[18ch] font-display text-3xl font-semibold tracking-tight md:text-4xl">Gentle with glass, firm with steel.</h2>
              <p className="mt-4 max-w-[52ch] text-[17px] leading-relaxed text-ink-2">
                Six materials, six base grips. When the classifier is below 60% confident the prediction becomes Uncertain and the hand falls back to the most fragile plausible
                material, closing slowly.
              </p>
              {model.data?.ready && (
                <dl className="mt-8 grid max-w-md grid-cols-3 gap-6">
                  <div>
                    <dt className="text-xs uppercase tracking-[0.14em] text-muted">Test accuracy</dt>
                    <dd className="mt-1 font-mono text-2xl font-semibold">{pct(model.data.metrics?.accuracy)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-[0.14em] text-muted">Macro F1</dt>
                    <dd className="mt-1 font-mono text-2xl font-semibold">{pct(model.data.metrics?.f1_macro)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs uppercase tracking-[0.14em] text-muted">Samples</dt>
                    <dd className="mt-1 font-mono text-2xl font-semibold">{model.data.dataset?.n_samples}</dd>
                  </div>
                </dl>
              )}
              {model.data?.ready && <p className="mt-3 text-xs text-muted">Live from the running model, evaluated on a held-out split of simulated data.</p>}
            </div>
            <div className="rounded-3xl border border-line bg-surface p-6 shadow-panel">
              <div className="flex items-baseline justify-between">
                <h3 className="font-display text-lg font-semibold">Base grip policy</h3>
                <span className="text-xs text-muted">normalised %, not newtons</span>
              </div>
              <ul className="mt-5 space-y-4">
                {(materials.data?.materials ?? [])
                  .slice()
                  .sort((a, b) => MATERIAL_ORDER.indexOf(a.name) - MATERIAL_ORDER.indexOf(b.name))
                  .map((m) => (
                    <li key={m.name} className="grid grid-cols-[72px_1fr_44px] items-center gap-3 text-sm">
                      <span className="font-medium">{m.name}</span>
                      <span className="relative h-2 rounded-full bg-surface-3">
                        <motion.span
                          className="absolute inset-y-0 left-0 rounded-full"
                          style={{ background: `var(--m-${m.name.toLowerCase()})` }}
                          initial={{ width: 0 }}
                          whileInView={{ width: `${m.base_grip}%` }}
                          viewport={{ once: true }}
                          transition={{ type: "spring", stiffness: 100, damping: 20 }}
                        />
                      </span>
                      <span className="text-right font-mono text-ink-2">{m.base_grip}%</span>
                    </li>
                  ))}
              </ul>
              <p className="mt-5 text-sm text-ink-2">Each bar is the starting point. The engine then adjusts for what the sensors felt and how sure the model is.</p>
            </div>
          </div>
        </section>

        {/* Bento: three capabilities with different visual treatments */}
        <section className="border-t border-line bg-surface/40">
          <div className="mx-auto max-w-7xl px-5 py-20">
            <h2 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">Three ways to feed the hand.</h2>
            <div className="mt-10 grid gap-4 md:grid-cols-3 md:grid-rows-2">
              <div className="rounded-3xl border border-accent/30 bg-accent-soft p-7 md:col-span-2 md:row-span-2">
                <Radio className="h-6 w-6 text-accent" />
                <h3 className="mt-4 font-display text-2xl font-semibold">Simulated and live sensors</h3>
                <p className="mt-3 max-w-[48ch] text-ink-2">
                  A physics-inspired simulator derives each reading from stiffness, density, thermal effusivity and conductivity. A live channel over WebSocket accepts the same
                  readings from a device, with REST polling as a fallback.
                </p>
                <p className="mt-6 font-mono text-sm text-accent">SimulatedSensorProvider, LiveSensorProvider</p>
              </div>
              <div className="rounded-3xl border border-line bg-surface p-6">
                <Database className="h-5 w-5 text-accent" />
                <h3 className="mt-3 font-display text-lg font-semibold">Your own CSV or JSON</h3>
                <p className="mt-2 text-sm text-ink-2">Columns are detected by alias, mapped and validated. Simulate one exact row, play a dataset back, or batch-evaluate it.</p>
              </div>
              <div className="rounded-3xl border border-line bg-[repeating-linear-gradient(135deg,transparent_0_10px,var(--bg-grid)_10px_11px)] p-6">
                <ShieldAlert className="h-5 w-5 text-warn" />
                <h3 className="mt-3 font-display text-lg font-semibold">Safety you can audit</h3>
                <p className="mt-2 text-sm text-ink-2">Every grip shows its arithmetic, warnings and the model version, and is stored with its exact input.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Hardware path: two rows comparing now vs next */}
        <section id="hardware" className="border-t border-line">
          <div className="mx-auto max-w-7xl px-5 py-20">
            <h2 className="font-display text-3xl font-semibold tracking-tight md:text-4xl">Built to swap in real hardware.</h2>
            <p className="mt-3 max-w-[60ch] text-ink-2">Only the sensor provider changes. The model, grip engine and safety logic stay exactly as they are.</p>
            <div className="mt-10 space-y-6">
              {[
                { label: "Today", steps: ["Simulated sensor", "Sensor provider", "ML model", "Grip engine", "Virtual hand"], tone: "border-line-strong" },
                { label: "Next", steps: ["Real tactile sensor", "ESP32 / Arduino", "Sensor provider", "ML model", "Grip engine", "Motor controller", "Physical hand"], tone: "border-accent/40" },
              ].map((row) => (
                <div key={row.label} className="grid gap-3 md:grid-cols-[96px_1fr] md:items-center">
                  <span className="font-mono text-sm uppercase tracking-[0.18em] text-muted">{row.label}</span>
                  <ol className="flex flex-wrap items-center gap-2">
                    {row.steps.map((s, i) => (
                      <li key={s} className="flex items-center gap-2">
                        <span className={`rounded-lg border ${row.tone} bg-surface px-3 py-2 text-sm`}>{s}</span>
                        {i < row.steps.length - 1 && <ArrowRight className="h-4 w-4 text-muted" aria-hidden />}
                      </li>
                    ))}
                  </ol>
                </div>
              ))}
            </div>
            <p className="mt-8 flex items-start gap-2 break-words text-sm text-ink-2 [&_code]:break-all">
              <Cpu className="h-4 w-4 text-accent" /> Devices post readings to <code className="font-mono">/api/sensors/data</code> or stream them over <code className="font-mono">/ws/sensors</code>.
            </p>
          </div>
        </section>

        {/* Limitations: plain divided list */}
        <section id="limits" className="border-t border-line bg-surface/40">
          <div className="mx-auto grid max-w-7xl gap-10 px-5 py-20 lg:grid-cols-[0.8fr_1.2fr]">
            <h2 className="max-w-[16ch] font-display text-3xl font-semibold tracking-tight md:text-4xl">What this prototype is not.</h2>
            <ul className="divide-y divide-line text-[16px] text-ink-2">
              <li className="py-4">Sensor values are simulated unless a real device is connected and clearly labelled as such.</li>
              <li className="py-4">Grip percentages are normalised simulation values, not forces measured in newtons.</li>
              <li className="py-4">The classifier is trained on simulated data; real sensors would need calibration and retraining.</li>
              <li className="py-4">Driving real motors would require hardware safety validation and fail-safe control.</li>
              <li className="py-4">It is not a medical device. Clinical use would need extensive validation and regulatory approval.</li>
            </ul>
          </div>
        </section>

        {/* Stack: logo wall */}
        <section className="border-t border-line">
          <div className="mx-auto max-w-7xl px-5 py-14">
            <h2 className="text-center font-display text-lg font-semibold text-ink-2">Built with</h2>
            <ul className="mt-6 grid grid-cols-3 place-items-center gap-6 sm:grid-cols-5 lg:grid-cols-10">
              {STACK.map((s) => (
                <li key={s.slug}>
                  <img
                    src={`https://cdn.simpleicons.org/${s.slug}/7d8aa0`}
                    alt={s.name}
                    title={s.name}
                    width={28}
                    height={28}
                    loading="lazy"
                    className="h-7 w-7 opacity-80"
                    onError={(e) => {
                      // Offline deployments: fall back to the plain name.
                      const span = document.createElement("span");
                      span.textContent = s.name;
                      span.className = "text-sm text-muted";
                      e.currentTarget.replaceWith(span);
                    }}
                  />
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="border-t border-line bg-lab-grid">
          <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-5 py-16 md:flex-row md:items-center">
            <h2 className="max-w-[22ch] font-display text-3xl font-semibold tracking-tight">Watch the pipeline make a decision.</h2>
            <Link to={labTarget} className="inline-flex h-12 items-center gap-2 rounded-xl bg-accent px-6 text-sm font-semibold tracking-wide text-[#04121a] hover:brightness-110 active:scale-[0.98]">
              ENTER VIRTUAL LAB <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-7xl flex-col justify-between gap-2 px-5 py-6 text-sm text-muted sm:flex-row">
          <span>NeuroGrip. An academic research prototype.</span>
          <span>Not for clinical use.</span>
        </div>
      </footer>
    </div>
  );
}
