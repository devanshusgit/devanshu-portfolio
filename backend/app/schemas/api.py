"""Request schemas (Pydantic). Responses are produced by the service layer."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.core.security import BCRYPT_MAX_BYTES
from app.domain.materials import FEATURES, MATERIALS
from app.domain.objects import OBJECTS

SourceLiteral = Literal["SIMULATED", "UPLOADED", "LIVE"]


def _check_object(v: str | None) -> str | None:
    if v is not None and v not in OBJECTS:
        raise ValueError(f"Unknown object '{v}'. Valid: {', '.join(OBJECTS)}")
    return v


def _check_password(v: str) -> str:
    if len(v) < 8:
        raise ValueError("Password must be at least 8 characters")
    if len(v.encode("utf-8")) > BCRYPT_MAX_BYTES:
        raise ValueError(f"Password must be at most {BCRYPT_MAX_BYTES} bytes")
    return v


# ---------------------------------------------------------------------- auth
class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str = Field(default="", max_length=120)

    _pw = field_validator("password")(_check_password)

    @field_validator("full_name")
    @classmethod
    def _strip(cls, v: str) -> str:
        return v.strip()


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(max_length=256)


class ProfileUpdate(BaseModel):
    full_name: str = Field(max_length=120)


class PasswordChange(BaseModel):
    current_password: str = Field(max_length=256)
    new_password: str

    _pw = field_validator("new_password")(_check_password)


# ---------------------------------------------------------------- prediction
class SensorFeaturesIn(BaseModel):
    """Raw sensor features. Types are validated by the shared pipeline validator so
    every source (REST, upload, live) gets identical, detailed error messages."""

    model_config = ConfigDict(extra="ignore")

    pressure: Any = None
    temperature: Any = None
    vibration: Any = None
    conductivity: Any = None
    contact_duration: Any = None

    def raw(self) -> dict[str, Any]:
        return {f: getattr(self, f) for f in FEATURES}


class PredictRequest(BaseModel):
    features: SensorFeaturesIn
    data_source: SourceLiteral = "SIMULATED"
    source_detail: str | None = Field(default=None, max_length=64)
    object_id: str | None = None
    ground_truth: str | None = Field(default=None, max_length=32)
    persist: bool = True

    _obj = field_validator("object_id")(_check_object)


class SimulateRequest(BaseModel):
    object_id: str = "glass"
    material: str | None = None
    seed: int | None = Field(default=None, ge=0, le=2**31 - 1)
    ambient_temperature: float | None = Field(default=None, ge=-20, le=60)
    humidity: float | None = Field(default=None, ge=0, le=1)
    contact_quality: float | None = Field(default=None, ge=0.05, le=1)
    noise_level: float = Field(default=1.0, ge=0, le=5)
    persist: bool = True
    source_detail: str | None = Field(default=None, max_length=64)

    _obj = field_validator("object_id")(_check_object)

    @field_validator("material")
    @classmethod
    def _mat(cls, v: str | None) -> str | None:
        if v is not None and v not in MATERIALS:
            raise ValueError(f"Unknown material '{v}'. Valid: {', '.join(MATERIALS)}")
        return v


class SweepRequest(BaseModel):
    features: SensorFeaturesIn
    feature: Literal["pressure", "temperature", "vibration", "conductivity", "contact_duration"]
    start: float
    stop: float
    steps: int = Field(default=40, ge=2, le=200)
    object_id: str | None = None

    _obj = field_validator("object_id")(_check_object)


# ------------------------------------------------------------------- datasets
class MappingUpdate(BaseModel):
    features: dict[str, str | None] | None = None
    conversions: dict[str, str | None] | None = None
    label_column: str | None = None
    id_column: str | None = None
    clear_label: bool = False
    clear_id: bool = False


class RowSimulateRequest(BaseModel):
    object_id: str | None = None
    persist: bool = True
    source_detail: str | None = Field(default=None, max_length=64)

    _obj = field_validator("object_id")(_check_object)


class BatchRequest(BaseModel):
    dataset_id: int | None = None
    rows: list[dict[str, Any]] | None = Field(default=None, max_length=20000)
    offset: int = Field(default=0, ge=0)
    limit: int | None = Field(default=None, ge=1, le=20000)
    object_id: str | None = None
    persist: bool = False

    _obj = field_validator("object_id")(_check_object)


# --------------------------------------------------------------------- sensors
class LiveSampleIn(SensorFeaturesIn):
    timestamp: datetime | None = None
    ground_truth: str | None = Field(default=None, max_length=32)


class SensorDataRequest(BaseModel):
    device_id: str = Field(default="external-device", min_length=1, max_length=64, pattern=r"^[A-Za-z0-9._:\-]+$")
    simulated: bool = Field(default=False, description="Device self-declares that its data is simulated")
    samples: list[LiveSampleIn] = Field(min_length=1, max_length=100)


class StreamStartRequest(BaseModel):
    rate_hz: float | None = Field(default=None, ge=0.5, le=20)
    dwell_s: float = Field(default=4.0, ge=1, le=30)


class LivePredictRequest(BaseModel):
    object_id: str | None = None
    persist: bool = True

    _obj = field_validator("object_id")(_check_object)


# ---------------------------------------------------------------------- model
class TrainRequest(BaseModel):
    n_samples: int = Field(default=4800, ge=3000, le=6000)
    seed: int = Field(default=42, ge=0, le=2**31 - 1)
    test_size: float = Field(default=0.2, ge=0.1, le=0.4)


# ------------------------------------------------------------------- settings
class UserSettingsUpdate(BaseModel):
    theme: Literal["dark", "light", "system"] | None = None
    reduced_motion: bool | None = None
    default_object: str | None = None
    playback_speed: Literal[0.5, 1.0, 2.0, 5.0] | None = None
    auto_save_history: bool | None = None
    record_playback: bool | None = None
    show_sensor_labels: bool | None = None

    _obj = field_validator("default_object")(_check_object)


class SystemSettingsUpdate(BaseModel):
    allow_registration: bool | None = None
    live_stream_rate_hz: float | None = Field(default=None, ge=0.5, le=20)
    announcement: str | None = Field(default=None, max_length=280)
    max_upload_mb: float | None = Field(default=None, ge=0.1, le=50)


class AdminUserUpdate(BaseModel):
    role: Literal["USER", "ADMIN"] | None = None
    is_active: bool | None = None
