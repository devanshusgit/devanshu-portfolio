"""Data-driven analytics computed from stored prediction history (nothing synthetic)."""

from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import PredictionHistory
from app.domain.materials import MATERIALS

MAX_ROWS = 50_000


def compute_metrics(db: Session, user_id: int | None, days: int = 30) -> dict[str, Any]:
    cols = (
        PredictionHistory.created_at,
        PredictionHistory.data_source,
        PredictionHistory.predicted_material,
        PredictionHistory.is_uncertain,
        PredictionHistory.confidence,
        PredictionHistory.confidence_level,
        PredictionHistory.grip_percent,
        PredictionHistory.safety_status,
        PredictionHistory.ground_truth,
        PredictionHistory.is_correct,
        PredictionHistory.latency_ms,
    )
    stmt = select(*cols).order_by(PredictionHistory.created_at.desc()).limit(MAX_ROWS)
    if user_id is not None:
        stmt = stmt.where(PredictionHistory.user_id == user_id)
    rows = db.execute(stmt).all()
    total = len(rows)

    materials = Counter()
    sources = Counter()
    safety = Counter()
    levels = Counter()
    conf_hist = [0] * 10
    grip_hist = [0] * 10
    grip_by_material: dict[str, list[float]] = defaultdict(list)
    conf_by_material: dict[str, list[float]] = defaultdict(list)
    latencies: list[float] = []
    timeline: Counter = Counter()
    labeled = 0
    correct = 0
    confusion: dict[str, Counter] = defaultdict(Counter)

    since = datetime.now(timezone.utc) - timedelta(days=days)
    for r in rows:
        label = "Uncertain" if r.is_uncertain else r.predicted_material
        materials[label] += 1
        sources[r.data_source] += 1
        safety[r.safety_status] += 1
        levels[r.confidence_level] += 1
        conf_hist[min(int(r.confidence * 10), 9)] += 1
        grip_hist[min(int(r.grip_percent / 10), 9)] += 1
        grip_by_material[r.predicted_material].append(r.grip_percent)
        conf_by_material[r.predicted_material].append(r.confidence)
        latencies.append(r.latency_ms)
        created = r.created_at if r.created_at.tzinfo else r.created_at.replace(tzinfo=timezone.utc)
        if created >= since:
            timeline[(created.date().isoformat(), r.data_source)] += 1
        if r.ground_truth is not None:
            labeled += 1
            correct += int(bool(r.is_correct))
            confusion[r.ground_truth][r.predicted_material] += 1

    days_list = [(datetime.now(timezone.utc) - timedelta(days=i)).date().isoformat() for i in range(days - 1, -1, -1)]
    timeline_out = [
        {"date": d, **{s: timeline.get((d, s), 0) for s in ("SIMULATED", "UPLOADED", "LIVE")}} for d in days_list
    ]
    latencies.sort()

    def pct(p: float) -> float | None:
        if not latencies:
            return None
        return round(latencies[min(len(latencies) - 1, int(p * len(latencies)))], 3)

    return {
        "total_predictions": total,
        "material_distribution": [{"material": m, "count": materials.get(m, 0)} for m in (*MATERIALS, "Uncertain")],
        "source_distribution": [{"source": s, "count": sources.get(s, 0)} for s in ("SIMULATED", "UPLOADED", "LIVE")],
        "safety_distribution": [{"status": s, "count": safety.get(s, 0)} for s in ("NOMINAL", "CAUTION", "WARNING")],
        "confidence_levels": [{"level": lv, "count": levels.get(lv, 0)} for lv in ("HIGH", "MODERATE", "LOW")],
        "confidence_histogram": [
            {"bucket": f"{i * 10}-{i * 10 + 10}%", "low": i / 10, "count": c} for i, c in enumerate(conf_hist)
        ],
        "grip_histogram": [{"bucket": f"{i * 10}-{i * 10 + 10}%", "count": c} for i, c in enumerate(grip_hist)],
        "grip_by_material": [
            {
                "material": m,
                "count": len(grip_by_material.get(m, [])),
                "mean_grip": round(sum(grip_by_material[m]) / len(grip_by_material[m]), 2) if grip_by_material.get(m) else None,
                "min_grip": round(min(grip_by_material[m]), 2) if grip_by_material.get(m) else None,
                "max_grip": round(max(grip_by_material[m]), 2) if grip_by_material.get(m) else None,
                "mean_confidence": round(sum(conf_by_material[m]) / len(conf_by_material[m]), 4) if conf_by_material.get(m) else None,
            }
            for m in MATERIALS
        ],
        "timeline": timeline_out,
        "latency_ms": {"p50": pct(0.5), "p95": pct(0.95), "max": round(latencies[-1], 3) if latencies else None},
        "labeled_evaluation": {
            "labeled_predictions": labeled,
            "correct": correct,
            "accuracy": round(correct / labeled, 4) if labeled else None,
            "confusion_matrix": {
                "labels": list(MATERIALS),
                "matrix": [[confusion[t].get(p, 0) for p in MATERIALS] for t in MATERIALS],
            },
        },
    }
