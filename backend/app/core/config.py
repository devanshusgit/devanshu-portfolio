"""Application configuration.

All settings are read from environment variables (optionally via a ``.env`` file).
Secrets are never hard-coded for production: when ``ENVIRONMENT=production`` the
application refuses to start with the development defaults.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parents[2]

_DEV_SECRET = "dev-only-insecure-secret-change-me"
_DEV_DEVICE_KEY = "dev-sensor-device-key"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(BACKEND_DIR / ".env", BACKEND_DIR.parent / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "NeuroGrip"
    environment: str = Field(default="development", description="development | test | production")

    # --- Database -----------------------------------------------------------
    # PostgreSQL is the primary target, e.g.
    #   postgresql+psycopg://neurogrip:password@db:5432/neurogrip
    # SQLite is the zero-configuration development fallback.
    database_url: str = f"sqlite:///{BACKEND_DIR / 'neurogrip.db'}"

    # --- Security -----------------------------------------------------------
    secret_key: str = _DEV_SECRET
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 12 * 60
    # Shared key that external sensor devices (ESP32/Arduino bridges) send in the
    # ``X-Device-Key`` header when posting to /api/sensors/data.
    sensor_device_key: str = _DEV_DEVICE_KEY

    # Comma separated list of allowed CORS origins.
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080"

    # --- Seed accounts ------------------------------------------------------
    admin_email: str = "admin@neurogrip.dev"
    admin_password: str = "NeuroGrip-Admin-2026"
    admin_name: str = "NeuroGrip Administrator"
    seed_demo_user: bool = True
    demo_email: str = "demo@neurogrip.dev"
    demo_password: str = "demo-password-2026"

    # --- Machine learning ---------------------------------------------------
    model_dir: Path = BACKEND_DIR / "artifacts"
    dataset_samples: int = 4800
    dataset_seed: int = 42
    test_size: float = 0.2
    train_on_startup_if_missing: bool = True

    # --- External data ------------------------------------------------------
    max_upload_mb: float = 5.0
    max_upload_rows: int = 20000

    # --- Live sensors -------------------------------------------------------
    live_buffer_size: int = 600
    live_connected_timeout_s: float = 3.0
    simulated_stream_rate_hz: float = 4.0

    @field_validator("environment")
    @classmethod
    def _normalise_env(cls, v: str) -> str:
        return v.strip().lower()

    @model_validator(mode="after")
    def _guard_production_secrets(self) -> "Settings":
        if self.environment == "production":
            problems = []
            if self.secret_key == _DEV_SECRET or len(self.secret_key) < 32:
                problems.append("SECRET_KEY must be set to a random value of at least 32 characters")
            if self.sensor_device_key == _DEV_DEVICE_KEY:
                problems.append("SENSOR_DEVICE_KEY must be changed from the development default")
            if self.admin_password == "NeuroGrip-Admin-2026":
                problems.append("ADMIN_PASSWORD must be changed from the development default")
            if problems:
                raise ValueError("Insecure production configuration: " + "; ".join(problems))
        return self

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def max_upload_bytes(self) -> int:
        return int(self.max_upload_mb * 1024 * 1024)

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


@lru_cache
def get_settings() -> Settings:
    return Settings()
