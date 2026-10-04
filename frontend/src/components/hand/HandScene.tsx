import { ContactShadows, Environment, Grid, Html, Lightformer, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree, type RootState } from "@react-three/fiber";
import { Component, memo, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import * as THREE from "three";
import type { SimulationCommand, VirtualObject } from "@/api/types";
import { blendPose, contactPose, DIGITS, HAND, placement, thumbAbduction } from "@/sim/kinematics";
import type { MotionController } from "@/sim/motion";
import type { HandState } from "@/sim/stateMachine";
import type { Appearance } from "./materials";
import { createRig, ProstheticHand, SPREAD_SIGN, type HandRig } from "./ProstheticHand";
import { SceneObject } from "./SceneObject";

export interface HandSceneProps {
  object: VirtualObject;
  appearance: Appearance;
  motion: MotionController;
  command: SimulationCommand | null;
  compliance: number;
  state: HandState;
  showLabels?: boolean;
  className?: string;
  interactive?: boolean;
  cameraPosition?: [number, number, number];
}

// Hand-local -> world: X_l -> +Y (fingers stack vertically), Y_l -> -Z, Z_l -> -X
// (the palm faces the object, which stands at the world origin).
const HAND_QUAT = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0)),
);

const RETRACT_X = 1.8;

// Reused every frame (no per-frame allocations in the render loop).
const SENSOR_IDLE = new THREE.Color("#22d3ee");
const SENSOR_FORCE = new THREE.Color("#fbbf24");
const sensorColor = new THREE.Color();

function Rig({ object, appearance, motion, command, compliance, state, showLabels }: HandSceneProps) {
  const rig = useRef<HandRig>(createRig());
  const handGroup = useRef<THREE.Group>(null);
  const objectGroup = useRef<THREE.Group>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const commandRef = useRef(command);
  commandRef.current = command;

  const palmFraction = command?.object_id === object.id ? command.palm_height_fraction : object.profile.palm_height_fraction;
  const place = useMemo(() => placement(object, palmFraction), [object, palmFraction]);
  const contact = useMemo(() => contactPose(object, palmFraction), [object, palmFraction]);

  useFrame(({ clock }) => {
    const now = performance.now();
    const a = motion.value("approach", now);
    const closure = motion.value("closure", now);
    const squeeze = motion.value("squeeze", now);
    const lift = motion.value("lift", now);
    const sensors = motion.value("sensors", now);
    const cmd = commandRef.current;
    const liftY = lift * (cmd?.lift_height ?? 0.5);

    const hand = handGroup.current;
    if (hand) {
      hand.position.set(place.originX + (1 - a) * RETRACT_X, place.handY + liftY, HAND.palmLength / 2);
    }
    const obj = objectGroup.current;
    if (obj) {
      obj.position.y = liftY;
      const def = (cmd?.object_deformation ?? 0) * squeeze;
      obj.scale.set(1 - def * 0.45, 1, 1 + def * 0.18);
    }

    const pose = blendPose(contact, closure, squeeze, cmd?.finger_force ?? {}, compliance);
    const spread = (cmd?.finger_spread ?? object.profile.finger_spread) * Math.min(1, closure + 0.3);
    for (const f of DIGITS) {
      const joints = rig.current.joints[f];
      if (!joints) continue;
      for (let j = 0; j < 3; j++) if (joints[j]) joints[j]!.rotation.x = pose[f][j];
      const sg = rig.current.spread[f];
      if (sg) sg.rotation.z = f === "thumb" ? thumbAbduction(closure) : SPREAD_SIGN[f] * spread;
    }

    // Tactile sensors: arm during SENSING, glow with contact force, ripple on contact.
    const t = clock.getElapsedTime();
    const st = stateRef.current;
    const force = squeeze * (cmd?.sensor_intensity ?? 0.5);
    const armed = st === "SENSING" ? 0.5 + 0.5 * Math.sin(t * 9) : 0;
    const intensity = 0.15 + sensors * (0.9 + 2.6 * force) + armed * 1.2;
    const color = sensorColor.copy(SENSOR_IDLE).lerp(SENSOR_FORCE, Math.min(1, force * 1.1));
    rig.current.sensors.forEach((m) => {
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = intensity;
      mat.emissive.copy(color);
    });
    const contactActive = ["CONTACT", "ANALYZING", "PREDICTED", "GRIP_DECISION", "GRIPPING", "HOLDING", "LIFTING"].includes(st);
    rig.current.ripples.forEach((m, i) => {
      const mat = m.material as THREE.MeshBasicMaterial;
      if (!contactActive || sensors < 0.5) {
        mat.opacity = 0;
        return;
      }
      const phase = (t * 0.9 + i * 0.13) % 1;
      m.scale.setScalar(1 + phase * 2.4);
      mat.opacity = (1 - phase) * 0.75 * sensors;
      mat.color.copy(color);
    });
  });

  return (
    <>
      <group ref={objectGroup}>
        <SceneObject object={object} appearance={appearance} />
      </group>
      <group ref={handGroup} quaternion={HAND_QUAT}>
        <ProstheticHand rig={rig} />
        {showLabels && (
          <Html position={[0.55, 0.62, 0.32]} center distanceFactor={6} zIndexRange={[10, 0]} style={{ pointerEvents: "none" }}>
            <div className="whitespace-nowrap rounded-md border border-cyan-400/40 bg-slate-950/80 px-2 py-1 font-mono text-[10px] font-semibold tracking-[0.16em] text-cyan-300 shadow-lg">
              ◉ VIRTUAL TACTILE SENSORS
            </div>
          </Html>
        )}
      </group>
    </>
  );
}

