import { RoundedBox } from "@react-three/drei";
import { useMemo } from "react";
import type { MutableRefObject } from "react";
import * as THREE from "three";
import type { Finger } from "@/api/types";
import { DIGITS, HAND, type DigitSpec } from "@/sim/kinematics";
import { HAND_MATERIALS } from "./materials";

/** Mutable handles the animation loop writes to (no React re-render per frame). */
export interface HandRig {
  joints: Partial<Record<Finger, (THREE.Group | null)[]>>;
  spread: Partial<Record<Finger, THREE.Group | null>>;
  sensors: THREE.Mesh[];
  ripples: THREE.Mesh[];
}

export function createRig(): HandRig {
  return { joints: {}, spread: {}, sensors: [], ripples: [] };
}

const SPREAD_SIGN: Record<Finger, number> = { thumb: 0, index: -1, middle: -0.35, ring: 0.35, little: 1 };

const sensorMaterial = () =>
  new THREE.MeshStandardMaterial({ color: "#0e7490", emissive: "#22d3ee", emissiveIntensity: 0.2, roughness: 0.25, toneMapped: false });
const rippleMaterial = () =>
  new THREE.MeshBasicMaterial({ color: "#67e8f9", transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });

function Segment({ length, radius }: { length: number; radius: number }) {
  return (
    <>
      <mesh material={HAND_MATERIALS.joint} castShadow>
        <sphereGeometry args={[radius * 1.06, 20, 14]} />
      </mesh>
      <mesh position={[0, length / 2, 0]} material={HAND_MATERIALS.shell} castShadow>
        <capsuleGeometry args={[radius, Math.max(0.01, length - radius * 1.2), 6, 16]} />
      </mesh>
      {/* actuator tendon accent on the dorsal side */}
      <mesh position={[0, length / 2, -radius * 0.92]} material={HAND_MATERIALS.accent}>
        <boxGeometry args={[radius * 0.35, length * 0.5, 0.008]} />
      </mesh>
    </>
  );
}

function TactileNode({ rig, position, rotation }: { rig: MutableRefObject<HandRig>; position: [number, number, number]; rotation?: [number, number, number] }) {
  const mat = useMemo(sensorMaterial, []);
  const rmat = useMemo(rippleMaterial, []);
  return (
    <group position={position} rotation={rotation}>
      <mesh
        material={mat}
        scale={[1, 1, 0.45]}
        ref={(m) => {
          if (m && !rig.current.sensors.includes(m)) rig.current.sensors.push(m);
        }}
      >
        <sphereGeometry args={[0.042, 16, 12]} />
      </mesh>
      <mesh
        material={rmat}
        position={[0, 0, 0.012]}
        ref={(m) => {
          if (m && !rig.current.ripples.includes(m)) rig.current.ripples.push(m);
        }}
      >
        <ringGeometry args={[0.05, 0.062, 32]} />
      </mesh>
    </group>
  );
}

function Digit({ finger, rig }: { finger: Finger; rig: MutableRefObject<HandRig> }) {
  const spec = HAND.digits[finger] as DigitSpec;
  const r = finger === "thumb" ? HAND.fingerRadius * 1.12 : finger === "little" ? HAND.fingerRadius * 0.9 : HAND.fingerRadius;
  const [l0, l1, l2] = spec.lengths;
  const setJoint = (i: number) => (g: THREE.Group | null) => {
    const arr = (rig.current.joints[finger] ??= [null, null, null]);
    arr[i] = g;
  };
  return (
    <group position={[spec.x, spec.base[0], spec.base[1]]} rotation={[0, 0, spec.heading === Math.PI ? Math.PI : 0]}>
      <group ref={(g) => void (rig.current.spread[finger] = g)}>
        <group ref={setJoint(0)}>
          <Segment length={l0} radius={r} />
          <group position={[0, l0, 0]} ref={setJoint(1)}>
            <Segment length={l1} radius={r * 0.95} />
            <group position={[0, l1, 0]} ref={setJoint(2)}>
              <Segment length={l2} radius={r * 0.9} />
              {/* fingertip tactile sensor on the palmar pad */}
              <TactileNode rig={rig} position={[0, l2 * 0.62, r * 0.82]} />
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}

/** Procedural prosthetic hand (hand-local frame: fingers +Y, palm face +Z). */
export function ProstheticHand({ rig }: { rig: MutableRefObject<HandRig> }) {
  const { palmLength: L, palmWidth: W, palmThickness: T } = HAND;
  const forearm = useMemo(() => {
    const pts = [
      [0.0, 0],
      [0.3, 0],
      [0.31, -0.05],
      [0.36, -0.5],
      [0.4, -1.15],
      [0.37, -1.25],
      [0.0, -1.25],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    return new THREE.LatheGeometry(pts, 40);
  }, []);
  return (
    <group>
      {/* palm shell */}
      <RoundedBox args={[W, L, T]} radius={0.09} smoothness={4} position={[0, L / 2, 0]} material={HAND_MATERIALS.shell} castShadow />
      {/* dorsal control module */}
      <RoundedBox args={[W * 0.68, L * 0.58, 0.05]} radius={0.02} position={[0, L * 0.5, -T / 2 - 0.012]} material={HAND_MATERIALS.carbon} />
      <mesh position={[0, L * 0.5, -T / 2 - 0.04]} material={HAND_MATERIALS.accent}>
        <boxGeometry args={[W * 0.5, 0.018, 0.01]} />
      </mesh>
      {/* knuckle actuator housings */}
      <mesh position={[0, L - 0.02, 0]} rotation={[0, 0, Math.PI / 2]} material={HAND_MATERIALS.joint}>
        <cylinderGeometry args={[0.085, 0.085, W * 0.92, 24]} />
      </mesh>
      {/* thenar housing that carries the thumb */}
      <mesh position={[0.3, 0.26, 0.04]} rotation={[0.2, 0, -0.35]} material={HAND_MATERIALS.shell} castShadow>
        <capsuleGeometry args={[0.11, 0.18, 6, 16]} />
      </mesh>
      {/* palm tactile sensors */}
      {(
        [
          [-0.2, 0.62],
          [0.08, 0.5],
          [-0.12, 0.3],
        ] as [number, number][]
      ).map(([x, y]) => (
        <TactileNode key={`${x}${y}`} rig={rig} position={[x, y, T / 2 + 0.004]} />
      ))}
      {/* wrist rotator + socket */}
      <mesh position={[0, -0.04, 0]} material={HAND_MATERIALS.joint}>
        <cylinderGeometry args={[0.31, 0.31, 0.1, 40]} />
      </mesh>
      <mesh position={[0, -0.095, 0]} material={HAND_MATERIALS.accent}>
        <cylinderGeometry args={[0.318, 0.318, 0.018, 40]} />
      </mesh>
      <mesh geometry={forearm} position={[0, -0.1, 0]} material={HAND_MATERIALS.carbon} castShadow />
      {DIGITS.map((f) => (
        <Digit key={f} finger={f} rig={rig} />
      ))}
    </group>
  );
}

export { SPREAD_SIGN };
