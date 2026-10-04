"""External data: upload, schema mapping, row preview, single-row simulation, batch."""

from __future__ import annotations

import csv
import io
import json
import time
from collections import Counter
from typing import Any, Literal

import numpy as np
from fastapi import APIRouter, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from sklearn.metrics import confusion_matrix, precision_recall_fscore_support
from sqlalchemy import select

from app.api.deps import DB, Ctx, CurrentUser
from app.db.models import Dataset
from app.domain.materials import FEATURES, MATERIALS, DataSource
from app.domain.objects import OBJECTS
from app.ingest.parser import (
    UploadError,
    apply_manual_mapping,
    detect_mapping,
    parse_upload,
    resolve_row,
    row_view,
    safe_csv_cell,
    summarize,
)
from app.ml.dataset import round_readings
from app.schemas.api import BatchRequest, MappingUpdate, RowSimulateRequest
from app.sensors.physics import Environment, generate_readings
from app.sensors.providers import FileSensorProvider
from app.services.accounts import get_system_settings
from app.services.history import record_prediction
from app.services.pipeline import PredictionContext

router = APIRouter(prefix="/api", tags=["external data"])

PREVIEW_ROWS = 25


def _ranges(ctx) -> dict | None:
    return ctx.registry.metadata.get("feature_ranges") if ctx.registry.ready else None


