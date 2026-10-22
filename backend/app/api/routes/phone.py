"""Phone as a real sensor: the phone measures taps with its microphone and posts them here.

The laptop dashboard polls ``/api/phone/feed``. Everything goes through the database, so
it works across several server instances (no in-process state)."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import DB, Ctx, CurrentUser
from app.db.models import PhoneDevice, PhoneTap
from app.domain.materials import DataSource
from app.schemas.api import SensorFeaturesIn
from app.services.pipeline import PredictionContext

router = APIRouter(prefix="/api/phone", tags=["phone sensor"])

PHONE_SOURCE_DETAIL = "phone_sensor"
ONLINE_WINDOW_S = 6.0


class HeartbeatIn(BaseModel):
    device: str = Field(default="phone", max_length=64)
    level: float = Field(default=0.0, ge=0.0, le=1.0)  # current mic peak level 0..1
    listening: bool = True


class TapIn(BaseModel):
    device: str = Field(default="phone", max_length=64)
    features: SensorFeaturesIn
    # What the phone actually measured (Hz, ms, peak level, sample rate...) for transparency.
    measurements: dict[str, Any] = Field(default_factory=dict)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _tap_dict(t: PhoneTap) -> dict[str, Any]:
    return {
        "id": t.id,
        "created_at": _aware(t.created_at).isoformat(),
        "device": t.device,
        "features": t.features,
        "measurements": t.measurements,
        "prediction": t.prediction,
    }


@router.post("/heartbeat")
def heartbeat(body: HeartbeatIn, db: DB, user: CurrentUser):
    dev = db.get(PhoneDevice, user.id)
    if dev is None:
        dev = PhoneDevice(user_id=user.id)
        db.add(dev)
    dev.device = body.device
    dev.last_seen = _now()
    dev.live = {"level": round(body.level, 4), "listening": body.listening}
    db.commit()
    return {"ok": True}


@router.post("/taps")
def create_tap(body: TapIn, ctx: Ctx, db: DB, user: CurrentUser):
    """Classify one measured tap (not saved to history here) and store it for the dashboard."""
    context = PredictionContext(data_source=DataSource.LIVE, source_detail=PHONE_SOURCE_DETAIL)
    result = ctx.pipeline.run(body.features.raw(), context)  # invalid input -> 422 via handler
    summary = {
        "material": result.material,
        "display_label": result.display_label,
        "confidence": round(result.confidence, 4),
        "confidence_level": result.confidence_level,
        "grip_percent": result.grip.grip_percent,
        "safety_status": result.grip.safety_status,
    }
    tap = PhoneTap(
        user_id=user.id,
        device=body.device,
        features={k: float(v) for k, v in result.features.items()},
        measurements=body.measurements,
        prediction=summary,
    )
    db.add(tap)
    dev = db.get(PhoneDevice, user.id)
    if dev is None:
        dev = PhoneDevice(user_id=user.id, live={})
        db.add(dev)
    dev.device = body.device
    dev.last_seen = _now()
    db.commit()
    db.refresh(tap)
    return _tap_dict(tap)


@router.get("/feed")
def feed(db: DB, user: CurrentUser, after_id: int = Query(0, ge=0), limit: int = Query(20, ge=1, le=100)):
    """Newest taps for the signed-in user (id > after_id) plus the phone's live status."""
    q = select(PhoneTap).where(PhoneTap.user_id == user.id)
    if after_id:
        rows = db.scalars(q.where(PhoneTap.id > after_id).order_by(PhoneTap.id.asc()).limit(limit)).all()
    else:
        rows = list(reversed(db.scalars(q.order_by(PhoneTap.id.desc()).limit(limit)).all()))
    dev = db.get(PhoneDevice, user.id)
    age = (_now() - _aware(dev.last_seen)).total_seconds() if dev else None
    return {
        "taps": [_tap_dict(t) for t in rows],
        "device": {
            "online": age is not None and age <= ONLINE_WINDOW_S,
            "device": dev.device if dev else None,
            "last_seen_s": round(age, 1) if age is not None else None,
            "live": dev.live if dev else {},
        },
        "server_time": _now().isoformat(),
    }
