/* Types mirroring the FastAPI responses. The frontend never re-derives ML or grip
 * logic: it renders these results. */

export type DataSource = "SIMULATED" | "UPLOADED" | "LIVE";
export type ConfidenceLevel = "HIGH" | "MODERATE" | "LOW";
export type SafetyStatus = "NOMINAL" | "CAUTION" | "WARNING";
export type Material = "Glass" | "Steel" | "Plastic" | "Wood" | "Rubber" | "Fabric";
export type FeatureName = "pressure" | "temperature" | "vibration" | "conductivity" | "contact_duration";
export type Finger = "thumb" | "index" | "middle" | "ring" | "little";

export type Features = Record<FeatureName, number>;

export interface User {
  id: number;
  email: string;
  full_name: string;
  role: "USER" | "ADMIN";
  is_active: boolean;
  created_at: string | null;
  last_login_at: string | null;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  user: User;
}

export interface SafetyWarning {
  code: string;
  severity: "INFO" | "CAUTION" | "WARNING";
  message: string;
}

export interface GripDecision {
  material: Material;
  is_uncertain: boolean;
  confidence: number;
  confidence_level: ConfidenceLevel;
  object_id: string;
  object_auto_selected: boolean;
  base_grip: number;
  sensor_adjustment: number;
  sensor_breakdown: Partial<Record<FeatureName, number>>;
  fragility_protection: number;
  confidence_adjustment: number;
  raw_grip: number;
  grip_percent: number;
  grip_mode: string;
  grip_mode_label: string;
  grasp_profile: string;
  grasp_type: string;
  safety_status: SafetyStatus;
  warnings: SafetyWarning[];
  action: string;
  explanation: string[];
  plausible_materials: Material[];
  structural_limit: number;
  typicality_score: number | null;
  typicality_threshold: number | null;
}

export interface SimulationCommand {
  object_id: string;
  profile_id: string;
  grasp_type: string;
  grip_percent: number;
  finger_force: Record<Finger, number>;
  finger_spread: number;
  closure_speed: number;
  palm_height_fraction: number;
  hold_ms: number;
  lift_height: number;
  lift_speed: number;
  lift_permitted: boolean;
  object_deformation: number;
  sensor_intensity: number;
}

export interface TraceStage {
  stage: "validation" | "preprocessing" | "inference" | "recognition" | "grip" | "command";
  label: string;
  duration_ms: number;
  status: string;
  detail: string;
}

export interface OODFeature {
  feature: FeatureName;
  value: number;
  expected_low: number;
  expected_high: number;
}

export interface Prediction {
  material: Material;
  display_label: Material | "Uncertain";
  is_uncertain: boolean;
  confidence: number;
  confidence_level: ConfidenceLevel;
  probabilities: Record<Material, number>;
  ranking: { material: Material; probability: number }[];
  out_of_distribution: OODFeature[];
}

export interface SensorReading {
  features: Features;
  source: DataSource;
  source_detail: string;
  timestamp: string;
  ground_truth: Material | null;
  object_id: string | null;
  provenance: Record<string, unknown>;
}

export interface PredictionResult {
  id: number | null;
  persisted: boolean;
  timestamp: string;
  data_source: DataSource;
  source_detail: string | null;
  sample: Features;
  ground_truth: Material | null;
  correct: boolean | null;
  dataset_ref: { dataset_id: number; row_index: number; row_id: string } | null;
  prediction: Prediction;
  grip: GripDecision;
  command: SimulationCommand;
  model_version: string;
  trace: TraceStage[];
  latency_ms: number;
  reading?: SensorReading;
  row?: RowView;
  live_sample?: LiveSample;
}

export interface GraspProfile {
  id: string;
  name: string;
  grasp_type: string;
  description: string;
  finger_participation: Record<Finger, number>;
  closure_speed_factor: number;
  finger_spread: number;
  palm_height_fraction: number;
  lift_height: number;
  object_fragility: number;
  max_safe_grip: number;
}

export interface VirtualObject {
  id: string;
  name: string;
  shape: "cylinder" | "bottle" | "box" | "sphere" | "container" | "rod";
  default_material: Material;
  dimensions: Record<string, number>;
  description: string;
  profile: GraspProfile;
}

export interface MaterialInfo {
  name: Material;
  base_grip: number;
  fragility_points: number;
  grip_mode: string;
  grip_mode_label: string;
  compliance: number;
  description: string;
  appearance: string;
}

export interface FeatureInfo {
  name: FeatureName;
  label: string;
  unit: string;
  description: string;
  hard_min: number;
  hard_max: number;
  log_scale: boolean;
}

/* ------------------------------------------------------------ datasets */
export interface RowIssue {
  feature: string | null;
  code: string;
  message: string;
  value?: unknown;
}

export interface RowView {
  row_index: number;
  row_id: string;
  raw: Record<string, unknown>;
  features: Record<FeatureName, number | null>;
  label: Material | null;
  raw_label: string | null;
  status: "valid" | "warning" | "invalid";
  issues: RowIssue[];
  out_of_distribution: OODFeature[];
  conversions: Record<string, string>;
}

