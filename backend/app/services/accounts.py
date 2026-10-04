"""User accounts, user settings and administrator system settings."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.core.security import hash_password
from app.db.models import SystemSettings, User, UserSettings

log = logging.getLogger(__name__)

SYSTEM_DEFAULTS: dict[str, Any] = {
    "allow_registration": True,
    "live_stream_rate_hz": 4.0,
    "announcement": "",
    "max_upload_mb": 5.0,
}

USER_SETTING_FIELDS = (
    "theme",
    "reduced_motion",
    "default_object",
    "playback_speed",
    "auto_save_history",
    "record_playback",
    "show_sensor_labels",
)


def get_or_create_user_settings(db: Session, user: User) -> UserSettings:
    settings = db.get(UserSettings, user.id)
    if settings is None:
        settings = UserSettings(user_id=user.id)
        db.add(settings)
        db.commit()
        db.refresh(settings)
    return settings


def user_settings_dict(s: UserSettings) -> dict[str, Any]:
    return {f: getattr(s, f) for f in USER_SETTING_FIELDS}


def get_system_settings(db: Session) -> dict[str, Any]:
    stored = {row.key: row.value for row in db.scalars(select(SystemSettings))}
    return {k: stored.get(k, v) for k, v in SYSTEM_DEFAULTS.items()}


def update_system_settings(db: Session, values: dict[str, Any]) -> dict[str, Any]:
    for key, value in values.items():
        if key not in SYSTEM_DEFAULTS:
            continue
        row = db.get(SystemSettings, key)
        if row is None:
            db.add(SystemSettings(key=key, value=value))
        else:
            row.value = value
            row.updated_at = datetime.now(timezone.utc)
    db.commit()
    return get_system_settings(db)


def create_user(db: Session, email: str, password: str, full_name: str = "", role: str = "USER") -> User:
    user = User(email=email.lower(), full_name=full_name, hashed_password=hash_password(password), role=role)
    db.add(user)
    db.commit()
    db.refresh(user)
    get_or_create_user_settings(db, user)
    return user


def seed_accounts(db: Session, settings: Settings) -> None:
    """Create the bootstrap administrator (and optional demo user) if missing."""
    if db.scalar(select(User).where(User.email == settings.admin_email.lower())) is None:
        create_user(db, settings.admin_email, settings.admin_password, settings.admin_name, role="ADMIN")
        log.info("Seeded administrator account %s", settings.admin_email)
    if settings.seed_demo_user and db.scalar(select(User).where(User.email == settings.demo_email.lower())) is None:
        create_user(db, settings.demo_email, settings.demo_password, "Demo Examiner", role="USER")
        log.info("Seeded demo account %s", settings.demo_email)
