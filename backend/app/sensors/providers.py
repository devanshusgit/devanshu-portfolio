"""Sensor data provider abstraction.

    CURRENT:  SimulatedSensorProvider ─┐
              FileSensorProvider ──────┼──> PredictionPipeline -> GripEngine -> 3D hand
              LiveSensorProvider ──────┘
    FUTURE:   real sensor -> ESP32/Arduino -> LiveSensorProvider (unchanged) -> ...

Each provider only *produces readings*. None of them classify or decide anything,
so replacing the simulated source with real hardware does not touch the ML, grip
or 3D layers.
"""

from __future__ import annotations

import threading
from abc import ABC, abstractmethod
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import numpy as np

from app.domain.materials import FEATURES, MATERIALS, DataSource
from app.domain.objects import OBJECTS
from app.ml.dataset import round_readings
from app.sensors.physics import Environment, generate_readings, variant_name


@dataclass
class SensorReading:
    features: dict[str, Any]
    source: DataSource
    source_detail: str
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    ground_truth: str | None = None
    object_id: str | None = None
    provenance: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return {
            "features": self.features,
            "source": self.source.value,
            "source_detail": self.source_detail,
            "timestamp": self.timestamp.isoformat(),
            "ground_truth": self.ground_truth,
            "object_id": self.object_id,
            "provenance": self.provenance,
        }


class SensorDataProvider(ABC):
    source: DataSource
    label: str

    @abstractmethod
    def read(self, *args: Any, **kwargs: Any) -> SensorReading | None:
        """Return the next/selected reading (None when nothing is available)."""

    def describe(self) -> dict[str, Any]:
        return {"source": self.source.value, "label": self.label, "provider": type(self).__name__}


class SimulatedSensorProvider(SensorDataProvider):
    """Physics-inspired simulated fingertip sensor. Values are SIMULATED, not measured."""

    source = DataSource.SIMULATED
    label = "SIMULATED SENSOR DATA"

    def __init__(self, seed: int | None = None):
        self._rng = np.random.default_rng(seed)
        self._lock = threading.Lock()

    def read(
        self,
        material: str,
        object_id: str | None = None,
        env: Environment | None = None,
        seed: int | None = None,
        source_detail: str = "simulator",
    ) -> SensorReading:
        if material not in MATERIALS:
            raise ValueError(f"Unknown material '{material}'")
        if object_id is not None and object_id not in OBJECTS:
            raise ValueError(f"Unknown object '{object_id}'")
        with self._lock:
            rng = np.random.default_rng(seed) if seed is not None else self._rng
            values = generate_readings([material], rng, env)
        rounded = round_readings({f: values[f] for f in FEATURES})
        features = {f: float(np.asarray(rounded[f]).reshape(-1)[0]) for f in FEATURES}
        latent = {k: _scalar(v[0]) for k, v in values.items() if k.startswith(("latent_", "env_"))}
        if latent.get("latent_variant"):
            latent["variant"] = variant_name(material)
        return SensorReading(
            features=features,
            source=self.source,
            source_detail=source_detail,
            ground_truth=material,
            object_id=object_id,
            provenance={"generator": "app.sensors.physics", "simulated": True, **latent},
        )


class FileSensorProvider(SensorDataProvider):
    """Replays rows of an uploaded CSV/JSON dataset through a column mapping."""

    source = DataSource.UPLOADED
    label = "UPLOADED EXTERNAL DATA"

    def __init__(self, dataset_id: int, name: str, rows: list[dict[str, Any]], mapping: dict[str, Any]):
        from app.ingest.parser import resolve_row  # local import avoids a cycle

        self._resolve = resolve_row
        self.dataset_id = dataset_id
        self.name = name
        self.rows = rows
        self.mapping = mapping

    def __len__(self) -> int:
        return len(self.rows)

    def read(self, row_index: int) -> SensorReading:
        if not 0 <= row_index < len(self.rows):
            raise IndexError(f"Row {row_index} is out of range (dataset has {len(self.rows)} rows)")
        resolved = self._resolve(self.rows[row_index], self.mapping, row_index)
        return SensorReading(
            features=resolved.features,
            source=self.source,
            source_detail=f"dataset:{self.name}",
            ground_truth=resolved.label,
            provenance={
                "dataset_id": self.dataset_id,
                "row_index": row_index,
                "row_id": resolved.row_id,
                "raw_label": resolved.raw_label,
                "conversions": resolved.conversions,
            },
        )


@dataclass
class LiveSample:
    seq: int
    reading: SensorReading
    received_at: datetime
    device_id: str
    prediction: dict[str, Any] | None = None
    errors: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "seq": self.seq,
            "device_id": self.device_id,
            "source": self.reading.source_detail,
            "timestamp": self.reading.timestamp.isoformat(),
            "received_at": self.received_at.isoformat(),
            "features": self.reading.features,
            "ground_truth": self.reading.ground_truth,
            "prediction": self.prediction,
            "errors": self.errors,
        }


class LiveSensorProvider(SensorDataProvider):
    """Ring buffer of readings pushed by external devices (or the simulated stream).

    External hardware posts to ``POST /api/sensors/data`` or streams over the
    ``/ws/sensors`` WebSocket; both end up in :meth:`push`.
    """

    source = DataSource.LIVE
    label = "LIVE SENSOR"

    def __init__(self, buffer_size: int = 600):
        self._buffer: deque[LiveSample] = deque(maxlen=buffer_size)
        self._seq = 0
        self._lock = threading.Lock()
        self.samples_received = 0

    def push(
        self,
        features: dict[str, Any],
        source_detail: str,
        device_id: str,
        timestamp: datetime | None = None,
        ground_truth: str | None = None,
    ) -> LiveSample:
        now = datetime.now(timezone.utc)
        reading = SensorReading(
            features=features,
            source=self.source,
            source_detail=source_detail,
            timestamp=timestamp or now,
            ground_truth=ground_truth,
            provenance={"device_id": device_id},
        )
        with self._lock:
            self._seq += 1
            self.samples_received += 1
            sample = LiveSample(seq=self._seq, reading=reading, received_at=now, device_id=device_id)
            self._buffer.append(sample)
        return sample

    def read(self) -> SensorReading | None:
        latest = self.latest()
        return latest.reading if latest else None

    def latest(self) -> LiveSample | None:
        with self._lock:
            return self._buffer[-1] if self._buffer else None

    def since(self, seq: int, limit: int = 200) -> list[LiveSample]:
        with self._lock:
            items = [s for s in self._buffer if s.seq > seq]
        return items[-limit:]

    def recent(self, window_s: float) -> list[LiveSample]:
        cutoff = datetime.now(timezone.utc).timestamp() - window_s
        with self._lock:
            return [s for s in self._buffer if s.received_at.timestamp() >= cutoff]

    def get(self, seq: int) -> LiveSample | None:
        with self._lock:
            for s in reversed(self._buffer):
                if s.seq == seq:
                    return s
        return None

    def clear(self) -> None:
        with self._lock:
            self._buffer.clear()


def _scalar(value: Any) -> Any:
    if isinstance(value, (np.bool_, bool)):
        return bool(value)
    if isinstance(value, (np.floating, float)):
        return round(float(value), 6)
    return value
