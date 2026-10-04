"""Live sensor hub.

Receives readings from external devices (REST or WebSocket) or from the built-in
SIMULATED LIVE STREAM, runs each one through the canonical prediction pipeline
(without persisting - live telemetry is high-rate) and broadcasts it to all
connected WebSocket subscribers. A REST polling fallback reads the same buffer.

The simulated stream is clearly labelled ``SIMULATED_LIVE_STREAM`` and uses the
exact same ingestion path as a real device would.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from datetime import datetime, timezone
from typing import Any

import numpy as np
from starlette.concurrency import run_in_threadpool

from app.domain.materials import DataSource
from app.ml.registry import ModelNotReadyError
from app.sensors.physics import Environment
from app.sensors.providers import LiveSample, LiveSensorProvider, SimulatedSensorProvider
from app.services.pipeline import PredictionContext, PredictionPipeline, SampleValidationError

log = logging.getLogger(__name__)

SIMULATED_STREAM = "SIMULATED_LIVE_STREAM"
EXTERNAL_DEVICE = "EXTERNAL_DEVICE"
CONTACT_THRESHOLD_KPA = 5.0

# Touch sequence of the simulated stream: (object, material) pairs.
STREAM_SEQUENCE: list[tuple[str, str]] = [
    ("glass", "Glass"),
    ("steel", "Steel"),
    ("container", "Plastic"),
    ("cube", "Wood"),
    ("ball", "Rubber"),
    ("ball", "Fabric"),
    ("bottle", "Plastic"),
]


def compact_prediction(result_dict: dict[str, Any]) -> dict[str, Any]:
    p, g = result_dict["prediction"], result_dict["grip"]
    return {
        "material": p["material"],
        "display_label": p["display_label"],
        "is_uncertain": p["is_uncertain"],
        "confidence": p["confidence"],
        "confidence_level": p["confidence_level"],
        "probabilities": p["probabilities"],
        "grip_percent": g["grip_percent"],
        "grip_mode": g["grip_mode"],
        "grip_mode_label": g["grip_mode_label"],
        "safety_status": g["safety_status"],
        "object_id": g["object_id"],
        "correct": result_dict["correct"],
        "latency_ms": result_dict["latency_ms"],
        "model_version": result_dict["model_version"],
    }


class LiveSensorHub:
    def __init__(
        self,
        provider: LiveSensorProvider,
        pipeline: PredictionPipeline,
        connected_timeout_s: float = 3.0,
        default_rate_hz: float = 4.0,
    ):
        self.provider = provider
        self.pipeline = pipeline
        self.connected_timeout_s = connected_timeout_s
        self.default_rate_hz = default_rate_hz
        self._subscribers: set[asyncio.Queue] = set()
        self._stream_task: asyncio.Task | None = None
        self._stream_state: dict[str, Any] = {"running": False}
        self._simulator = SimulatedSensorProvider()

    # --------------------------------------------------------------- ingest
    async def ingest(
        self,
        raw: dict[str, Any],
        source_detail: str,
        device_id: str,
        timestamp: datetime | None = None,
        ground_truth: str | None = None,
        object_id: str | None = None,
    ) -> LiveSample:
        sample = self.provider.push(raw, source_detail, device_id, timestamp, ground_truth)
        pressure = raw.get("pressure")
        in_contact = not (isinstance(pressure, (int, float)) and pressure < CONTACT_THRESHOLD_KPA)
        if not in_contact:
            sample.errors = [{"feature": "pressure", "code": "no_contact", "message": "No contact detected (pressure below 5 kPa)"}]
        else:
            ctx = PredictionContext(
                data_source=DataSource.LIVE,
                source_detail=source_detail,
                object_id=object_id,
                ground_truth=ground_truth,
                meta={"seq": sample.seq, "device_id": device_id},
            )
            try:
                result = await run_in_threadpool(self.pipeline.run, raw, ctx)
                sample.prediction = compact_prediction(result.to_dict())
            except SampleValidationError as exc:
                sample.errors = [e.to_dict() for e in exc.errors]
            except ModelNotReadyError:
                sample.errors = [{"feature": None, "code": "model_not_ready", "message": "Model is not loaded"}]
        await self.broadcast({"type": "sample", **sample.to_dict()})
        return sample

    # ------------------------------------------------------------ pub / sub
    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=200)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subscribers.discard(q)

    async def broadcast(self, message: dict[str, Any]) -> None:
        for q in list(self._subscribers):
            if q.full():
                with contextlib.suppress(asyncio.QueueEmpty):
                    q.get_nowait()  # drop oldest for slow consumers
            q.put_nowait(message)

    # --------------------------------------------------------------- status
    def status(self) -> dict[str, Any]:
        latest = self.provider.latest()
        now = datetime.now(timezone.utc)
        window = 5.0
        recent = self.provider.recent(window)
        if len(recent) >= 2:
            span = (recent[-1].received_at - recent[0].received_at).total_seconds()
            rate = (len(recent) - 1) / span if span > 0 else 0.0
        else:
            rate = 0.0
        age = (now - latest.received_at).total_seconds() if latest else None
        connected = age is not None and age <= self.connected_timeout_s
        source = latest.reading.source_detail if latest else None
        return {
            "connected": connected,
            "state": "CONNECTED" if connected else ("STALE" if latest else "NO_DATA"),
            "source": source if connected else None,
            "last_source": source,
            "is_simulated": bool(source and ("SIMULATED" in source)),
            "device_id": latest.device_id if latest else None,
            "rate_hz": round(rate, 2) if connected else 0.0,
            "last_update": latest.received_at.isoformat() if latest else None,
            "seconds_since_last": round(age, 2) if age is not None else None,
            "samples_received": self.provider.samples_received,
            "last_seq": latest.seq if latest else 0,
            "subscribers": len(self._subscribers),
            "simulated_stream": dict(self._stream_state),
            "server_time": now.isoformat(),
        }

    # ------------------------------------------------------ simulated stream
    @property
    def stream_running(self) -> bool:
        return self._stream_task is not None and not self._stream_task.done()

    async def start_simulated_stream(self, rate_hz: float | None = None, dwell_s: float = 4.0) -> dict[str, Any]:
        await self.stop_simulated_stream()
        rate = float(rate_hz or self.default_rate_hz)
        rate = max(0.5, min(rate, 20.0))
        self._stream_state = {"running": True, "rate_hz": rate, "dwell_s": dwell_s, "device_id": "sim-stream-01"}
        self._stream_task = asyncio.create_task(self._run_stream(rate, dwell_s))
        return dict(self._stream_state)

    async def stop_simulated_stream(self) -> dict[str, Any]:
        task = self._stream_task
        self._stream_task = None
        if task is not None and not task.done():
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
        self._stream_state = {"running": False}
        return dict(self._stream_state)

    async def _run_stream(self, rate: float, dwell_s: float) -> None:
        period = 1.0 / rate
        rng = np.random.default_rng()
        step = 0
        started = time.monotonic()
        try:
            while True:
                elapsed = time.monotonic() - started
                cycle = dwell_s + 1.0  # dwell on an object, then ~1 s of no contact
                phase = elapsed % cycle
                obj_id, material = STREAM_SEQUENCE[int(elapsed // cycle) % len(STREAM_SEQUENCE)]
                in_contact = phase < dwell_s
                self._stream_state.update(
                    {"current_object": obj_id if in_contact else None, "current_material": material if in_contact else None}
                )
                if in_contact:
                    reading = self._simulator.read(material, obj_id, Environment(), source_detail=SIMULATED_STREAM)
                    raw = reading.features
                    truth = material
                else:
                    raw = {
                        "pressure": round(float(abs(rng.normal(0.8, 0.4))), 2),
                        "temperature": round(float(rng.normal(33.0, 0.2)), 2),
                        "vibration": round(float(abs(rng.normal(3.0, 1.5))), 1),
                        "conductivity": float(f"{10 ** rng.normal(-12, 0.2):.4g}"),
                        "contact_duration": 0.0,
                    }
                    truth = None
                await self.ingest(raw, SIMULATED_STREAM, "sim-stream-01", ground_truth=truth, object_id=obj_id if in_contact else None)
                step += 1
                await asyncio.sleep(period)
        except asyncio.CancelledError:
            raise
        except Exception:  # pragma: no cover - defensive: never kill the loop silently
            log.exception("Simulated live stream crashed")
            self._stream_state = {"running": False, "error": "stream crashed - see server log"}

    async def shutdown(self) -> None:
        await self.stop_simulated_stream()
