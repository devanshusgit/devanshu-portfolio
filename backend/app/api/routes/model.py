"""ML model status, (re)training, classes and training-dataset information."""

from __future__ import annotations

import io

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import Response
from sqlalchemy import select
from starlette.concurrency import run_in_threadpool

from app.api.deps import DB, AdminUser, Ctx, CurrentUser
from app.db.models import ModelTrainingRun
from app.domain.materials import FEATURE_SPECS, FEATURES, MATERIAL_SPECS, MATERIALS
from app.ml.dataset import generate_dataset
from app.ml.registry import ModelBusyError
from app.schemas.api import TrainRequest
from app.sensors.physics import PHYSICS

router = APIRouter(prefix="/api", tags=["model"])

PUBLIC_KEYS = (
    "version", "model_type", "pipeline_steps", "params", "sklearn_version", "classes", "features", "feature_units",
    "trained_at", "training_duration_s", "dataset", "metrics", "per_class", "confusion_matrix", "cross_validation",
    "confidence_bands", "feature_importances", "typicality_thresholds", "typicality_test_flag_rate",
)


def record_run(db, meta: dict, triggered_by: str) -> None:
    db.add(
        ModelTrainingRun(
            model_version=meta["version"],
            triggered_by=triggered_by,
            n_samples=meta["dataset"]["n_samples"],
            seed=meta["dataset"]["seed"],
            test_size=meta["dataset"]["test_size"],
            accuracy=meta["metrics"]["accuracy"],
            f1_macro=meta["metrics"]["f1_macro"],
            duration_s=meta["training_duration_s"],
        )
    )
    db.commit()


@router.get("/model/status")
def model_status(ctx: Ctx):
    reg = ctx.registry
    if not reg.ready:
        return {"ready": False, "training": reg.training, "error": reg.last_error}
    meta = reg.metadata
    return {"ready": True, "training": reg.training, "error": reg.last_error, **{k: meta.get(k) for k in PUBLIC_KEYS}}


@router.post("/model/train")
async def train(body: TrainRequest, ctx: Ctx, db: DB, admin: AdminUser):
    """Genuinely re-runs dataset generation, training and evaluation (admin only)."""
    try:
        meta = await run_in_threadpool(ctx.registry.train, body.n_samples, body.seed, body.test_size)
    except ModelBusyError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from None
    record_run(db, meta, admin.email)
    return {"ready": True, **{k: meta.get(k) for k in PUBLIC_KEYS}}


@router.get("/model/runs")
def training_runs(db: DB, user: CurrentUser):
    runs = db.scalars(select(ModelTrainingRun).order_by(ModelTrainingRun.created_at.desc()).limit(50)).all()
    return {
        "runs": [
            {
                "id": r.id,
                "created_at": r.created_at.isoformat(),
                "model_version": r.model_version,
                "triggered_by": r.triggered_by,
                "n_samples": r.n_samples,
                "seed": r.seed,
                "test_size": r.test_size,
                "accuracy": r.accuracy,
                "f1_macro": r.f1_macro,
                "duration_s": r.duration_s,
            }
            for r in runs
        ]
    }


@router.get("/model/classes")
def model_classes(ctx: Ctx):
    classes = ctx.registry.metadata["classes"] if ctx.registry.ready else list(MATERIALS)
    return {
        "classes": classes,
        "materials": {
            m: {
                "base_grip": MATERIAL_SPECS[m].base_grip,
                "grip_mode": MATERIAL_SPECS[m].grip_mode_label,
                "description": MATERIAL_SPECS[m].description,
            }
            for m in classes
        },
    }


@router.get("/dataset/info")
def dataset_info(ctx: Ctx, user: CurrentUser):
    if not ctx.registry.ready:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Model not ready")
    meta = ctx.registry.metadata
    stats = meta["class_feature_stats"]
    return {
        "generator": meta["dataset"]["generator"],
        "simulated": True,
        "n_samples": meta["dataset"]["n_samples"],
        "seed": meta["dataset"]["seed"],
        "test_size": meta["dataset"]["test_size"],
        "train_size": meta["dataset"]["train_size"],
        "test_count": meta["dataset"]["test_count"],
        "class_counts": meta["dataset"]["class_counts"],
        "features": [
            {"name": f, "label": FEATURE_SPECS[f].label, "unit": FEATURE_SPECS[f].unit, "description": FEATURE_SPECS[f].description}
            for f in FEATURES
        ],
        "class_feature_ranges": {
            m: {f: {"median": stats[m][f]["raw_median"], "p05": stats[m][f]["raw_p05"], "p95": stats[m][f]["raw_p95"]} for f in FEATURES}
            for m in MATERIALS
        },
        "latent_physics": {
            m: {
                "youngs_modulus_gpa_median": p.modulus_gpa[0],
                "density_kg_m3": p.density[0],
                "thermal_effusivity_median": p.effusivity[0],
                "log10_conductivity_mean": p.log10_conductivity[0],
                "relaxation_time_s_median": p.relaxation_s[0],
                "surface_variant": p.variant_name,
            }
            for m, p in PHYSICS.items()
        },
    }


@router.get("/dataset/download")
def dataset_download(ctx: Ctx, user: CurrentUser):
    """Regenerates (deterministically, from the seed) the exact training dataset."""
    meta = ctx.registry.metadata if ctx.registry.ready else {"dataset": {"n_samples": 4800, "seed": 42}}
    df = generate_dataset(meta["dataset"]["n_samples"], meta["dataset"]["seed"])
    buf = io.StringIO()
    df.to_csv(buf, index=False)
    return Response(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="neurogrip_training_dataset.csv"'})
