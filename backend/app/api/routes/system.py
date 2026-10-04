"""Health check and static catalogues (objects, materials, features)."""

from __future__ import annotations

import time
from datetime import datetime, timezone

from fastapi import APIRouter
from sqlalchemy import text

from app import __version__
from app.api.deps import DB, Ctx
from app.domain.materials import (
    FEATURE_SPECS,
    FEATURES,
    HIGH_CONFIDENCE,
    MATERIAL_SPECS,
    MATERIALS,
    MODERATE_CONFIDENCE,
)
from app.domain.objects import DEFAULT_OBJECT_FOR_MATERIAL, OBJECTS

router = APIRouter(prefix="/api", tags=["system"])


@router.get("/health")
def health(ctx: Ctx, db: DB):
    db_ok = True
    db_error = None
    try:
        db.execute(text("SELECT 1"))
    except Exception as exc:  # pragma: no cover - only on DB outage
        db_ok, db_error = False, str(exc)[:200]
    reg = ctx.registry
    status = "ok" if db_ok and reg.ready else "degraded"
    return {
        "status": status,
        "app": ctx.settings.app_name,
        "version": __version__,
        "environment": ctx.settings.environment,
        "time": datetime.now(timezone.utc).isoformat(),
        "uptime_s": round(time.time() - ctx.started_at, 1),
        "database": {"ok": db_ok, "backend": ctx.db.backend, "error": db_error},
        "model": {
            "ready": reg.ready,
            "training": reg.training,
            "version": reg.metadata["version"] if reg.ready else None,
            "error": reg.last_error,
        },
        "live": {"connected": ctx.live.status()["connected"], "stream_running": ctx.live.stream_running},
    }


@router.get("/objects")
def objects():
    return {
        "objects": [o.to_dict() for o in OBJECTS.values()],
        "default_object_for_material": DEFAULT_OBJECT_FOR_MATERIAL,
    }


@router.get("/materials")
def materials():
    return {
        "materials": [
            {
                "name": m,
                "base_grip": MATERIAL_SPECS[m].base_grip,
                "fragility_points": MATERIAL_SPECS[m].fragility_points,
                "grip_mode": MATERIAL_SPECS[m].grip_mode,
                "grip_mode_label": MATERIAL_SPECS[m].grip_mode_label,
                "compliance": MATERIAL_SPECS[m].compliance,
                "description": MATERIAL_SPECS[m].description,
                "appearance": MATERIAL_SPECS[m].appearance,
            }
            for m in MATERIALS
        ],
        "confidence_thresholds": {"high": HIGH_CONFIDENCE, "moderate": MODERATE_CONFIDENCE},
        "grip_note": "Grip values are normalised simulation percentages (0-100 %), not physical forces in newtons.",
    }


@router.get("/features")
def features():
    return {
        "features": [
            {
                "name": f,
                "label": FEATURE_SPECS[f].label,
                "unit": FEATURE_SPECS[f].unit,
                "description": FEATURE_SPECS[f].description,
                "hard_min": FEATURE_SPECS[f].hard_min,
                "hard_max": FEATURE_SPECS[f].hard_max,
                "log_scale": FEATURE_SPECS[f].log_scale,
            }
            for f in FEATURES
        ]
    }
