import { RoundedBox } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";
import type { VirtualObject } from "@/api/types";
import { objectMaterial, type Appearance } from "./materials";

/** Geometry comes from the backend object catalogue; appearance from the material. */
export function SceneObject({ object, appearance }: { object: VirtualObject; appearance: Appearance }) {
  const mat = objectMaterial(appearance);
  const d = object.dimensions;

  const bottleGeom = useMemo(() => {
    if (object.shape !== "bottle") return null;
    const r = d.radius;
    const n = d.neck_radius;
    const sh = d.shoulder;
    const h = d.height;
    const pts = [
      [0, 0],
      [r * 0.92, 0],
      [r, 0.06],
      [r, sh],
      [r * 0.82, sh + 0.12],
      [n * 1.15, sh + 0.24],
      [n, sh + 0.3],
      [n, h - 0.08],
      [n * 1.12, h - 0.06],
      [n * 1.12, h],
      [0, h],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    return new THREE.LatheGeometry(pts, 48);
  }, [object.shape, d.radius, d.neck_radius, d.shoulder, d.height]);

  const glassGeom = useMemo(() => {
    if (object.shape !== "cylinder") return null;
    const r = d.radius;
    const h = d.height;
    const wall = 0.025;
    const pts = [
      [0, 0],
      [r * 0.9, 0],
      [r, h],
      [r - wall, h],
      [r * 0.9 - wall, 0.06],
      [0, 0.06],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    return new THREE.LatheGeometry(pts, 56);
  }, [object.shape, d.radius, d.height]);

  switch (object.shape) {
    case "cylinder":
      return <mesh geometry={glassGeom!} material={mat} castShadow receiveShadow />;
    case "bottle":
      return (
        <group>
          <mesh geometry={bottleGeom!} material={mat} castShadow />
          <mesh position={[0, d.height - 0.03, 0]} castShadow>
            <cylinderGeometry args={[d.neck_radius * 1.18, d.neck_radius * 1.18, 0.09, 32]} />
            <meshStandardMaterial color="#1e293b" roughness={0.5} />
          </mesh>
          <mesh position={[0, d.shoulder * 0.55, 0]}>
            <cylinderGeometry args={[d.radius + 0.004, d.radius + 0.004, 0.32, 48, 1, true]} />
            <meshStandardMaterial color="#e2e8f0" roughness={0.6} side={THREE.DoubleSide} />
          </mesh>
        </group>
      );
    case "box":
      return (
        <RoundedBox args={[d.size, d.size, d.size]} radius={0.04} smoothness={4} position={[0, d.size / 2, 0]} material={mat} castShadow receiveShadow />
      );
    case "sphere":
      return (
        <mesh position={[0, d.radius, 0]} material={mat} castShadow>
          <sphereGeometry args={[d.radius, 48, 32]} />
        </mesh>
      );
    case "container":
      return (
        <group>
          <mesh position={[0, (d.height - d.lid_height) / 2, 0]} material={mat} castShadow>
            <cylinderGeometry args={[d.radius, d.radius * 0.94, d.height - d.lid_height, 48]} />
          </mesh>
          <mesh position={[0, d.height - d.lid_height / 2, 0]} castShadow>
            <cylinderGeometry args={[d.radius + 0.025, d.radius + 0.025, d.lid_height, 48]} />
            <meshStandardMaterial color="#0f766e" roughness={0.4} />
          </mesh>
        </group>
      );
    case "rod":
    default:
      return (
        <group>
          <mesh position={[0, d.height / 2, 0]} material={mat} castShadow>
            <cylinderGeometry args={[d.radius, d.radius, d.height, 48]} />
          </mesh>
          {[0.08, d.height - 0.08].map((y) => (
            <mesh key={y} position={[0, y, 0]} rotation={[Math.PI / 2, 0, 0]} material={mat}>
              <torusGeometry args={[d.radius, 0.012, 8, 48]} />
            </mesh>
          ))}
        </group>
      );
  }
}