def _get_dataset(db, user, dataset_id: int) -> Dataset:
    ds = db.get(Dataset, dataset_id)
    if ds is None or (ds.user_id != user.id and user.role != "ADMIN"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Dataset not found")
    return ds


def dataset_dict(ds: Dataset, ctx, include_preview: bool = True) -> dict[str, Any]:
    out = {
        "id": ds.id,
        "name": ds.name,
        "format": ds.file_format,
        "size_bytes": ds.size_bytes,
        "row_count": ds.row_count,
        "columns": ds.columns,
        "mapping": ds.mapping,
        "summary": ds.summary,
        "parse_notes": ds.parse_notes,
        "created_at": ds.created_at.isoformat() if ds.created_at else None,
    }
    if include_preview:
        ranges = _ranges(ctx)
        out["preview"] = [row_view(r, ds.mapping, i, ranges) for i, r in enumerate(ds.rows[:PREVIEW_ROWS])]
    return out


async def _read_limited(file: UploadFile, max_bytes: int) -> bytes:
    chunks, total = [], 0
    while True:
        chunk = await file.read(256 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise UploadError(f"File exceeds the {max_bytes / 1048576:.1f} MB upload limit", "file_too_large")
        chunks.append(chunk)
    return b"".join(chunks)


@router.post("/upload", status_code=status.HTTP_201_CREATED)
async def upload(ctx: Ctx, db: DB, user: CurrentUser, file: UploadFile = File(...)):
    """Upload a CSV or JSON dataset. The file is parsed as inert data, validated,
    schema-mapped and stored; it is never executed."""
    sys_limit = float(get_system_settings(db)["max_upload_mb"]) * 1024 * 1024
    max_bytes = int(min(ctx.settings.max_upload_bytes, sys_limit))
    content = await _read_limited(file, max_bytes)
    table = parse_upload(file.filename or "", content, max_bytes, ctx.settings.max_upload_rows)
    mapping = detect_mapping(table.columns)
    summary = summarize(table.rows, mapping, _ranges(ctx))
    ds = Dataset(
        user_id=user.id,
        name=(file.filename or "dataset")[:255],
        file_format=table.file_format,
        size_bytes=len(content),
        row_count=len(table.rows),
        columns=table.columns,
        mapping=mapping,
        summary=summary,
        parse_notes=table.notes,
        rows=table.rows,
    )
    db.add(ds)
    db.commit()
    db.refresh(ds)
    return dataset_dict(ds, ctx)


@router.get("/datasets")
def list_datasets(ctx: Ctx, db: DB, user: CurrentUser):
    rows = db.scalars(select(Dataset).where(Dataset.user_id == user.id).order_by(Dataset.created_at.desc())).all()
    return {"datasets": [dataset_dict(d, ctx, include_preview=False) for d in rows]}


@router.get("/datasets/{dataset_id}")
def get_dataset(dataset_id: int, ctx: Ctx, db: DB, user: CurrentUser):
    return dataset_dict(_get_dataset(db, user, dataset_id), ctx)


@router.get("/datasets/{dataset_id}/rows")
def get_rows(
    dataset_id: int,
    ctx: Ctx,
    db: DB,
    user: CurrentUser,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    status_filter: Literal["all", "valid", "warning", "invalid"] = Query("all", alias="status"),
):
    ds = _get_dataset(db, user, dataset_id)
    ranges = _ranges(ctx)
    if status_filter == "all":
        views = [row_view(ds.rows[i], ds.mapping, i, ranges) for i in range(offset, min(offset + limit, ds.row_count))]
        total = ds.row_count
    else:
        all_views = [row_view(r, ds.mapping, i, ranges) for i, r in enumerate(ds.rows)]
        matching = [v for v in all_views if v["status"] == status_filter]
        total = len(matching)
        views = matching[offset : offset + limit]
    return {"dataset_id": ds.id, "offset": offset, "limit": limit, "total": total, "rows": views}


@router.put("/datasets/{dataset_id}/mapping")
def update_mapping(dataset_id: int, body: MappingUpdate, ctx: Ctx, db: DB, user: CurrentUser):
    ds = _get_dataset(db, user, dataset_id)
    update = body.model_dump(exclude_unset=True)
    if body.clear_label:
        update["label_column"] = None
    if body.clear_id:
        update["id_column"] = None
    mapping = apply_manual_mapping(ds.columns, ds.mapping, update)
    ds.mapping = mapping
    ds.summary = summarize(ds.rows, mapping, _ranges(ctx))
    db.commit()
    return dataset_dict(ds, ctx)


@router.post("/datasets/{dataset_id}/remap")
def reset_mapping(dataset_id: int, ctx: Ctx, db: DB, user: CurrentUser):
    ds = _get_dataset(db, user, dataset_id)
    ds.mapping = detect_mapping(ds.columns)
    ds.summary = summarize(ds.rows, ds.mapping, _ranges(ctx))
    db.commit()
    return dataset_dict(ds, ctx)


@router.delete("/datasets/{dataset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_dataset(dataset_id: int, db: DB, user: CurrentUser):
    ds = _get_dataset(db, user, dataset_id)
    db.delete(ds)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/datasets/{dataset_id}/rows/{row_index}/simulate")
def simulate_row(dataset_id: int, row_index: int, body: RowSimulateRequest, ctx: Ctx, db: DB, user: CurrentUser):
    """SIMULATE THIS SAMPLE: the exact stored row is resolved server-side through the
    column mapping and sent through the canonical pipeline."""
    ds = _get_dataset(db, user, dataset_id)
    provider = FileSensorProvider(ds.id, ds.name, ds.rows, ds.mapping)
    try:
        reading = provider.read(row_index)
    except IndexError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from None
    context = PredictionContext(
        data_source=DataSource.UPLOADED,
        source_detail=body.source_detail or "data_studio",
        object_id=body.object_id,
        ground_truth=reading.ground_truth,
        dataset_id=ds.id,
        row_index=row_index,
        row_id=reading.provenance["row_id"],
        meta={"dataset_name": ds.name, "conversions": reading.provenance["conversions"]},
    )
    result = ctx.pipeline.run(reading.features, context)
    out = result.to_dict()
    out["id"], out["persisted"] = None, False
    if body.persist:
        row = record_prediction(db, result, user.id)
        out["id"], out["persisted"] = row.id, True
    out["reading"] = reading.to_dict()
    out["row"] = row_view(ds.rows[row_index], ds.mapping, row_index, _ranges(ctx))
    return out


def _evaluate(truth: list[str], pred: list[str], uncertain: list[bool]) -> dict[str, Any]:
    labels = list(MATERIALS)
    p, r, f1, support = precision_recall_fscore_support(truth, pred, labels=labels, zero_division=0)
    present = [i for i, s in enumerate(support) if s > 0]
    t, pr, unc = np.array(truth), np.array(pred), np.array(uncertain)
    confident = ~unc
    return {
        "labeled_rows": len(truth),
        "accuracy": float((t == pr).mean()),
        "precision_macro": float(np.mean([p[i] for i in present])) if present else None,
        "recall_macro": float(np.mean([r[i] for i in present])) if present else None,
        "f1_macro": float(np.mean([f1[i] for i in present])) if present else None,
        "uncertain_rows": int(unc.sum()),
        "coverage": float(confident.mean()),
        "accuracy_when_confident": float((t[confident] == pr[confident]).mean()) if confident.any() else None,
        "per_class": {
            labels[i]: {"precision": float(p[i]), "recall": float(r[i]), "f1": float(f1[i]), "support": int(support[i])}
            for i in range(len(labels))
        },
        "confusion_matrix": {"labels": labels, "matrix": confusion_matrix(truth, pred, labels=labels).tolist()},
        "note": "Metrics computed from the dataset's own ground-truth labels against the model's argmax prediction.",
    }


@router.post("/process-batch")
def process_batch(body: BatchRequest, ctx: Ctx, db: DB, user: CurrentUser):
    """Run a whole dataset (or inline rows) through the canonical pipeline."""
    started = time.perf_counter()
    if body.dataset_id is not None:
        ds = _get_dataset(db, user, body.dataset_id)
        rows, mapping, name, ds_id = ds.rows, ds.mapping, ds.name, ds.id
    elif body.rows:
        rows = body.rows
        columns = list(dict.fromkeys(k for r in rows for k in r))
        mapping, name, ds_id = detect_mapping(columns), "inline", None
    else:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Provide dataset_id or rows")

    end = len(rows) if body.limit is None else min(len(rows), body.offset + body.limit)
    indices = list(range(body.offset, end))
    resolved = [resolve_row(rows[i], mapping, i) for i in indices]
    contexts = [
        PredictionContext(
            data_source=DataSource.UPLOADED,
            source_detail="batch",
            object_id=body.object_id,
            ground_truth=r.label,
            dataset_id=ds_id,
            row_index=r.row_index,
            row_id=r.row_id,
            meta={"dataset_name": name},
        )
        for r in resolved
    ]
    items = ctx.pipeline.run_batch([r.features for r in resolved], contexts)

    results: list[dict[str, Any]] = []
    truth, pred, unc = [], [], []
    materials, levels, safety = Counter(), Counter(), Counter()
    confidences = []
    persisted = 0
    for r, item in zip(resolved, items):
        base = {"row_index": r.row_index, "row_id": r.row_id, "ground_truth": r.label}
        if item.result is None:
            results.append({**base, "status": "invalid", "errors": [e.to_dict() for e in item.errors]})
            continue
        res = item.result
        g = res.grip
        results.append(
            {
                **base,
                "status": "ok",
                "features": res.features,
                "predicted_material": res.material,
                "display_label": res.display_label,
                "is_uncertain": res.is_uncertain,
                "confidence": round(res.confidence, 4),
                "confidence_level": res.confidence_level,
                "probabilities": {k: round(v, 4) for k, v in res.probabilities.items()},
                "grip_percent": g.grip_percent,
                "grip_mode": g.grip_mode,
                "grip_mode_label": g.grip_mode_label,
                "grasp_type": g.grasp_type,
                "object_id": g.object_id,
                "safety_status": g.safety_status,
                "warnings": [w.code for w in g.warnings],
                "action": g.action,
                "correct": res.correct,
            }
        )
        materials[res.display_label] += 1
        levels[res.confidence_level] += 1
        safety[g.safety_status] += 1
        confidences.append(res.confidence)
        if res.ground_truth is not None:
            truth.append(res.ground_truth)
            pred.append(res.material)
            unc.append(res.is_uncertain)
        if body.persist:
            record_prediction(db, res, user.id, commit=False)
            persisted += 1
    if persisted:
        db.commit()

    ok = sum(1 for r in results if r["status"] == "ok")
    elapsed_ms = (time.perf_counter() - started) * 1000
    return {
        "dataset_id": ds_id,
        "dataset_name": name,
        "processed": len(results),
        "ok": ok,
        "invalid": len(results) - ok,
        "persisted": persisted,
        "elapsed_ms": round(elapsed_ms, 2),
        "per_row_ms": round(elapsed_ms / max(len(results), 1), 3),
        "model_version": ctx.registry.metadata["version"],
        "summary": {
            "materials": dict(materials),
            "confidence_levels": dict(levels),
            "safety": dict(safety),
            "mean_confidence": round(float(np.mean(confidences)), 4) if confidences else None,
        },
        "evaluation": _evaluate(truth, pred, unc) if truth else None,
        "results": results,
    }


@router.get("/dataset/template")
def dataset_template(
    format: Literal["csv", "json"] = "csv",
    rows: int = Query(24, ge=1, le=2000),
    labels: bool = True,
    seed: int = Query(2026, ge=0),
):
    """A ready-to-upload sample dataset generated by the SIMULATED sensor model."""
    rng = np.random.default_rng(seed)
    materials = [MATERIALS[i % len(MATERIALS)] for i in range(rows)]
    rng.shuffle(materials)
    values = round_readings(generate_readings(materials, rng, Environment()))
    records = []
    for i, m in enumerate(materials):
        rec: dict[str, Any] = {"row_id": i + 1}
        rec.update({f: float(values[f][i]) for f in FEATURES})
        if labels:
            rec["material"] = m
        records.append(rec)
    if format == "json":
        body = json.dumps({"description": "NeuroGrip sample - SIMULATED sensor data", "data": records}, indent=2)
        return Response(body, media_type="application/json", headers={"Content-Disposition": 'attachment; filename="neurogrip_sample.json"'})
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=list(records[0].keys()))
    writer.writeheader()
    for rec in records:
        writer.writerow({k: safe_csv_cell(v) for k, v in rec.items()})
    return Response(buf.getvalue(), media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="neurogrip_sample.csv"'})


@router.get("/objects/{object_id}")
def get_object(object_id: str):
    if object_id not in OBJECTS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown object")
    return OBJECTS[object_id].to_dict()
