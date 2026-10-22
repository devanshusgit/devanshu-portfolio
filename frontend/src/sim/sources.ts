import { api, type SimulateParams } from "@/api/client";
import type { Features, LiveSample, Material, RowView } from "@/api/types";
import { latestClassified, useLive } from "@/lib/live";
import type { AcquiredSample, GraspSource } from "./useGraspRun";

/** SIMULATED: SimulatedSensorProvider (backend) -> /api/predict. */
export function simulatedSource(p: SimulateParams & { material: Material; sourceDetail?: string }): GraspSource {
  return {
    kind: "SIMULATED",
    acquire: async () => {
      const { reading } = await api.simulatedSample({ ...p, persist: false });
      return {
        features: reading.features,
        sourceLabel: "SIMULATED SENSOR DATA",
        groundTruth: reading.ground_truth,
        simulated: true,
        meta: reading.provenance,
      };
    },
    analyze: (s: AcquiredSample) =>
      api.predict({
        features: s.features,
        data_source: "SIMULATED",
        source_detail: p.sourceDetail ?? "virtual_lab",
        object_id: p.object_id,
        ground_truth: s.groundTruth,
        persist: p.persist ?? true,
      }),
  };
}

/**
 * UPLOADED: the exact stored dataset row. The backend resolves the row server-side
 * (dataset id + row index) so the values cannot be substituted on the way.
 */
export function uploadedRowSource(p: {
  datasetId: number;
  datasetName: string;
  row: RowView;
  objectId: string;
  persist: boolean;
  sourceDetail?: string;
}): GraspSource {
  return {
    kind: "UPLOADED",
    acquire: async () => {
      if (p.row.status === "invalid") {
        throw new Error(`Row ${p.row.row_id} cannot be simulated: ${p.row.issues.map((i) => i.message).join("; ")}`);
      }
      return {
        features: p.row.features as Features,
        sourceLabel: `UPLOADED ROW ${p.row.row_id} · ${p.datasetName}`,
        groundTruth: p.row.label,
        simulated: false,
        meta: { row_index: p.row.row_index },
      };
    },
    analyze: () => api.simulateRow(p.datasetId, p.row.row_index, { object_id: p.objectId, persist: p.persist, source_detail: p.sourceDetail ?? "data_studio" }),
  };
}

function waitForLiveSample(afterSeq: number, timeoutMs: number): Promise<LiveSample> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const latest = latestClassified(useLive.getState().samples);
      if (latest && latest.seq > afterSeq) return resolve(latest);
      if (Date.now() - started > timeoutMs)
        return reject(new Error("No live sensor reading received. Connect to the live channel and start the simulated stream or a device."));
      setTimeout(check, 100);
    };
    check();
  });
}

/** LIVE: newest classified sample from the live buffer -> /api/sensors/live/{seq}/predict. */
export function liveSource(p: { objectId: string; persist: boolean }): GraspSource {
  let seq = 0;
  return {
    kind: "LIVE",
    acquire: async () => {
      const prev = latestClassified(useLive.getState().samples)?.seq ?? 0;
      // Take the next reading that arrives (fresh contact), or the latest if the stream is quiet.
      const sample = await waitForLiveSample(prev, 2500).catch(() => waitForLiveSample(0, 500));
      seq = sample.seq;
      return {
        features: sample.features as Features,
        sourceLabel: `LIVE #${sample.seq} · ${sample.source}`,
        groundTruth: sample.ground_truth,
        simulated: sample.source.includes("SIMULATED"),
        meta: { seq: sample.seq, device_id: sample.device_id },
      };
    },
    analyze: () => api.predictLive(seq, { object_id: p.objectId, persist: p.persist }),
  };
}