/** Static lab set. Memoised: re-rendering it would make <Environment> re-bake its cube map on the GPU. */
const Lab = memo(function Lab() {
  return (
    <>
      <color attach="background" args={["#070c16"]} />
      <fog attach="fog" args={["#070c16", 7, 16]} />
      <ambientLight intensity={0.45} />
      <directionalLight position={[-3, 5, -2]} intensity={1.6} castShadow shadow-mapSize={[1024, 1024]} />
      <directionalLight position={[4, 2.5, 3]} intensity={0.6} color="#a5f3fc" />
      <pointLight position={[0, 2.5, -2]} intensity={6} distance={6} color="#a78bfa" />
      <Environment resolution={128}>
        <Lightformer intensity={2} position={[0, 4, -3]} scale={[8, 2, 1]} color="#dbeafe" />
        <Lightformer intensity={1.2} position={[-4, 2, 2]} scale={[3, 3, 1]} color="#67e8f9" />
        <Lightformer intensity={0.8} position={[4, 1, 0]} scale={[3, 3, 1]} color="#c4b5fd" />
      </Environment>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.002, 0]} receiveShadow>
        <circleGeometry args={[2.4, 64]} />
        <meshStandardMaterial color="#101a2b" roughness={0.85} metalness={0.2} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.0, 0]}>
        <ringGeometry args={[2.36, 2.4, 96]} />
        <meshBasicMaterial color="#22d3ee" transparent opacity={0.5} toneMapped={false} />
      </mesh>
      <Grid
        position={[0, -0.01, 0]}
        args={[20, 20]}
        cellSize={0.25}
        cellThickness={0.5}
        cellColor="#1e3a5f"
        sectionSize={1}
        sectionThickness={1}
        sectionColor="#155e75"
        fadeDistance={14}
        fadeStrength={1.5}
        infiniteGrid
      />
      <ContactShadows position={[0, 0.001, 0]} opacity={0.55} scale={6} blur={2.4} far={2.2} resolution={512} />
    </>
  );
});

/** Pull the camera back on narrow (portrait) viewports so the whole grasp stays in frame. */
function AdaptiveCamera({ base }: { base: [number, number, number] }) {
  const camera = useThree((s) => s.camera);
  const aspect = useThree((s) => s.size.width / Math.max(1, s.size.height));
  useEffect(() => {
    const k = Math.min(1.9, Math.max(1, 1.35 / aspect));
    camera.position.set(base[0] * k, base[1] * (0.75 + 0.25 * k), base[2] * k);
    camera.updateProjectionMatrix();
  }, [aspect, camera, base]);
  return null;
}

const DEFAULT_CAMERA: [number, number, number] = [-2.6, 1.65, -1.25];

/** Keeps a WebGL failure inside the scene panel instead of taking down the whole page. */
class SceneBoundary extends Component<{ children: ReactNode; onRetry: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="flex h-full w-full flex-col items-center justify-center gap-3 bg-[#070c16] p-6 text-center text-sm text-slate-300">
        The 3D view could not start on this device (WebGL unavailable or the GPU reset).
        <button type="button" onClick={this.props.onRetry} className="rounded-lg border border-cyan-400/40 px-3 py-1.5 text-cyan-300 hover:bg-cyan-400/10">
          Retry 3D view
        </button>
      </div>
    );
  }
}

export function HandScene(props: HandSceneProps) {
  const cam = props.cameraPosition ?? DEFAULT_CAMERA;
  const wrapper = useRef<HTMLDivElement>(null);
  const [generation, setGeneration] = useState(0);
  const [contextLost, setContextLost] = useState(false);
  const [visible, setVisible] = useState(true);

  // Stop rendering while the scene is scrolled out of view (saves GPU for the rest of the page).
  useEffect(() => {
    const el = wrapper.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const onCreated = useCallback(({ gl }: RootState) => {
    gl.domElement.addEventListener(
      "webglcontextlost",
      (e) => {
        e.preventDefault();
        setContextLost(true);
      },
      { once: true },
    );
  }, []);

  // The browser dropped the GPU context (driver reset, memory pressure): rebuild the scene on a fresh one.
  useEffect(() => {
    if (!contextLost) return;
    const t = setTimeout(() => {
      setContextLost(false);
      setGeneration((g) => g + 1);
    }, 800);
    return () => clearTimeout(t);
  }, [contextLost]);

  return (
    <div ref={wrapper} className={`relative ${props.className ?? "h-[460px] w-full"}`}>
      <SceneBoundary key={generation} onRetry={() => setGeneration((g) => g + 1)}>
        <Canvas
          shadows="percentage"
          dpr={[1, 1.5]}
          frameloop={visible ? "always" : "never"}
          camera={{ position: cam, fov: 38, near: 0.1, far: 60 }}
          gl={{ antialias: true, powerPreference: "default" }}
          onCreated={onCreated}
          aria-label={`3D simulation: prosthetic hand and ${props.object.name}, state ${props.state}`}
          role="img"
        >
          <AdaptiveCamera base={cam} />
          <Suspense fallback={null}>
            <Lab />
            <Rig {...props} />
          </Suspense>
          <OrbitControls
            target={[0.4, 0.5, 0.05]}
            enablePan={false}
            minDistance={2.2}
            maxDistance={8}
            maxPolarAngle={Math.PI / 2.05}
            enabled={props.interactive !== false}
          />
        </Canvas>
      </SceneBoundary>
      {contextLost && (
        <div role="status" className="absolute inset-0 flex items-center justify-center bg-[#070c16] text-sm text-slate-300">
          Restarting 3D view…
        </div>
      )}
    </div>
  );
}
