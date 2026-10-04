"""SQLAlchemy ORM models."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(120), default="")
    hashed_password: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(16), default="USER")  # USER | ADMIN
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    settings: Mapped["UserSettings | None"] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )


class UserSettings(Base):
    __tablename__ = "user_settings"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    theme: Mapped[str] = mapped_column(String(16), default="dark")  # dark | light | system
    reduced_motion: Mapped[bool] = mapped_column(Boolean, default=False)
    default_object: Mapped[str] = mapped_column(String(32), default="glass")
    playback_speed: Mapped[float] = mapped_column(Float, default=1.0)
    auto_save_history: Mapped[bool] = mapped_column(Boolean, default=True)
    record_playback: Mapped[bool] = mapped_column(Boolean, default=True)
    show_sensor_labels: Mapped[bool] = mapped_column(Boolean, default=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    user: Mapped[User] = relationship(back_populates="settings")


class SystemSettings(Base):
    """Key/value store for administrator-controlled settings."""

    __tablename__ = "system_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[Any] = mapped_column(JSON)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Dataset(Base):
    """An uploaded external CSV/JSON dataset (parsed rows stored as JSON, never executed)."""

    __tablename__ = "datasets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    file_format: Mapped[str] = mapped_column(String(8))  # csv | json
    size_bytes: Mapped[int] = mapped_column(Integer)
    row_count: Mapped[int] = mapped_column(Integer)
    columns: Mapped[list] = mapped_column(JSON)
    mapping: Mapped[dict] = mapped_column(JSON)
    summary: Mapped[dict] = mapped_column(JSON, default=dict)
    parse_notes: Mapped[list] = mapped_column(JSON, default=list)
    rows: Mapped[list] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class PredictionHistory(Base):
    __tablename__ = "prediction_history"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    data_source: Mapped[str] = mapped_column(String(16), index=True)  # SIMULATED | UPLOADED | LIVE
    source_detail: Mapped[str | None] = mapped_column(String(64), nullable=True)
    object_id: Mapped[str | None] = mapped_column(String(32), nullable=True)

    pressure: Mapped[float] = mapped_column(Float)
    temperature: Mapped[float] = mapped_column(Float)
    vibration: Mapped[float] = mapped_column(Float)
    conductivity: Mapped[float] = mapped_column(Float)
    contact_duration: Mapped[float] = mapped_column(Float)

    predicted_material: Mapped[str] = mapped_column(String(16), index=True)
    is_uncertain: Mapped[bool] = mapped_column(Boolean, default=False)
    confidence: Mapped[float] = mapped_column(Float)
    confidence_level: Mapped[str] = mapped_column(String(16))
    probabilities: Mapped[dict] = mapped_column(JSON)

    grip_percent: Mapped[float] = mapped_column(Float)
    grip_mode: Mapped[str] = mapped_column(String(24))
    grasp_type: Mapped[str] = mapped_column(String(64))
    safety_status: Mapped[str] = mapped_column(String(16), index=True)
    safety_warnings: Mapped[list] = mapped_column(JSON, default=list)
    grip_breakdown: Mapped[dict] = mapped_column(JSON, default=dict)

    ground_truth: Mapped[str | None] = mapped_column(String(16), nullable=True)
    is_correct: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    dataset_id: Mapped[int | None] = mapped_column(ForeignKey("datasets.id", ondelete="SET NULL"), nullable=True)
    row_ref: Mapped[str | None] = mapped_column(String(64), nullable=True)
    model_version: Mapped[str] = mapped_column(String(64))
    latency_ms: Mapped[float] = mapped_column(Float, default=0.0)
    meta: Mapped[dict] = mapped_column(JSON, default=dict)


class ModelTrainingRun(Base):
    __tablename__ = "model_training_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    model_version: Mapped[str] = mapped_column(String(64))
    triggered_by: Mapped[str] = mapped_column(String(255))
    n_samples: Mapped[int] = mapped_column(Integer)
    seed: Mapped[int] = mapped_column(Integer)
    test_size: Mapped[float] = mapped_column(Float)
    accuracy: Mapped[float] = mapped_column(Float)
    f1_macro: Mapped[float] = mapped_column(Float)
    duration_s: Mapped[float] = mapped_column(Float)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
