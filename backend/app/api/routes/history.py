from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.responses import Response

from app.api.deps import DB, Ctx, CurrentUser
from app.db.models import PredictionHistory
from app.services.analytics import compute_metrics
from app.services.history import build_query, count, export_rows, history_to_dict

router = APIRouter(prefix="/api", tags=["history & analytics"])


def _filters(
    source: str | None,
    material: str | None,
    confidence_level: str | None,
    safety: str | None,
    q: str | None,
    date_from: datetime | None,
    date_to: datetime | None,
    all_users: bool,
) -> dict:
    return dict(
        source=source,
        material=material,
        confidence_level=confidence_level,
        safety=safety,
        q=q,
        date_from=date_from,
        date_to=date_to,
        all_users=all_users,
    )


@router.get("/history")
def list_history(
    db: DB,
    user: CurrentUser,
    source: Literal["SIMULATED", "UPLOADED", "LIVE"] | None = None,
    material: str | None = Query(None, max_length=16),
    confidence_level: Literal["HIGH", "MODERATE", "LOW"] | None = None,
    safety: Literal["NOMINAL", "CAUTION", "WARNING"] | None = None,
    q: str | None = Query(None, max_length=64),
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    all_users: bool = False,
    offset: int = Query(0, ge=0),
    limit: int = Query(25, ge=1, le=200),
):
    stmt = build_query(user, **_filters(source, material, confidence_level, safety, q, date_from, date_to, all_users))
    total = count(db, stmt)
    rows = db.scalars(stmt.order_by(PredictionHistory.created_at.desc(), PredictionHistory.id.desc()).offset(offset).limit(limit)).all()
    return {"total": total, "offset": offset, "limit": limit, "items": [history_to_dict(r, include_detail=False) for r in rows]}


@router.get("/history/export")
def export_history(
    db: DB,
    user: CurrentUser,
    format: Literal["csv", "json"] = "csv",
    source: Literal["SIMULATED", "UPLOADED", "LIVE"] | None = None,
    material: str | None = Query(None, max_length=16),
    confidence_level: Literal["HIGH", "MODERATE", "LOW"] | None = None,
    safety: Literal["NOMINAL", "CAUTION", "WARNING"] | None = None,
    q: str | None = Query(None, max_length=64),
    date_from: datetime | None = None,
    date_to: datetime | None = None,
    all_users: bool = False,
    limit: int = Query(10000, ge=1, le=50000),
):
    stmt = build_query(user, **_filters(source, material, confidence_level, safety, q, date_from, date_to, all_users))
    rows = db.scalars(stmt.order_by(PredictionHistory.created_at.desc()).limit(limit)).all()
    body, media = export_rows(list(rows), format)
    return Response(body, media_type=media, headers={"Content-Disposition": f'attachment; filename="neurogrip_history.{format}"'})


@router.get("/history/{item_id}")
def get_history(item_id: int, db: DB, user: CurrentUser):
    row = db.get(PredictionHistory, item_id)
    if row is None or (row.user_id != user.id and user.role != "ADMIN"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Prediction not found")
    return history_to_dict(row)


@router.delete("/history/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_history(item_id: int, db: DB, user: CurrentUser):
    row = db.get(PredictionHistory, item_id)
    if row is None or (row.user_id != user.id and user.role != "ADMIN"):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Prediction not found")
    db.delete(row)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/metrics")
def metrics(ctx: Ctx, db: DB, user: CurrentUser, scope: Literal["me", "all"] = "me", days: int = Query(14, ge=1, le=365)):
    if scope == "all" and user.role != "ADMIN":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only administrators can view global analytics")
    data = compute_metrics(db, None if scope == "all" else user.id, days)
    reg = ctx.registry
    if reg.ready:
        meta = reg.metadata
        data["model"] = {
            "version": meta["version"],
            "metrics": meta["metrics"],
            "confusion_matrix": meta["confusion_matrix"],
            "per_class": meta["per_class"],
            "confidence_bands": meta["confidence_bands"],
            "feature_importances": meta["feature_importances"],
        }
    data["scope"] = scope
    return data
