"""Live sensor ingestion (REST + WebSocket), status, polling fallback, simulated stream."""

from __future__ import annotations

import asyncio
import contextlib
import json
import time
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, WebSocket, WebSocketDisconnect, status
from pydantic import ValidationError

from app.api.deps import DB, Ctx, CurrentUser, device_or_user, user_from_token
from app.core.security import constant_time_equals
from app.domain.materials import DataSource, normalize_material
from app.schemas.api import LivePredictRequest, LiveSampleIn, SensorDataRequest, StreamStartRequest
from app.sensors.live import EXTERNAL_DEVICE
from app.services.accounts import get_system_settings
from app.services.history import record_prediction
from app.services.pipeline import PredictionContext

router = APIRouter(prefix="/api/sensors", tags=["live sensors"])
ws_router = APIRouter(tags=["live sensors"])


def _source_label(simulated: bool) -> str:
    return f"{EXTERNAL_DEVICE} (self-declared SIMULATED)" if simulated else EXTERNAL_DEVICE


@router.post("/data")
async def ingest_data(body: SensorDataRequest, ctx: Ctx, auth: Annotated[tuple, Depends(device_or_user)]):
    """Entry point for external hardware (ESP32/Arduino bridges) or scripts.

    Authenticate with ``X-Device-Key`` (devices) or a user Bearer token. Every sample is
    validated and run through the canonical pipeline, then broadcast on /ws/sensors.
    """
    kind, user = auth
    device_id = body.device_id if kind == "device" else f"user-{user.id}:{body.device_id}"
    accepted = []
    for s in body.samples:
        sample = await ctx.live.ingest(
            s.raw(),
            _source_label(body.simulated),
            device_id,
            timestamp=s.timestamp,
            ground_truth=normalize_material(s.ground_truth) if s.ground_truth else None,
        )
        accepted.append({"seq": sample.seq, "prediction": sample.prediction, "errors": sample.errors})
    return {"accepted": len(accepted), "results": accepted, "status": ctx.live.status()}


@router.get("/live-status")
def live_status(ctx: Ctx, user: CurrentUser):
    return ctx.live.status()


@router.get("/latest")
def latest(ctx: Ctx, user: CurrentUser, since: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=500)):
    """REST polling fallback for clients that cannot use WebSockets."""
    samples = ctx.live_provider.since(since, limit)
    return {"samples": [s.to_dict() for s in samples], "status": ctx.live.status()}


@router.post("/stream/start")
async def stream_start(body: StreamStartRequest, ctx: Ctx, db: DB, user: CurrentUser):
    rate = body.rate_hz or float(get_system_settings(db)["live_stream_rate_hz"])
    state = await ctx.live.start_simulated_stream(rate, body.dwell_s)
    return {"stream": state, "label": "SIMULATED LIVE STREAM (not physical hardware)"}


@router.post("/stream/stop")
async def stream_stop(ctx: Ctx, user: CurrentUser):
    return {"stream": await ctx.live.stop_simulated_stream()}


@router.post("/live/{seq}/predict")
def predict_live_sample(seq: int, body: LivePredictRequest, ctx: Ctx, db: DB, user: CurrentUser):
    """Run one specific buffered live sample through the pipeline (and save it).

    Used by the Virtual Lab's LIVE SENSOR mode so the grasp uses the exact live
    reading, resolved server-side by sequence number."""
    sample = ctx.live_provider.get(seq)
    if sample is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Live sample {seq} is no longer in the buffer")
    reading = sample.reading
    context = PredictionContext(
        data_source=DataSource.LIVE,
        source_detail=reading.source_detail,
        object_id=body.object_id,
        ground_truth=reading.ground_truth,
        meta={"seq": seq, "device_id": sample.device_id, "received_at": sample.received_at.isoformat()},
    )
    result = ctx.pipeline.run(reading.features, context)
    out = result.to_dict()
    out["id"], out["persisted"] = None, False
    if body.persist:
        row = record_prediction(db, result, user.id)
        out["id"], out["persisted"] = row.id, True
    out["live_sample"] = sample.to_dict()
    return out


@ws_router.websocket("/ws/sensors")
async def sensors_ws(websocket: WebSocket, token: str | None = None, device_key: str | None = None):
    """Bidirectional live channel.

    * Users connect with ``?token=<JWT>`` and receive ``status`` and ``sample`` messages.
    * Devices connect with ``?device_key=<key>`` and may also *send*
      ``{"type": "sample", "device_id": "...", "data": {...features}}``.
    * Any client may send ``{"type": "ping", "t": <client ms>}`` to measure latency.
    """
    ctx = websocket.app.state.ctx
    role = None
    if device_key is not None and constant_time_equals(device_key, ctx.settings.sensor_device_key):
        role = "device"
    elif token is not None:
        db = ctx.db.SessionLocal()
        try:
            if user_from_token(token, ctx, db) is not None:
                role = "user"
        finally:
            db.close()
    if role is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION, reason="authentication required")
        return

    await websocket.accept()
    queue = ctx.live.subscribe()

    async def sender() -> None:
        await websocket.send_json({"type": "status", **ctx.live.status()})
        for s in ctx.live_provider.since(0, 60):
            await websocket.send_json({"type": "sample", "replay": True, **s.to_dict()})
        last_status = time.monotonic()
        while True:
            try:
                msg = await asyncio.wait_for(queue.get(), timeout=1.0)
                await websocket.send_json(msg)
            except asyncio.TimeoutError:
                pass
            if time.monotonic() - last_status >= 1.0:
                await websocket.send_json({"type": "status", **ctx.live.status()})
                last_status = time.monotonic()

    send_task = asyncio.create_task(sender())
    try:
        while True:
            text = await websocket.receive_text()
            if len(text) > 16_384:
                await websocket.send_json({"type": "error", "message": "message too large"})
                continue
            try:
                msg: Any = json.loads(text)
            except json.JSONDecodeError:
                await websocket.send_json({"type": "error", "message": "invalid JSON"})
                continue
            kind = msg.get("type") if isinstance(msg, dict) else None
            if kind == "ping":
                await websocket.send_json({"type": "pong", "t": msg.get("t"), "server_time": time.time() * 1000})
            elif kind == "sample" and role == "device":
                try:
                    sample_in = LiveSampleIn.model_validate(msg.get("data") or {})
                except ValidationError as exc:
                    await websocket.send_json({"type": "error", "message": str(exc)[:300]})
                    continue
                device_id = str(msg.get("device_id") or "ws-device")[:64]
                sample = await ctx.live.ingest(
                    sample_in.raw(),
                    _source_label(bool(msg.get("simulated"))),
                    device_id,
                    timestamp=sample_in.timestamp,
                    ground_truth=normalize_material(sample_in.ground_truth) if sample_in.ground_truth else None,
                )
                await websocket.send_json({"type": "ack", "seq": sample.seq, "errors": sample.errors})
            elif kind == "sample":
                await websocket.send_json({"type": "error", "message": "only devices may publish samples"})
    except WebSocketDisconnect:
        pass
    finally:
        send_task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await send_task
        ctx.live.unsubscribe(queue)