export interface DatasetMapping {
  features: Record<FeatureName, string | null>;
  conversions: Record<FeatureName, string | null>;
  quality: Record<FeatureName, string | null>;
  label_column: string | null;
  id_column: string | null;
  notes: string[];
  auto: boolean;
}

export interface DatasetSummary {
  row_count: number;
  valid_rows: number;
  warning_rows: number;
  invalid_rows: number;
  simulatable_rows: number;
  detected_features: FeatureName[];
  missing_features: FeatureName[];
  missing_by_feature: Record<FeatureName, number>;
  invalid_by_feature: Record<FeatureName, number>;
  has_labels: boolean;
  label_distribution: Partial<Record<Material, number>>;
  issues_sample: (RowIssue & { row_index: number; row_id: string })[];
  feature_units: Record<FeatureName, string>;
}

export interface Dataset {
  id: number;
  name: string;
  format: "csv" | "json";
  size_bytes: number;
  row_count: number;
  columns: string[];
  mapping: DatasetMapping;
  summary: DatasetSummary;
  parse_notes: string[];
  created_at: string | null;
  preview?: RowView[];
}

export interface RowsPage {
  dataset_id: number;
  offset: number;
  limit: number;
  total: number;
  rows: RowView[];
}

export interface BatchRow {
  row_index: number;
  row_id: string;
  ground_truth: Material | null;
  status: "ok" | "invalid";
  errors?: RowIssue[];
  features?: Features;
  predicted_material?: Material;
  display_label?: Material | "Uncertain";
  is_uncertain?: boolean;
  confidence?: number;
  confidence_level?: ConfidenceLevel;
  probabilities?: Record<Material, number>;
  grip_percent?: number;
  grip_mode?: string;
  grip_mode_label?: string;
  grasp_type?: string;
  object_id?: string;
  safety_status?: SafetyStatus;
  warnings?: string[];
  action?: string;
  correct?: boolean | null;
}

export interface ClassMetrics {
  precision: number;
  recall: number;
  f1: number;
  support: number;
}

export interface ConfusionMatrix {
  labels: string[];
  matrix: number[][];
}

export interface BatchEvaluation {
  labeled_rows: number;
  accuracy: number;
  precision_macro: number | null;
  recall_macro: number | null;
  f1_macro: number | null;
  uncertain_rows: number;
  coverage: number;
  accuracy_when_confident: number | null;
  per_class: Record<string, ClassMetrics>;
  confusion_matrix: ConfusionMatrix;
  note: string;
}

export interface BatchResponse {
  dataset_id: number | null;
  dataset_name: string;
  processed: number;
  ok: number;
  invalid: number;
  persisted: number;
  elapsed_ms: number;
  per_row_ms: number;
  model_version: string;
  summary: {
    materials: Record<string, number>;
    confidence_levels: Record<string, number>;
    safety: Record<string, number>;
    mean_confidence: number | null;
  };
  evaluation: BatchEvaluation | null;
  results: BatchRow[];
}

/* -------------------------------------------------------------- live */
export interface LivePrediction {
  material: Material;
  display_label: Material | "Uncertain";
  is_uncertain: boolean;
  confidence: number;
  confidence_level: ConfidenceLevel;
  probabilities: Record<Material, number>;
  grip_percent: number;
  grip_mode: string;
  grip_mode_label: string;
  safety_status: SafetyStatus;
  object_id: string;
  correct: boolean | null;
  latency_ms: number;
  model_version: string;
}

export interface LiveSample {
  seq: number;
  device_id: string;
  source: string;
  timestamp: string;
  received_at: string;
  features: Partial<Record<FeatureName, number | string | null>>;
  ground_truth: Material | null;
  prediction: LivePrediction | null;
  errors: RowIssue[];
  replay?: boolean;
}

export interface LiveStatus {
  connected: boolean;
  state: "CONNECTED" | "STALE" | "NO_DATA";
  source: string | null;
  last_source: string | null;
  is_simulated: boolean;
  device_id: string | null;
  rate_hz: number;
  last_update: string | null;
  seconds_since_last: number | null;
  samples_received: number;
  last_seq: number;
  subscribers: number;
  simulated_stream: { running: boolean; rate_hz?: number; current_object?: string | null; current_material?: string | null; error?: string };
  server_time: string;
}

