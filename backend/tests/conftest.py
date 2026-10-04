from __future__ import annotations

import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app
from app.ml.registry import ModelRegistry

ADMIN = ("admin@test.dev", "admin-password-123")
DEMO = ("demo@test.dev", "demo-password-123")


@pytest.fixture(scope="session")
def model_dir(tmp_path_factory) -> Path:
    """Train the real model once per test session (it is genuinely trained)."""
    d = tmp_path_factory.mktemp("model")
    ModelRegistry(d).ensure_ready()
    return d


@pytest.fixture(scope="session")
def registry(model_dir) -> ModelRegistry:
    reg = ModelRegistry(model_dir)
    assert reg.load()
    return reg


# Set TEST_DATABASE_URL=postgresql+psycopg://... to run the suite against PostgreSQL.
TEST_DATABASE_URL = os.environ.get("TEST_DATABASE_URL")


def _fresh_database_url(tmp_path: Path) -> str:
    if not TEST_DATABASE_URL:
        return f"sqlite:///{tmp_path / 'test.db'}"
    from app.db import models  # noqa: F401
    from app.db.session import Base, make_engine

    engine = make_engine(TEST_DATABASE_URL)
    Base.metadata.drop_all(engine)
    engine.dispose()
    return TEST_DATABASE_URL


def make_settings(tmp_path: Path, model_dir: Path, **overrides) -> Settings:
    values = dict(
        environment="test",
        database_url=_fresh_database_url(tmp_path),
        model_dir=model_dir,
        admin_email=ADMIN[0],
        admin_password=ADMIN[1],
        demo_email=DEMO[0],
        demo_password=DEMO[1],
        seed_demo_user=True,
        sensor_device_key="test-device-key",
        secret_key="test-secret-key-that-is-long-enough-123",
    )
    values.update(overrides)
    return Settings(_env_file=None, **values)


@pytest.fixture()
def app(tmp_path, model_dir):
    return create_app(make_settings(tmp_path, model_dir))


@pytest.fixture()
def client(app):
    with TestClient(app) as c:
        yield c


def login(client: TestClient, email: str, password: str) -> dict[str, str]:
    r = client.post("/api/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture()
def user_headers(client) -> dict[str, str]:
    return login(client, *DEMO)


@pytest.fixture()
def admin_headers(client) -> dict[str, str]:
    return login(client, *ADMIN)
