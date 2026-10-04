import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "@/api/client";
import { HandScene } from "@/components/hand/HandScene";
import type { Appearance } from "@/components/hand/materials";
import { MotionController } from "@/sim/motion";
import type { HandState } from "@/sim/stateMachine";

/** Dev-only harness: renders a fixed pose from URL params for visual verification. */
export default function SceneTest() {
  const params = new URLSearchParams(window.location.search);
  const objects = useQuery({ queryKey: ["objects"], queryFn: api.objects });
  const motion = useMemo(() => {
    const m = new MotionController();
    for (const ch of ["approach", "closure", "squeeze", "lift", "sensors"] as const) m.set(ch, Number(params.get(ch) ?? (ch === "lift" ? 0 : 1)));
    return m;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const obj = objects.data?.objects.find((o) => o.id === (params.get("object") ?? "glass"));
  if (!obj) return <div>loading</div>;
  const grip = Number(params.get("grip") ?? 40) / 100;
  const command = {
    object_id: obj.id, profile_id: obj.profile.id, grasp_type: obj.profile.grasp_type, grip_percent: grip * 100,
    finger_force: Object.fromEntries(Object.entries(obj.profile.finger_participation).map(([k, v]) => [k, v * grip])) as never,
    finger_spread: obj.profile.finger_spread, closure_speed: 0.5, palm_height_fraction: obj.profile.palm_height_fraction,
    hold_ms: 1000, lift_height: obj.profile.lift_height, lift_speed: 1, lift_permitted: true, object_deformation: Number(params.get("deform") ?? 0), sensor_intensity: 0.6,
  };
  return (
    <div style={{ width: "100vw", height: "100vh" }}>
      <HandScene className="h-full w-full" object={obj} appearance={(params.get("appearance") ?? obj.default_material) as Appearance} motion={motion}
        command={command} compliance={0.1} cameraPosition={params.get("cam") ? (params.get("cam")!.split(",").map(Number) as [number, number, number]) : undefined} state={(params.get("state") ?? "HOLDING") as HandState} showLabels />
    </div>
  );
}
