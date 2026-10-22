"""Phone-as-sensor relay: taps are classified, stored in the database and visible in the feed."""

from __future__ import annotations

from tests.conftest import ADMIN, DEMO, login

GLASS_TAP = {"pressure": 240.0, "temperature": 27.5, "vibration": 2700, "conductivity": 2e-12, "contact_duration": 0.13}
STEEL_TAP = {"pressure": 240.0, "temperature": 24.0, "vibration": 2600, "conductivity": 1e6, "contact_duration": 0.13}


def test_phone_tap_feed_roundtrip(client):
    h = login(client, *DEMO)
    feed = client.get("/api/phone/feed", headers=h).json()
    assert feed["taps"] == [] and feed["device"]["online"] is False

    assert client.post("/api/phone/heartbeat", headers=h, json={"device": "Android phone", "level": 0.2}).status_code == 200
    feed = client.get("/api/phone/feed", headers=h).json()
    assert feed["device"]["online"] is True and feed["device"]["live"]["level"] == 0.2

    measurements = {"dominant_hz": 2700, "decay_ms": 210, "rise_ms": 0.4, "peak": 0.8}
    r = client.post("/api/phone/taps", headers=h, json={"device": "Android phone", "features": GLASS_TAP, "measurements": measurements})
    assert r.status_code == 200, r.text
    tap = r.json()
    assert tap["prediction"]["material"] == "Glass"
    assert tap["measurements"]["dominant_hz"] == 2700

    r = client.post("/api/phone/taps", headers=h, json={"features": STEEL_TAP})
    assert r.json()["prediction"]["material"] == "Steel"

    feed = client.get("/api/phone/feed", headers=h).json()
    assert [t["prediction"]["material"] for t in feed["taps"]] == ["Glass", "Steel"]
    newer = client.get("/api/phone/feed", headers=h, params={"after_id": tap["id"]}).json()
    assert [t["prediction"]["material"] for t in newer["taps"]] == ["Steel"]

    # Taps are private to the account that sent them.
    other = client.get("/api/phone/feed", headers=login(client, *ADMIN)).json()
    assert other["taps"] == []


def test_phone_tap_requires_auth_and_valid_features(client):
    assert client.post("/api/phone/taps", json={"features": GLASS_TAP}).status_code == 401
    h = login(client, *DEMO)
    bad = {**GLASS_TAP, "vibration": "loud"}
    assert client.post("/api/phone/taps", headers=h, json={"features": bad}).status_code == 422