/* ------------------------------------------------------- history/metrics */
export interface HistoryItem {
  id: number;
  user_id: number | null;
  created_at: string;
  data_source: DataSource;
  source_detail: string | null;
  object_id: string | null;
  features: Features;
  predicted_material: Material;
  display_label: Material | "Uncertain";
  is_uncertain: boolean;
  confidence: number;
  confidence_level: ConfidenceLevel;
  grip_percent: number;
  grip_mode: string;
  grasp_type: string;
  safety_status: SafetyStatus;
  ground_truth: Material | null;
  is_correct: boolean | null;
  dataset_id: number | null;
  row_ref: string | null;
  model_version: string;
  latency_ms: number;
  probabilities?: Record<Material, number>;
  safety_warnings?: SafetyWarning[];
  grip_breakdown?: {
    base_grip: number;
    sensor_adjustment: number;
    sensor_breakdown: Record<string, number>;
    fragility_protection: number;
    confidence_adjustment: number;
    raw_grip: number;
    structural_limit: number;
    action: string;
    explanation: string[];
  };
  meta?: Record<string, unknown>;
}

export interface HistoryPage {
  total: number;
  offset: number;
  limit: number;
  items: HistoryItem[];
}

export interface ModelSummary {
  version: string;
  metrics: Record<string, number>;
  confusion_matrix: ConfusionMatrix;
  per_class: Record<string, ClassMetrics>;
  confidence_bands: { level: ConfidenceLevel; count: number; share: number; accuracy: number | null }[];
  feature_importances: Record<FeatureName, number>;
}

export interface Metrics {
  total_predictions: number;
  material_distribution: { material: string; count: number }[];
  source_distribution: { source: DataSource; count: number }[];
  safety_distribution: { status: SafetyStatus; count: number }[];
  confidence_levels: { level: ConfidenceLevel; count: number }[];
  confidence_histogram: { bucket: string; low: number; count: number }[];
  grip_histogram: { bucket: string; count: number }[];
  grip_by_material: { material: Material; count: number; mean_grip: number | null; min_grip: number | null; max_grip: number | null; mean_confidence: number | null }[];
  timeline: { date: string; SIMULATED: number; UPLOADED: number; LIVE: number }[];
  latency_ms: { p50: number | null; p95: number | null; max: number | null };
  labeled_evaluation: { labeled_predictions: number; correct: number; accuracy: number | null; confusion_matrix: ConfusionMatrix };
  model?: ModelSummary;
  scope: "me" | "all";
}

export interface ModelStatus extends Partial<ModelSummary> {
  ready: boolean;
  training: boolean;
  error: string | null;
  model_type?: string;
  pipeline_steps?: string[];
  params?: Record<string, number>;
  sklearn_version?: string;
  classes?: Material[];
  features?: FeatureName[];
  feature_units?: Record<FeatureName, string>;
  trained_at?: string;
  training_duration_s?: number;
  dataset?: {
    generator: string;
    n_samples: number;
    seed: number;
    test_size: number;
    train_size: number;
    test_count: number;
    class_counts: Record<Material, number>;
  };
  cross_validation?: { folds: number; scores: number[]; mean: number; std: number };
  typicality_thresholds?: Record<Material, number>;
  typicality_test_flag_rate?: number;
}

export interface TrainingRun {
  id: number;
  created_at: string;
  model_version: string;
  triggered_by: string;
  n_samples: number;
  seed: number;
  test_size: number;
  accuracy: number;
  f1_macro: number;
  duration_s: number;
}

export interface DatasetInfo {
  generator: string;
  simulated: boolean;
  n_samples: number;
  seed: number;
  test_size: number;
  train_size: number;
  test_count: number;
  class_counts: Record<Material, number>;
  features: { name: FeatureName; label: string; unit: string; description: string }[];
  class_feature_ranges: Record<Material, Record<FeatureName, { median: number; p05: number; p95: number }>>;
  latent_physics: Record<Material, Record<string, number | string | null>>;
}

export interface UserSettings {
  theme: "dark" | "light" | "system";
  reduced_motion: boolean;
  default_object: string;
  playback_speed: number;
  auto_save_history: boolean;
  record_playback: boolean;
  show_sensor_labels: boolean;
}

export interface SystemSettings {
  allow_registration: boolean;
  live_stream_rate_hz: number;
  announcement: string;
  max_upload_mb: number;
}

export interface Health {
  status: "ok" | "degraded";
  app: string;
  version: string;
  environment: string;
  time: string;
  uptime_s: number;
  database: { ok: boolean; backend: string; error: string | null };
  model: { ready: boolean; training: boolean; version: string | null; error: string | null };
  live: { connected: boolean; stream_running: boolean };
}

export interface AdminStats {
  users: { total: number; active: number; by_role: Record<string, number> };
  predictions: { total: number; by_source: Record<string, number>; by_safety: Record<string, number>; labeled: number; labeled_accuracy: number | null };
  datasets: { total: number; rows: number };
  model: { ready: boolean; training: boolean; version: string | null; accuracy: number | null; training_runs: number };
  live: LiveStatus;
  system: { environment: string; database: string; uptime_s: number };
}

export interface SweepPoint {
  value: number;
  valid: boolean;
  material?: Material;
  display_label?: string;
  confidence?: number;
  probabilities?: Record<Material, number>;
  grip_percent?: number;
  safety_status?: SafetyStatus;
  errors?: RowIssue[];
}
