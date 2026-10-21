# NeuroGrip

**AI-powered virtual prosthetic hand: intelligence and simulation platform.**

**Live demo: [neurogrip.vercel.app](https://neurogrip.vercel.app)** ·
[API docs](https://neurogrip.vercel.app/docs) ·
[Health check](https://neurogrip.vercel.app/api/health)

Hosted on Vercel (container runtime) with a Supabase PostgreSQL database. Sign in with the demo
account `demo@neurogrip.dev` or register a new one.

NeuroGrip demonstrates the *intelligence layer* of a robotic prosthetic hand:

```
SENSE  →  UNDERSTAND  →  DECIDE  →  ACT
tactile    material        safe       3D prosthetic
sensors    recognition     grip       hand response
```

A tactile reading (simulated, uploaded from CSV/JSON, or streamed live) is validated,
preprocessed and classified by a trained **Random Forest**, turned into a safety-aware
**grip decision**, and executed by a **3D prosthetic hand** whose state machine only
advances on real events. Every result is stored with its exact input.

> **Research prototype, not a medical device.** Sensor values are *simulated* unless real
> hardware is connected, grip values are *normalised simulation percentages* (not newtons),
> and the model is trained on simulated data. See [Limitations](#limitations).

---

## Contents

- [Features](#features) · [Screenshots](#screenshots) · [Architecture](#architecture) · [Tech stack](#tech-stack)
- [Quick start](#quick-start) (Docker, local, Vercel or Render) · [Environment variables](#environment-variables)
- [Machine learning](#machine-learning) · [Grip engine](#grip-engine)
- [External data (CSV/JSON)](#external-data-csvjson) · [Live sensors & hardware](#live-sensors--future-hardware)
- [API overview](#api-overview) · [Testing](#testing) · [Examiner demo script](#examiner-demo-script)
- [Simulation vs real hardware](#simulation-vs-real-hardware) · [Limitations](#limitations)

## Features

| Area | What is implemented |
|---|---|
| **3D lab** | React Three Fiber prosthetic hand (palm, wrist, thumb + 4 fingers, 3 joints each, independently driven), 8 virtual tactile sensors with glow/ripple, 6 objects (glass, bottle, cube, ball, plastic container, steel object), grasp profiles, lift/hold/release. Finger contact poses are *computed* by a wrap solver from the backend object geometry. |
| **State machine** | `IDLE → OPEN → APPROACHING → SENSING → CONTACT → ANALYZING → PREDICTED → GRIP_DECISION → GRIPPING → HOLDING → LIFTING → RELEASING → COMPLETED` (+ `ERROR`). `ANALYZING → PREDICTED` only happens when the backend answers. |
| **ML** | Physics-inspired synthetic dataset (4 800 samples, seed 42), sklearn `Pipeline` (log10 conductivity → scaler → `RandomForestClassifier(100, depth 12, rs 42)`), held-out metrics, 5-fold CV, confusion matrix, confidence calibration, retraining from the UI. |
| **Grip engine** | `base + sensor adjustment − fragility protection + confidence adjustment`, clamped 0–100, conservative mode for uncertain predictions, novelty check, object structural limits, secure-hold floor, safety warnings. |
| **Data sources** | Simulated provider, uploaded CSV/JSON (single row, playback, batch), live stream (WebSocket + REST fallback). All use **one** prediction pipeline. |
| **External Data Studio** | Drag-and-drop upload, alias detection, unit conversion, manual mapping, validation (missing/invalid/out-of-distribution), preview, row selection, **SIMULATE THIS SAMPLE**, playback (first/prev/play/pause/next/last/reset, 0.5–5×), batch processing with real evaluation metrics, CSV/JSON export. |
| **Platform** | JWT auth (bcrypt), USER/ADMIN roles, history with filters/export, analytics, ML model lab, experiments (live sliders + sensitivity sweeps), settings, admin, dark/light themes, reduced-motion support. |
| **Hosting** | One container image (`Dockerfile.vercel`) serves the API and the built frontend on one origin. Live on Vercel with Supabase PostgreSQL; also runs with Docker Compose or on Render. |

## Screenshots

| | |
|---|---|
| ![Virtual Lab: glass held with a gentle grip](demo-screenshots/01_lab_glass_holding.png) | ![Virtual Lab: bottle being lifted](demo-screenshots/02_lab_bottle_lifting.png) |
| Virtual Lab: glass held with a gentle grip | Virtual Lab: bottle lifted with a cylindrical grasp |
| ![Uncertain prediction with conservative grip](demo-screenshots/03_lab_uncertain_conservative.png) | ![Data Studio: row 1 simulated](demo-screenshots/04_studio_row1_simulated.png) |
| Degraded contact: "Uncertain" prediction, conservative grip | External Data Studio: uploaded row simulated |
| ![Data Studio: messy column mapping](demo-screenshots/05_studio_messy_mapping.png) | ![Data Studio: batch evaluation](demo-screenshots/06_studio_batch_evaluation.png) |
| Alias detection and unit conversion on a messy CSV | Batch processing with evaluation metrics |
| ![Live sensor stream telemetry](demo-screenshots/07_live_stream_telemetry.png) | ![Prediction history](demo-screenshots/08_history.png) |
| Live sensor stream with per-sample predictions | History of every result with its exact input |
| ![Analytics](demo-screenshots/09_analytics.png) | ![ML model lab](demo-screenshots/10_ml_model.png) |
| Analytics computed from history | ML Model lab: metrics, confusion matrix, retraining |

## Architecture

```mermaid
flowchart LR
  subgraph Sources["Sensor providers (swappable)"]
    S1[SimulatedSensorProvider<br/>physics model]
    S2[FileSensorProvider<br/>uploaded CSV/JSON row]
    S3[LiveSensorProvider<br/>REST · WebSocket]
  end
  S1 & S2 & S3 --> V[Validation]
  V --> P[Preprocessing<br/>ordering · log10 σ · scaling]
  P --> M[Random forest<br/>predict_proba]
  M --> R[Recognition<br/>confidence · OOD · novelty]
  R --> G[Grip engine<br/>+ safety]
  G --> C[SimulationCommand]
  C --> UI[3D hand state machine]
  C --> DB[(PredictionHistory<br/>PostgreSQL / SQLite)]
```

```
backend/
  app/
    domain/      materials, feature specs, objects + grasp profiles (single source of truth)
    sensors/     physics.py (simulator), providers.py (provider abstraction), live.py (hub + stream)
    ml/          dataset.py, preprocessing.py (shared validation + transforms), train.py, registry.py
    grip/        engine.py (grip engine, safety, SimulationCommand)
    services/    pipeline.py (THE canonical pipeline), history.py, analytics.py, accounts.py
    ingest/      parser.py (safe CSV/JSON parsing, alias mapping, validation)
    api/         FastAPI routes + WebSocket, deps (JWT, roles, device key)
  scripts/       mock_sensor_device.py, generate_sample_data.py
  tests/         92 pytest tests incl. the end-to-end acceptance test
frontend/
  src/sim/       stateMachine.ts, kinematics.ts (wrap solver), motion.ts, useGraspRun.ts, sources.ts
  src/components hand/ (R3F scene), pipeline/, prediction/, data/, charts/, ui/
  src/pages/     Landing, Auth, Dashboard, Lab, DataStudio, SensorSimulator, Experiments,
                 History, Analytics, ModelLab, Settings, Admin
  e2e/           Playwright acceptance tests
hardware/        ESP32 reference sketch
sample_data/     ready-to-upload example datasets
demo-screenshots/  screenshots used in this README

Dockerfile.vercel  single image: builds the frontend, installs the API, trains the model, serves both
vercel.json        Vercel project config ("framework": "container")
.vercelignore      keeps local artifacts, node_modules and screenshots out of Vercel uploads
render.yaml        Render blueprint (alternative free host, same image)
docker-compose.yml PostgreSQL + API + nginx web for self-hosting (uses backend/ and frontend/ Dockerfiles)
```

**Canonical pipeline.** `PredictionPipeline.run_batch()` (`backend/app/services/pipeline.py`) is the only
code path from sensor features to a grip command. The frontend never re-implements ML or grip
logic; it renders the returned `PredictionResult` and animates its `SimulationCommand`.

## Tech stack

Frontend: React 19, TypeScript, Vite 8, Tailwind CSS 4, React Router 7, TanStack Query, Zustand,
Three.js + React Three Fiber + drei, Recharts, Framer Motion, Lucide.
Backend: Python 3.11, FastAPI, Pydantic 2, SQLAlchemy 2, Uvicorn, PyJWT, bcrypt.
ML: NumPy, pandas, scikit-learn, joblib. Database: PostgreSQL (Supabase in production,
PostgreSQL 16 in Docker Compose), SQLite fallback for local development.
Testing: pytest, Vitest + Testing Library, Playwright.
Deployment: Vercel container runtime (live), Docker + Docker Compose + nginx, Render blueprint.

## Quick start

### Option A: Docker (PostgreSQL + API + web)

```bash
cp .env.example .env          # set POSTGRES_PASSWORD, SECRET_KEY, SENSOR_DEVICE_KEY, ADMIN_PASSWORD
docker compose up --build
# open http://localhost:8080   (API: http://localhost:8000/docs)
```

The backend image trains the model at build time (deterministic, seed 42). Models retrained from
the UI persist in the `model_artifacts` volume. With `ENVIRONMENT=production` the API refuses to
start with default secrets.

### Option B: Local development

Prerequisites: Python 3.11+, Node 20+ (22 recommended). PostgreSQL is optional.

```bash
# backend (SQLite by default; trains the model on first start, ~3 s)
cd backend
python -m venv .venv && . .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000

# frontend (proxies /api and /ws to :8000)
cd frontend
npm install
npm run dev            # http://localhost:5173
```

Development accounts are seeded automatically:

| Role | Email | Password |
|---|---|---|
| USER (examiner demo) | `demo@neurogrip.dev` | `demo-password-2026` |
| ADMIN | `admin@neurogrip.dev` | `NeuroGrip-Admin-2026` |

To use PostgreSQL locally set `DATABASE_URL=postgresql+psycopg://user:pass@localhost:5432/neurogrip`.
Tables are created on startup.

### Option C: Vercel (live deployment)

The live site at [neurogrip.vercel.app](https://neurogrip.vercel.app) runs on Vercel's container
runtime. `vercel.json` sets `"framework": "container"`, so Vercel builds `Dockerfile.vercel` from
the repository root:

1. a Node 22 stage builds the React app (`VITE_API_URL` empty, so the frontend calls the same origin);
2. a Python 3.11 stage installs the API, trains the model at build time (seed 42) and copies in
   the built frontend (`FRONTEND_DIST=/app/static`);
3. Uvicorn serves `/api`, `/ws` and the single-page app on `$PORT` with one worker.

To deploy your own copy:

1. Create a Vercel project from this repository and branch. The framework preset is
   **Container** (already set by `vercel.json`).
2. Add these environment variables for **Production**:
   `ENVIRONMENT=production`, `DATABASE_URL`, `SECRET_KEY` (≥ 32 random characters),
   `SENSOR_DEVICE_KEY`, `ADMIN_PASSWORD`.
3. Deploy, then open `https://<your-project>.vercel.app/api/health`. A healthy deployment returns
   `"status": "ok"` with `"database": {"ok": true, "backend": "postgresql"}` and a ready model.

**Database (Supabase).** Use the **Session pooler** connection string from Supabase → Connect
(port 5432), with the `postgresql+psycopg://` prefix and `?sslmode=require`:

```
postgresql+psycopg://<db-user>.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres?sslmode=require
```

- Tables are created on first start. The live database uses a dedicated `neurogrip_app` role
  whose `search_path` is a `neurogrip` schema, so the app's tables stay out of `public`.
- Supabase pooler hosts are `aws-0-…` or `aws-1-…` depending on the project. If the host in
  `DATABASE_URL` rejects the project ("tenant not found"), the app tries the other hosts
  automatically (`resolve_supabase_pooler` in `backend/app/db/session.py`). Copying the exact
  string from Supabase avoids that extra failed attempt on every cold start.
- `Dockerfile.vercel` keeps the connection pool small (`DB_POOL_SIZE=4`, `DB_MAX_OVERFLOW=4`)
  so several instances fit within the pooler's limits.

**Hosted behaviour to be aware of.**

- Vercel starts and stops container instances on demand, so the first request after a quiet
  period can take a few seconds while the app connects to the database and loads the model.
- Each instance has its own memory and disk. The live-sensor hub and models retrained from the
  UI are not shared between instances and are lost when an instance stops; the model trained at
  build time is always available. Training runs and all history are stored in PostgreSQL.
- If WebSockets are unavailable, the UI falls back to REST polling for live sensors automatically.

### Option D: Render (alternative free host)

`render.yaml` describes one Docker web service built from `Dockerfile.vercel` (a single image
that serves the API and the built frontend on one origin, listening on `$PORT`). In the Render
dashboard choose **New → Blueprint**, select this repository, then enter `DATABASE_URL`
(e.g. a Supabase pooler URL), `SECRET_KEY`, `SENSOR_DEVICE_KEY` and `ADMIN_PASSWORD` when asked.
Free instances sleep after ~15 minutes without traffic; the first request then takes about a minute.

## Environment variables

All settings are in `backend/app/core/config.py`; see [`.env.example`](.env.example).

| Variable | Default (dev) | Purpose |
|---|---|---|
| `ENVIRONMENT` | `development` | `production` enforces non-default secrets |
| `DATABASE_URL` | `sqlite:///backend/neurogrip.db` | PostgreSQL in production |
| `SECRET_KEY` | dev placeholder | JWT signing key (≥ 32 chars in production) |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `720` | JWT lifetime |
| `SENSOR_DEVICE_KEY` | dev placeholder | `X-Device-Key` for hardware ingestion |
| `CORS_ORIGINS` | localhost dev origins | comma-separated allowed browser origins |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | see above | bootstrap administrator (only used when that account does not exist yet) |
| `SEED_DEMO_USER`, `DEMO_EMAIL`, `DEMO_PASSWORD` | `true`, … | examiner account |
| `MODEL_DIR` | `backend/artifacts` | persisted model + metadata |
| `DATASET_SAMPLES`, `DATASET_SEED`, `TEST_SIZE` | `4800`, `42`, `0.2` | training defaults |
| `MAX_UPLOAD_MB`, `MAX_UPLOAD_ROWS` | `5`, `20000` | upload limits |
| `SIMULATED_STREAM_RATE_HZ` | `4` | simulated live stream default |
| `TRAIN_ON_STARTUP_IF_MISSING` | `true` | train a model at startup if no artifact exists |
| `FRONTEND_DIST` | unset (`/app/static` in `Dockerfile.vercel`) | when set, the API also serves the built frontend |
| `DB_POOL_SIZE`, `DB_MAX_OVERFLOW` | `10`, `20` (`4`, `4` in `Dockerfile.vercel`) | SQLAlchemy pool; keep small for managed poolers |
| `VITE_API_URL` (frontend build) | empty | API origin if not served same-origin |

Hosted deployments (Vercel, Render) need only `ENVIRONMENT`, `DATABASE_URL`, `SECRET_KEY`,
`SENSOR_DEVICE_KEY` and `ADMIN_PASSWORD`; the image sets the rest. Never commit real values.

## Machine learning

**Dataset.** `app/sensors/physics.py` draws *latent physical properties* per sample (Young's modulus,
density, thermal effusivity, electrical conductivity, viscoelastic relaxation time) plus
environment (ambient temperature, humidity, probe force), contact quality and sensor noise, then
computes what an idealised fingertip would read:

| Feature | Unit | Physics |
|---|---|---|
| `pressure` | kPa | Hertz-inspired: stiffer objects → smaller contact patch → higher pressure |
| `temperature` | °C | contact temperature `(e_s·T_s + e_o·T_o)/(e_s + e_o)`: metals feel cold |
| `vibration` | Hz | tap response ∝ speed of sound `√(E/ρ)`, damped by viscoelasticity |
| `conductivity` | S/m | true conductivity (+humidity, coatings, fillers) through partial contact + noise floor |
| `contact_duration` | s | settling time dominated by viscoelastic creep |

Realistic nuisances (painted steel, varnished wood, carbon-filled rubber, poor contact) create
genuine class overlap, so confidence is meaningful.

**Training** (`python -m app.ml.train`): stratified 80/20 split, 5-fold CV on the training split,
`Pipeline(SensorFeatureTransformer → StandardScaler → RandomForestClassifier(n_estimators=100,
max_depth=12, random_state=42))`, persisted with joblib and swapped atomically.

**Measured results** (seed 42, 960 held-out samples; recomputed and asserted by the tests):

| Accuracy | Precision (macro) | Recall (macro) | F1 (macro) | 5-fold CV |
|---|---|---|---|---|
| 96.9 % | 97.0 % | 96.9 % | 96.9 % | 97.4 % ± 0.8 |

Confidence is calibrated in a useful way: test predictions with HIGH confidence (≥ 80 %, 93 % of
samples) are 99.4 % correct, LOW confidence ones (< 60 %) only 43.8 %. The main confusions are
painted steel ↔ glass and varnished wood ↔ plastic.

**Known weakness (shown honestly in the UI):** under severely degraded contact (contact quality
≈ 0.35 with 2.5× noise) accuracy collapses, sometimes with high confidence. This is why the grip
engine adds a novelty check and object structural limits (below), and why the simulator exposes
contact-quality and noise controls.

## Grip engine

```
grip = material_base + sensor_adjustment − fragility_protection + confidence_adjustment
grip = clamp(grip, 0, 100), then conservative cap / object limit / secure-hold floor
```

| Material | Base | Mode |
|---|---|---|
| Glass | 25 % | Gentle |
| Fabric | 20 % | Light |
| Plastic | 45 % | Moderate |
| Rubber | 50 % | Moderate-firm |
| Wood | 65 % | Firm |
| Steel | 75 % | Firm (rigid) |

- **Sensor adjustment** (±8): z-scores of pressure (+), vibration/smoothness (+), settling time (−)
  relative to the predicted class's training distribution.
- **Fragility protection**: material + object-form fragility (e.g. thin-walled glass).
- **Confidence**: HIGH → 0; MODERATE → up to −8; LOW → prediction shown as **Uncertain**, grip based on
  the *most fragile plausible material* (p ≥ 0.15), capped at 35 %, slow closure and lift.
- **Defence in depth**: out-of-training-range inputs (−5), per-class novelty check (−8), object
  structural limit (glass ≤ 40 %, container ≤ 55 %, bottle ≤ 70 %), 12 % secure-hold floor,
  thermal warnings.
- Output: grip %, mode, grasp type, safety status (NOMINAL/CAUTION/WARNING), warnings, action text,
  step-by-step explanation and a `SimulationCommand` for the hand.

## External data (CSV/JSON)

Upload in **External Data Studio** or via `POST /api/upload`. Files are parsed with the standard
library as inert data, never executed. Limits: 5 MB, 20 000 rows, 200 columns.

Expected columns (any order, extra columns ignored):

```csv
row_id,pressure,temperature,vibration,conductivity,contact_duration,material
1,229.8,27.42,2741.3,1.62e-12,0.151,Glass
```

JSON may be an array of objects, `{"data": [...]}` (also `rows`/`samples`/`records`), pandas
`{"columns": [...], "data": [[...]]}`, JSON Lines, or nested objects (leaf keys are matched).

**Alias detection** (case/format-insensitive, units in names or parentheses are understood):

| Feature | Aliases | Unit conversions |
|---|---|---|
| pressure | pressure, force, grip_force, load, force_sensor | Pa, MPa, psi, bar → kPa |
| temperature | temperature, temp, temperature_c, temp_c | °F, K → °C |
| vibration | vibration, acceleration, accelerometer, imu, frequency | kHz → Hz |
| conductivity | conductivity, resistance, resistivity, electrical_conductivity | 1/x for resistance/resistivity, µS/cm → S/m |
| contact_duration | contact_duration, duration, contact_time, touch_duration | ms → s |
| label | material, label, class, target, object_material | free text → canonical material |

Rows are classified as **valid**, **warning** (outside the training range or unknown label; can be
simulated with a safety margin) or **invalid** (missing/non-numeric/non-finite/physically
impossible; never silently imputed). Mapping can be overridden per feature in the UI.

Example files in [`sample_data/`](sample_data): labelled CSV, unlabelled CSV, JSON, and a
deliberately messy CSV with aliases, Fahrenheit, resistivity, milliseconds and invalid cells
(regenerate with `python backend/scripts/generate_sample_data.py`).

## Live sensors & future hardware

```
CURRENT:  Simulated sensor → Sensor provider → ML model → Grip engine → Virtual hand
FUTURE:   Real sensor → ESP32/Arduino → Sensor provider → ML model → Grip engine
          → Motor controller → Physical hand
```

- `POST /api/sensors/data` with `X-Device-Key` (or a user JWT): batches of up to 100 samples.
- `WS /ws/sensors?token=<JWT>` streams `status` and `sample` messages (each sample already
  classified); devices may connect with `?device_key=` and send `{"type":"sample","data":{…}}`.
  Any client can send `{"type":"ping","t":…}` to measure latency.
- `GET /api/sensors/latest?since=<seq>` is the REST polling fallback the UI switches to
  automatically if WebSockets are blocked. `GET /api/sensors/live-status` reports connection,
  rate (measured), last update, sample count and source.
- **Simulated live stream** (`POST /api/sensors/stream/start`) is a server-side emulator that
  pushes readings through the same ingestion path, labelled `SIMULATED_LIVE_STREAM`.
- `backend/scripts/mock_sensor_device.py` is an *external process* that emulates a device over HTTP
  (self-declares `simulated: true`); `hardware/esp32_tactile_client/` is a reference sketch.
- Readings with pressure < 5 kPa are treated as "no contact" and not classified.

Only the provider changes when real hardware arrives; the ML, grip and 3D layers stay the same.

## API overview

Interactive docs: [neurogrip.vercel.app/docs](https://neurogrip.vercel.app/docs) (live) or
`http://localhost:8000/docs` (local).

| Area | Endpoints |
|---|---|
| Health & catalogues | `GET /api/health`, `/api/objects`, `/api/materials`, `/api/features` |
| Auth | `POST /api/auth/register`, `/api/auth/login`, `GET/PATCH /api/auth/me`, `POST /api/auth/change-password` |
| Prediction | `POST /api/predict`, `POST /api/simulate`, `POST /api/sensors/simulated/sample`, `POST /api/experiments/sweep` |
| External data | `POST /api/upload`, `GET /api/datasets`, `GET /api/datasets/{id}`, `GET /api/datasets/{id}/rows`, `PUT /api/datasets/{id}/mapping`, `POST /api/datasets/{id}/remap`, `DELETE /api/datasets/{id}`, `POST /api/datasets/{id}/rows/{i}/simulate`, `POST /api/process-batch`, `GET /api/dataset/template` |
| Live sensors | `POST /api/sensors/data`, `GET /api/sensors/live-status`, `GET /api/sensors/latest`, `POST /api/sensors/stream/start`, `POST /api/sensors/stream/stop`, `POST /api/sensors/live/{seq}/predict`, `WS /ws/sensors` |
| History & analytics | `GET /api/history`, `GET /api/history/export`, `GET/DELETE /api/history/{id}`, `GET /api/metrics` |
| Model | `GET /api/model/status`, `POST /api/model/train` (admin), `GET /api/model/classes`, `GET /api/model/runs`, `GET /api/dataset/info`, `GET /api/dataset/download` |
| Settings & admin | `GET/PUT /api/settings`, `GET /api/settings/public`, `GET /api/admin/stats`, `GET /api/admin/users`, `PATCH /api/admin/users/{id}`, `GET/PUT /api/admin/system-settings` |

Database tables: `users`, `user_settings`, `system_settings`, `prediction_history` (source, exact
features, prediction, probabilities, confidence, grip breakdown, safety, ground truth, dataset/row
reference, model version, latency), `datasets`, `model_training_runs`.

## Testing

```bash
# backend: 92 tests (unit + API + end-to-end pipeline)
cd backend && . .venv/bin/activate
pytest
# same suite against PostgreSQL (uses and resets that database)
TEST_DATABASE_URL=postgresql+psycopg://user:pass@localhost:5432/neurogrip_test pytest

# frontend: unit/component tests (state machine, kinematics, motion, CSV export, prediction panel)
cd frontend && npm test
npm run typecheck && npm run build

# browser end-to-end (backend on :8000 and `npm run dev` on :5173 must be running)
npx playwright install chromium   # once, if no Chromium is available
npm run e2e                        # or E2E_BASE_URL=http://localhost:8080 npm run e2e
```

The critical acceptance test exists twice: `backend/tests/test_e2e_pipeline.py` proves that an
uploaded row's API result equals an independent recomputation from the persisted model and grip
engine, and `frontend/e2e/critical-pipeline.spec.ts` drives a real browser through upload →
select row 1 → SIMULATE THIS SAMPLE → full hand state sequence → history.

## Examiner demo script

1. Open [neurogrip.vercel.app](https://neurogrip.vercel.app) (or your local instance) and sign in
   as `demo@neurogrip.dev` (button "Fill demo credentials").
2. **Virtual Lab → "Demo 1: Glass".** Watch OPEN → … → RELEASING. Material, confidence (actual
   `predict_proba`), grip decomposition and safety appear only after the backend answers.
   Then **"Demo 2: Bottle"** (tall cylindrical grasp).
3. Open *Sensor conditions*, set contact quality ≈ 0.35 and noise ≈ 2.5: confidence drops, the
   prediction may become **Uncertain**, and the engine switches to a conservative grip.
4. **External Data Studio**: upload `sample_data/tactile_unlabelled.csv` (or the messy file to see
   alias mapping), select row 1, check the values, click **SIMULATE THIS SAMPLE**. Try playback and
   **Process all rows** with `tactile_labelled.csv` to see real evaluation metrics; export CSV/JSON.
5. **Sensor Simulator**: Connect → Start simulated stream → LIVE · CONNECTED, changing telemetry and
   per-sample predictions. Back in the Lab choose **LIVE SENSOR** and grasp with a live sample.
6. **History / Analytics / ML Model**: every stored result with its exact input; analytics from
   history; held-out metrics, confusion matrix, feature importances and retraining (admin).

## Simulation vs real hardware

| | In this software | Real prosthesis |
|---|---|---|
| Sensor values | physics-inspired simulation (labelled SIMULATED) or uploaded data | calibrated transducers |
| Classifier | trained on simulated data | retrained on measured data |
| Grip | normalised 0–100 % | force/current control with feedback loops |
| Safety | software rules + object limits | certified hardware interlocks, independent of the ML |

## Limitations

- Sensor values are simulated unless real hardware is connected; external devices can only
  *declare* whether their data is simulated.
- Grip percentages are normalised simulation values, not physical forces.
- The ML model is a software prototype trained on synthetic data; it is not robust to severely
  degraded contact, and real hardware requires sensor calibration and retraining.
- Real motor control would require hardware safety validation (current limits, watchdogs,
  mechanical stops) independent of the software.
- Clinical use would require extensive validation and regulatory compliance. No medical claims are made.
- The live-sensor hub is in-process: run the API with a single worker (as the Dockerfile does).
  On hosts that run several instances (such as Vercel), live streams and UI-retrained models are
  per instance and not persistent.
- Database schema is created with `create_all`; a production roll-out should add Alembic migrations.
