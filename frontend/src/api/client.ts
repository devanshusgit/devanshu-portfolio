import type {
  AdminStats,
  BatchResponse,
  Dataset,
  DatasetInfo,
  DatasetMapping,
  FeatureInfo,
  Features,
  Health,
  HistoryItem,
  HistoryPage,
  LiveSample,
  LiveStatus,
  MaterialInfo,
  Metrics,
  ModelStatus,
  PredictionResult,
  RowsPage,
  SensorReading,
  SweepPoint,
  SystemSettings,
  TokenResponse,
  TrainingRun,
  User,
  UserSettings,
  VirtualObject,
} from "./types";
import { useAuth } from "@/lib/auth";

export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? "";

export class ApiError extends Error {
  status: number;
  code?: string;
  errors?: { feature?: string | null; code?: string; message: string }[];
  constructor(status: number, message: string, code?: string, errors?: ApiError["errors"]) {
    super(message);
    this.status = status;
    this.code = code;
    this.errors = errors;
  }
}

type Query = Record<string, string | number | boolean | null | undefined>;

function qs(query?: Query): string {
  if (!query) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

async function parseError(res: Response): Promise<ApiError> {
  let message = `${res.status} ${res.statusText}`;
  let code: string | undefined;
  let errors: ApiError["errors"];
  try {
    const body = await res.json();
    if (typeof body.detail === "string") message = body.detail;
    code = body.code;
    if (Array.isArray(body.errors)) {
      errors = body.errors.map((e: { feature?: string; message?: string; code?: string; loc?: string[] }) => ({
        feature: e.feature ?? e.loc?.slice(1).join(".") ?? null,
        code: e.code,
        message: e.message ?? String(e),
      }));
      if (code === "invalid_sample" && errors?.length) message = errors.map((e) => e.message).join("; ");
    }
  } catch {
    /* non-JSON error body */
  }
  if (res.status === 0 || res.status >= 502) message = message || "Backend unavailable";
  return new ApiError(res.status, message, code, errors);
}

async function request<T>(method: string, path: string, opts: { body?: unknown; query?: Query; form?: FormData; raw?: boolean; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = useAuth.getState().token;
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}${qs(opts.query)}`, { method, headers, body, signal: opts.signal });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new ApiError(0, "Cannot reach the NeuroGrip backend. Is the API server running?", "network");
  }
  if (res.status === 401 && token) useAuth.getState().logout("Your session expired. Please sign in again.");
  if (!res.ok) throw await parseError(res);
  if (opts.raw) return (await res.text()) as T;
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const get = <T>(path: string, query?: Query) => request<T>("GET", path, { query });
const post = <T>(path: string, body?: unknown) => request<T>("POST", path, { body: body ?? {} });
const put = <T>(path: string, body?: unknown) => request<T>("PUT", path, { body });

export interface SimulateParams {
  object_id: string;
  material?: string | null;
  seed?: number | null;
  ambient_temperature?: number | null;
  humidity?: number | null;
  contact_quality?: number | null;
  noise_level?: number;
  persist?: boolean;
  source_detail?: string;
}

export interface HistoryFilters {
  source?: string;
  material?: string;
  confidence_level?: string;
  safety?: string;
  q?: string;
  all_users?: boolean;
  offset?: number;
  limit?: number;
}

export const api = {
  health: () => get<Health>("/api/health"),
  objects: () => get<{ objects: VirtualObject[]; default_object_for_material: Record<string, string> }>("/api/objects"),
  materials: () => get<{ materials: MaterialInfo[]; confidence_thresholds: { high: number; moderate: number }; grip_note: string }>("/api/materials"),
  features: () => get<{ features: FeatureInfo[] }>("/api/features"),

  login: (email: string, password: string) => post<TokenResponse>("/api/auth/login", { email, password }),
  register: (email: string, password: string, full_name: string) => post<TokenResponse>("/api/auth/register", { email, password, full_name }),
  me: () => get<User>("/api/auth/me"),
  updateProfile: (full_name: string) => request<User>("PATCH", "/api/auth/me", { body: { full_name } }),
  changePassword: (current_password: string, new_password: string) => post<{ ok: boolean }>("/api/auth/change-password", { current_password, new_password }),

  predict: (body: { features: Features; data_source: string; source_detail?: string; object_id?: string | null; ground_truth?: string | null; persist?: boolean }) =>
    post<PredictionResult>("/api/predict", body),
  simulate: (p: SimulateParams) => post<PredictionResult>("/api/simulate", p),
  simulatedSample: (p: SimulateParams) => post<{ reading: SensorReading; label: string }>("/api/sensors/simulated/sample", p),
  sweep: (body: { features: Features; feature: string; start: number; stop: number; steps: number; object_id?: string | null }) =>
    post<{ feature: string; unit: string; log_scale: boolean; points: SweepPoint[] }>("/api/experiments/sweep", body),

  upload: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<Dataset>("POST", "/api/upload", { form });
  },
  datasets: () => get<{ datasets: Dataset[] }>("/api/datasets"),
  dataset: (id: number) => get<Dataset>(`/api/datasets/${id}`),
  datasetRows: (id: number, offset: number, limit: number, status = "all") => get<RowsPage>(`/api/datasets/${id}/rows`, { offset, limit, status }),
  updateMapping: (id: number, body: Partial<Pick<DatasetMapping, "features" | "conversions" | "label_column" | "id_column">> & { clear_label?: boolean; clear_id?: boolean }) =>
    put<Dataset>(`/api/datasets/${id}/mapping`, body),
  resetMapping: (id: number) => post<Dataset>(`/api/datasets/${id}/remap`),
  deleteDataset: (id: number) => request<void>("DELETE", `/api/datasets/${id}`),
  simulateRow: (id: number, rowIndex: number, body: { object_id?: string | null; persist?: boolean; source_detail?: string }) =>
    post<PredictionResult>(`/api/datasets/${id}/rows/${rowIndex}/simulate`, body),
  processBatch: (body: { dataset_id: number; persist?: boolean; object_id?: string | null }) => post<BatchResponse>("/api/process-batch", body),
  templateUrl: (format: "csv" | "json", rows = 24) => `${API_BASE}/api/dataset/template?format=${format}&rows=${rows}`,

  liveStatus: () => get<LiveStatus>("/api/sensors/live-status"),
  liveLatest: (since: number) => get<{ samples: LiveSample[]; status: LiveStatus }>("/api/sensors/latest", { since }),
  streamStart: (rate_hz?: number) => post<{ stream: LiveStatus["simulated_stream"]; label: string }>("/api/sensors/stream/start", { rate_hz }),
  streamStop: () => post<{ stream: LiveStatus["simulated_stream"] }>("/api/sensors/stream/stop"),
  predictLive: (seq: number, body: { object_id?: string | null; persist?: boolean }) => post<PredictionResult>(`/api/sensors/live/${seq}/predict`, body),
  postSensorData: (samples: Partial<Features>[], device_id = "browser-console", simulated = true) =>
    post<{ accepted: number }>("/api/sensors/data", { device_id, simulated, samples }),

  history: (f: HistoryFilters) => get<HistoryPage>("/api/history", f as Query),
  historyItem: (id: number) => get<HistoryItem>(`/api/history/${id}`),
  deleteHistory: (id: number) => request<void>("DELETE", `/api/history/${id}`),
  exportHistory: (format: "csv" | "json", f: HistoryFilters) => request<string>("GET", "/api/history/export", { query: { ...f, format, offset: undefined, limit: undefined } as Query, raw: true }),
  metrics: (scope: "me" | "all" = "me", days = 14) => get<Metrics>("/api/metrics", { scope, days }),

  modelStatus: () => get<ModelStatus>("/api/model/status"),
  train: (body: { n_samples: number; seed: number; test_size: number }) => post<ModelStatus>("/api/model/train", body),
  trainingRuns: () => get<{ runs: TrainingRun[] }>("/api/model/runs"),
  datasetInfo: () => get<DatasetInfo>("/api/dataset/info"),
  downloadTrainingDataset: () => request<string>("GET", "/api/dataset/download", { raw: true }),

  settings: () => get<{ user: UserSettings; system: { announcement: string; allow_registration: boolean } }>("/api/settings"),
  saveSettings: (body: Partial<UserSettings>) => put<{ user: UserSettings }>("/api/settings", body),
  publicSettings: () => get<{ announcement: string; allow_registration: boolean }>("/api/settings/public"),

  adminStats: () => get<AdminStats>("/api/admin/stats"),
  adminUsers: () => get<{ users: (User & { predictions: number })[] }>("/api/admin/users"),
  adminUpdateUser: (id: number, body: { role?: string; is_active?: boolean }) => request<User>("PATCH", `/api/admin/users/${id}`, { body }),
  systemSettings: () => get<SystemSettings>("/api/admin/system-settings"),
  saveSystemSettings: (body: Partial<SystemSettings>) => put<SystemSettings>("/api/admin/system-settings", body),
};

export function wsUrl(path: string, query: Query): string {
  const base = API_BASE || window.location.origin;
  const url = new URL(path + qs(query), base);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "Unexpected error";
}
