"""Prediction history persistence, querying and export."""

from __future__ import annotations

import csv
import io
import json
from datetime import datetime
from typing import Any

from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session

from app.db.models import PredictionHistory, User
from app.domain.materials import FEATURES
from app.ingest.parser import safe_csv_cell
from app.services.pipeline import PipelineResult


def record_prediction(db: Session, result: PipelineResult, user_id: int | None, commit: bool = True) -> PredictionHistory:
    ctx = result.context
    grip = result.grip
    row = PredictionHistory(
        user_id=user_id,
        data_source=ctx.data_source.value,
        source_detail=(ctx.source_detail or "")[:64] or None,
        object_id=grip.object_id,
        **{f: float(result.features[f]) for f in FEATURES},
        predicted_material=result.material,
        is_uncertain=result.is_uncertain,
        confidence=float(result.confidence),
        confidence_level=result.confidence_level,
        probabilities={k: round(v, 5) for k, v in result.probabilities.items()},
        grip_percent=grip.grip_percent,
        grip_mode=grip.grip_mode,
        grasp_type=grip.grasp_type,
        safety_status=grip.safety_status,
        safety_warnings=[{"code": w.code, "severity": w.severity, "message": w.message} for w in grip.warnings],
        grip_breakdown={
            "base_grip": grip.base_grip,
            "sensor_adjustment": grip.sensor_adjustment,
            "sensor_breakdown": grip.sensor_breakdown,
            "fragility_protection": grip.fragility_protection,
            "confidence_adjustment": grip.confidence_adjustment,
            "raw_grip": grip.raw_grip,
            "structural_limit": grip.structural_limit,
            "action": grip.action,
            "explanation": grip.explanation,
        },
        ground_truth=result.ground_truth,
        is_correct=result.correct,
        dataset_id=ctx.dataset_id,
        row_ref=(f"{ctx.row_index}:{ctx.row_id}" if ctx.row_index is not None else None),
        model_version=result.model_version,
        latency_ms=round(result.latency_ms, 3),
        meta=ctx.meta or {},
    )
    db.add(row)
    if commit:
        db.commit()
        db.refresh(row)
    return row


def history_to_dict(row: PredictionHistory, include_detail: bool = True) -> dict[str, Any]:
    d: dict[str, Any] = {
        "id": row.id,
        "user_id": row.user_id,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "data_source": row.data_source,
        "source_detail": row.source_detail,
        "object_id": row.object_id,
        "features": {f: getattr(row, f) for f in FEATURES},
        "predicted_material": row.predicted_material,
        "display_label": "Uncertain" if row.is_uncertain else row.predicted_material,
        "is_uncertain": row.is_uncertain,
        "confidence": row.confidence,
        "confidence_level": row.confidence_level,
        "grip_percent": row.grip_percent,
        "grip_mode": row.grip_mode,
        "grasp_type": row.grasp_type,
        "safety_status": row.safety_status,
        "ground_truth": row.ground_truth,
        "is_correct": row.is_correct,
        "dataset_id": row.dataset_id,
        "row_ref": row.row_ref,
        "model_version": row.model_version,
        "latency_ms": row.latency_ms,
    }
    if include_detail:
        d.update(
            {
                "probabilities": row.probabilities,
                "safety_warnings": row.safety_warnings,
                "grip_breakdown": row.grip_breakdown,
                "meta": row.meta,
            }
        )
    return d


def build_query(
    user: User,
    *,
    all_users: bool = False,
    source: str | None = None,
    material: str | None = None,
    confidence_level: str | None = None,
    safety: str | None = None,
    q: str | None = None,
    date_from: datetime | None = None,
    date_to: datetime | None = None,
) -> Select:
    stmt = select(PredictionHistory)
    if not (all_users and user.role == "ADMIN"):
        stmt = stmt.where(PredictionHistory.user_id == user.id)
    if source:
        stmt = stmt.where(PredictionHistory.data_source == source.upper())
    if material:
        if material.lower() == "uncertain":
            stmt = stmt.where(PredictionHistory.is_uncertain.is_(True))
        else:
            stmt = stmt.where(PredictionHistory.predicted_material == material.capitalize())
    if confidence_level:
        stmt = stmt.where(PredictionHistory.confidence_level == confidence_level.upper())
    if safety:
        stmt = stmt.where(PredictionHistory.safety_status == safety.upper())
    if date_from:
        stmt = stmt.where(PredictionHistory.created_at >= date_from)
    if date_to:
        stmt = stmt.where(PredictionHistory.created_at <= date_to)
    if q:
        like = f"%{q.strip()[:64]}%"
        stmt = stmt.where(
            or_(
                PredictionHistory.predicted_material.ilike(like),
                PredictionHistory.source_detail.ilike(like),
                PredictionHistory.grip_mode.ilike(like),
                PredictionHistory.grasp_type.ilike(like),
                PredictionHistory.row_ref.ilike(like),
                PredictionHistory.object_id.ilike(like),
            )
        )
    return stmt


def count(db: Session, stmt: Select) -> int:
    return int(db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0)


EXPORT_COLUMNS = [
    "id", "created_at", "data_source", "source_detail", "object_id", *FEATURES,
    "predicted_material", "display_label", "confidence", "confidence_level", "grip_percent", "grip_mode",
    "grasp_type", "safety_status", "ground_truth", "is_correct", "dataset_id", "row_ref", "model_version",
]


def export_rows(rows: list[PredictionHistory], fmt: str) -> tuple[str, str]:
    dicts = [history_to_dict(r) for r in rows]
    if fmt == "json":
        return json.dumps(dicts, indent=2), "application/json"
    buf = io.StringIO()
    writer = csv.writer(buf)
    prob_columns = sorted(dicts[0]["probabilities"]) if dicts else []
    writer.writerow(EXPORT_COLUMNS + [f"p_{m}" for m in prob_columns])
    for d in dicts:
        flat = {**d, **d["features"]}
        values = [flat.get(c) for c in EXPORT_COLUMNS]
        values += [d["probabilities"].get(m) for m in prob_columns]
        writer.writerow([safe_csv_cell(v) for v in values])
    return buf.getvalue(), "text/csv"
