"""Prediction endpoints. All of them call the one canonical PredictionPipeline."""

from __future__ import annotations

import numpy as np
from fastapi import APIRouter

from app.api.deps import DB, Ctx, CurrentUser
from app.domain.materials import FEATURE_SPECS, DataSource
from app.domain.objects import OBJECTS
from app.schemas.api import PredictRequest, SimulateRequest, SweepRequest
from app.sensors.physics import Environment
from app.services.history import record_prediction
from app.services.pipeline import PipelineResult, PredictionContext

router = APIRouter(prefix="/api", tags=["prediction"])


def respond(result: PipelineResult, db, user, persist: bool) -> dict:
    out = result.to_dict()
    out["id"] = None
    out["persisted"] = False
    if persist:
        row = record_prediction(db, result, user.id)
        out["id"] = row.id
        out["persisted"] = True
    return out


@router.post("/predict")
def predict(body: PredictRequest, ctx: Ctx, db: DB, user: CurrentUser):
    """Run arbitrary sensor features through the full pipeline (validation ->
    preprocessing -> random forest -> grip engine -> simulation command)."""
    context = PredictionContext(
        data_source=DataSource(body.data_source),
        source_detail=body.source_detail or "api",
        object_id=body.object_id,
        ground_truth=body.ground_truth,
    )
    result = ctx.pipeline.run(body.features.raw(), context)
    return respond(result, db, user, body.persist)


def _environment(body: SimulateRequest) -> Environment:
    return Environment(
        ambient_temperature=body.ambient_temperature,
        humidity=body.humidity,
        contact_quality=body.contact_quality,
        noise_level=body.noise_level,
    )


@router.post("/sensors/simulated/sample")
def simulated_sample(body: SimulateRequest, ctx: Ctx, user: CurrentUser):
    """Acquire one reading from the SimulatedSensorProvider (no prediction).

    The Virtual Lab calls this during the SENSING state, then sends the reading to
    ``/api/predict`` during ANALYZING.
    """
    material = body.material or OBJECTS[body.object_id].default_material
    reading = ctx.simulator.read(material, body.object_id, _environment(body), body.seed, source_detail=body.source_detail or "simulator")
    return {"reading": reading.to_dict(), "label": ctx.simulator.label}


@router.post("/simulate")
def simulate(body: SimulateRequest, ctx: Ctx, db: DB, user: CurrentUser):
    """One-shot simulation: simulated sensor reading -> full prediction pipeline."""
    material = body.material or OBJECTS[body.object_id].default_material
    reading = ctx.simulator.read(material, body.object_id, _environment(body), body.seed, source_detail=body.source_detail or "simulator")
    context = PredictionContext(
        data_source=DataSource.SIMULATED,
        source_detail=reading.source_detail,
        object_id=body.object_id,
        ground_truth=material,
        meta={"environment": {k: v for k, v in reading.provenance.items() if k.startswith("env_")}},
    )
    result = ctx.pipeline.run(reading.features, context)
    out = respond(result, db, user, body.persist)
    out["reading"] = reading.to_dict()
    return out


@router.post("/experiments/sweep")
def sweep(body: SweepRequest, ctx: Ctx, user: CurrentUser):
    """Sensitivity analysis: vary one feature while holding the others fixed.

    Every point is a real pipeline run (nothing is interpolated or cached)."""
    spec = FEATURE_SPECS[body.feature]
    if spec.log_scale:
        lo, hi = max(body.start, 1e-15), max(body.stop, 1e-15)
        values = np.logspace(np.log10(lo), np.log10(hi), body.steps)
    else:
        values = np.linspace(body.start, body.stop, body.steps)
    base = body.features.raw()
    raws = [{**base, body.feature: float(v)} for v in values]
    context = PredictionContext(DataSource.SIMULATED, source_detail="experiment_sweep", object_id=body.object_id)
    items = ctx.pipeline.run_batch(raws, context)
    points = []
    for v, item in zip(values, items):
        if item.result is None:
            points.append({"value": float(v), "valid": False, "errors": [e.to_dict() for e in item.errors]})
            continue
        r = item.result
        points.append(
            {
                "value": float(v),
                "valid": True,
                "material": r.material,
                "display_label": r.display_label,
                "confidence": round(r.confidence, 4),
                "probabilities": {k: round(p, 4) for k, p in r.probabilities.items()},
                "grip_percent": r.grip.grip_percent,
                "safety_status": r.grip.safety_status,
            }
        )
    return {"feature": body.feature, "unit": spec.unit, "log_scale": spec.log_scale, "points": points}
