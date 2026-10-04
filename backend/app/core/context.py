"""Application service container (one per FastAPI app instance)."""

from __future__ import annotations

import time
from dataclasses import dataclass, field

from app.core.config import Settings
from app.db.session import Database
from app.ml.registry import ModelRegistry
from app.sensors.live import LiveSensorHub
from app.sensors.providers import LiveSensorProvider, SimulatedSensorProvider
from app.services.pipeline import PredictionPipeline


@dataclass
class AppContext:
    settings: Settings
    db: Database
    registry: ModelRegistry
    pipeline: PredictionPipeline
    simulator: SimulatedSensorProvider
    live_provider: LiveSensorProvider
    live: LiveSensorHub
    started_at: float = field(default_factory=time.time)

    @classmethod
    def build(cls, settings: Settings) -> "AppContext":
        db = Database(settings.database_url)
        registry = ModelRegistry(
            settings.model_dir,
            n_samples=settings.dataset_samples,
            seed=settings.dataset_seed,
            test_size=settings.test_size,
        )
        pipeline = PredictionPipeline(registry)
        live_provider = LiveSensorProvider(settings.live_buffer_size)
        live = LiveSensorHub(
            live_provider,
            pipeline,
            connected_timeout_s=settings.live_connected_timeout_s,
            default_rate_hz=settings.simulated_stream_rate_hz,
        )
        return cls(
            settings=settings,
            db=db,
            registry=registry,
            pipeline=pipeline,
            simulator=SimulatedSensorProvider(),
            live_provider=live_provider,
            live=live,
        )
