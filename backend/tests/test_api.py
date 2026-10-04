"""API integration tests: auth, authorization, endpoints, persistence, live sensors."""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.db.models import PredictionHistory, User
from app.main import create_app
from tests.conftest import ADMIN, login, make_settings

FEATURES = {"pressure": 231.0, "temperature": 27.3, "vibration": 2750.0, "conductivity": 1.7e-12, "contact_duration": 0.15}


# ------------------------------------------------------------------- system
def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["database"]["ok"] and body["database"]["backend"] in ("sqlite", "postgresql")
    assert body["model"]["ready"] is True
    assert r.headers["x-content-type-options"] == "nosniff"


def test_catalogues(client):
    objects = client.get("/api/objects").json()["objects"]
    assert {o["id"] for o in objects} == {"glass", "bottle", "cube", "ball", "container", "steel"}
    materials = client.get("/api/materials").json()
    bases = {m["name"]: m["base_grip"] for m in materials["materials"]}
    assert bases == {"Glass": 25, "Steel": 75, "Plastic": 45, "Wood": 65, "Rubber": 50, "Fabric": 20}
    assert "not physical forces" in materials["grip_note"]
    assert len(client.get("/api/features").json()["features"]) == 5


# --------------------------------------------------------------------- auth
def test_register_login_me_and_password_hashing(client, app):
    r = client.post("/api/auth/register", json={"email": "New@Example.com", "password": "s3cret-pass", "full_name": " Ada "})
    assert r.status_code == 201, r.text
    token = r.json()["access_token"]
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"}).json()
    assert me["email"] == "new@example.com" and me["role"] == "USER" and me["full_name"] == "Ada"
    with app.state.ctx.db.SessionLocal() as db:
        user = db.scalar(select(User).where(User.email == "new@example.com"))
        assert user.hashed_password != "s3cret-pass" and user.hashed_password.startswith("$2")
    assert client.post("/api/auth/register", json={"email": "new@example.com", "password": "another-pass"}).status_code == 409
    assert client.post("/api/auth/login", json={"email": "new@example.com", "password": "wrong-pass"}).status_code == 401
    login(client, "new@example.com", "s3cret-pass")


def test_registration_validation(client):
    r = client.post("/api/auth/register", json={"email": "not-an-email", "password": "short"})
    assert r.status_code == 422
    assert r.json()["code"] == "invalid_request"
    r = client.post("/api/auth/register", json={"email": "x@y.dev", "password": "a" * 80})
    assert r.status_code == 422


def test_protected_routes_require_auth(client):
    for method, path in [("get", "/api/history"), ("post", "/api/predict"), ("get", "/api/metrics"), ("get", "/api/settings"), ("get", "/api/sensors/live-status")]:
        r = getattr(client, method)(path)
        assert r.status_code == 401, path
    assert client.get("/api/history", headers={"Authorization": "Bearer garbage"}).status_code == 401


def test_admin_routes_require_admin_role(client, user_headers, admin_headers):
    assert client.get("/api/admin/stats", headers=user_headers).status_code == 403
    assert client.post("/api/model/train", headers=user_headers, json={}).status_code == 403
    assert client.get("/api/admin/stats", headers=admin_headers).status_code == 200


def test_change_password(client):
    client.post("/api/auth/register", json={"email": "pw@test.dev", "password": "first-password"})
    h = login(client, "pw@test.dev", "first-password")
    assert client.post("/api/auth/change-password", headers=h, json={"current_password": "nope-nope", "new_password": "second-password"}).status_code == 400
    assert client.post("/api/auth/change-password", headers=h, json={"current_password": "first-password", "new_password": "second-password"}).status_code == 200
    login(client, "pw@test.dev", "second-password")


def test_login_throttling(client):
    for _ in range(10):
        client.post("/api/auth/login", json={"email": "brute@test.dev", "password": "wrong-password"})
    assert client.post("/api/auth/login", json={"email": "brute@test.dev", "password": "wrong-password"}).status_code == 429


def test_production_refuses_insecure_defaults(tmp_path, model_dir):
    from pydantic import ValidationError

    from app.core.config import Settings

    with pytest.raises(ValidationError):
        Settings(_env_file=None, environment="production")


# --------------------------------------------------------------- prediction
def test_predict_persists_to_database(client, app, user_headers):
    r = client.post("/api/predict", headers=user_headers, json={"features": FEATURES, "data_source": "SIMULATED", "object_id": "glass"})
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["persisted"] and out["id"]
    with app.state.ctx.db.SessionLocal() as db:
        row = db.get(PredictionHistory, out["id"])
        assert row.pressure == FEATURES["pressure"]
        assert row.predicted_material == out["prediction"]["material"]
        assert row.grip_percent == out["grip"]["grip_percent"]
        assert row.data_source == "SIMULATED"
        assert set(row.probabilities) == {"Glass", "Steel", "Plastic", "Wood", "Rubber", "Fabric"}


def test_predict_without_persist(client, user_headers):
    out = client.post("/api/predict", headers=user_headers, json={"features": FEATURES, "persist": False}).json()
    assert out["persisted"] is False and out["id"] is None
    assert client.get("/api/history", headers=user_headers).json()["total"] == 0


def test_predict_rejects_invalid_sample_with_details(client, user_headers):
    r = client.post("/api/predict", headers=user_headers, json={"features": {**FEATURES, "pressure": "heavy", "temperature": None}})
    assert r.status_code == 422
    body = r.json()
    assert body["code"] == "invalid_sample"
    assert {e["feature"]: e["code"] for e in body["errors"]} == {"pressure": "not_numeric", "temperature": "missing"}


def test_predict_rejects_unknown_object(client, user_headers):
    r = client.post("/api/predict", headers=user_headers, json={"features": FEATURES, "object_id": "rocket"})
    assert r.status_code == 422


def test_simulate_endpoint(client, user_headers):
    out = client.post("/api/simulate", headers=user_headers, json={"object_id": "steel", "seed": 3}).json()
    assert out["reading"]["source"] == "SIMULATED"
    assert out["reading"]["provenance"]["simulated"] is True
    assert out["ground_truth"] == "Steel"
    assert out["command"]["object_id"] == "steel"
    again = client.post("/api/simulate", headers=user_headers, json={"object_id": "steel", "seed": 3}).json()
    assert again["sample"] == out["sample"]  # seeded simulation is reproducible
    override = client.post("/api/simulate", headers=user_headers, json={"object_id": "cube", "material": "Fabric", "seed": 5}).json()
    assert override["ground_truth"] == "Fabric"


def test_poor_contact_simulation_can_lower_confidence(client, user_headers):
    outs = [
        client.post("/api/simulate", headers=user_headers, json={"object_id": "glass", "seed": s, "contact_quality": 0.4, "noise_level": 2.5, "persist": False}).json()
        for s in range(15)
    ]
    # Degraded readings are genuinely harder: lower mean confidence than clean ones.
    clean = [
        client.post("/api/simulate", headers=user_headers, json={"object_id": "glass", "seed": s, "persist": False}).json()
        for s in range(15)
    ]
    mean = lambda xs: sum(x["prediction"]["confidence"] for x in xs) / len(xs)  # noqa: E731
    assert mean(outs) < mean(clean)
    assert all(o["grip"]["grip_percent"] <= 40 for o in outs)  # glass form always protected


def test_experiment_sweep(client, user_headers):
    r = client.post(
        "/api/experiments/sweep",
        headers=user_headers,
        json={"features": FEATURES, "feature": "conductivity", "start": 1e-12, "stop": 1e6, "steps": 12},
    )
    assert r.status_code == 200
    pts = r.json()["points"]
    assert len(pts) == 12 and all(p["valid"] for p in pts)
    assert pts[0]["value"] == pytest.approx(1e-12) and pts[-1]["value"] == pytest.approx(1e6)
    assert pts[-1]["probabilities"]["Steel"] > pts[0]["probabilities"]["Steel"]


# ------------------------------------------------------------- external data
def test_upload_json_and_manual_mapping_flow(client, user_headers):
    payload = {"data": [{"sample": 1, "p": 230, "t": 27.4, "v": 2700, "c": 1.6e-12, "d": 0.15}]}
    ds = client.post("/api/upload", headers=user_headers, files={"file": ("x.json", json.dumps(payload).encode(), "application/json")}).json()
    assert ds["summary"]["invalid_rows"] == 1  # nothing auto-mapped
    r = client.post(f"/api/datasets/{ds['id']}/rows/0/simulate", headers=user_headers, json={})
    assert r.status_code == 422  # unmapped -> cannot simulate (no silent guessing)
    ds = client.put(
        f"/api/datasets/{ds['id']}/mapping",
        headers=user_headers,
        json={"features": {"pressure": "p", "temperature": "t", "vibration": "v", "conductivity": "c", "contact_duration": "d"}},
    ).json()
    assert ds["summary"]["simulatable_rows"] == 1
    out = client.post(f"/api/datasets/{ds['id']}/rows/0/simulate", headers=user_headers, json={}).json()
    assert out["sample"]["vibration"] == 2700


def test_upload_rejects_bad_files(client, user_headers):
    r = client.post("/api/upload", headers=user_headers, files={"file": ("x.exe", b"MZ\x00", "application/octet-stream")})
    assert r.status_code == 400 and r.json()["code"] == "unsupported_type"
    r = client.post("/api/upload", headers=user_headers, files={"file": ("x.csv", b"a,b\n" + b"1,2\n" * 3_000_000, "text/csv")})
    assert r.status_code == 413


def test_dataset_rows_pagination_and_isolation(client, user_headers):
    csv = "pressure,temperature,vibration,conductivity,contact_duration,material\n" + "\n".join(
        f"{200 + i},27,2700,1e-12,0.15,Glass" for i in range(30)
    ) + "\n,27,2700,1e-12,0.15,Glass\n"
    ds = client.post("/api/upload", headers=user_headers, files={"file": ("p.csv", csv.encode(), "text/csv")}).json()
    page = client.get(f"/api/datasets/{ds['id']}/rows?offset=10&limit=5", headers=user_headers).json()
    assert page["total"] == 31 and [r["row_index"] for r in page["rows"]] == [10, 11, 12, 13, 14]
    invalid = client.get(f"/api/datasets/{ds['id']}/rows?status=invalid", headers=user_headers).json()
    assert invalid["total"] == 1 and invalid["rows"][0]["row_index"] == 30
    # another user cannot see it
    client.post("/api/auth/register", json={"email": "other@test.dev", "password": "other-password"})
    other = login(client, "other@test.dev", "other-password")
    assert client.get(f"/api/datasets/{ds['id']}", headers=other).status_code == 404
    batch = client.post("/api/process-batch", headers=user_headers, json={"dataset_id": ds["id"], "persist": True}).json()
    assert batch["ok"] == 30 and batch["invalid"] == 1 and batch["persisted"] == 30
    ev = batch["evaluation"]
    assert ev["labeled_rows"] == 30
    assert ev["accuracy"] == pytest.approx(sum(r["correct"] for r in batch["results"] if r["status"] == "ok") / 30)
    assert sum(sum(row) for row in ev["confusion_matrix"]["matrix"]) == 30
    assert client.delete(f"/api/datasets/{ds['id']}", headers=user_headers).status_code == 204


def test_inline_batch(client, user_headers):
    out = client.post("/api/process-batch", headers=user_headers, json={"rows": [FEATURES, {**FEATURES, "pressure": None}]}).json()
    assert out["ok"] == 1 and out["invalid"] == 1
    assert out["results"][1]["errors"][0]["code"] == "missing"


def test_template_download_is_uploadable(client, user_headers):
    csv = client.get("/api/dataset/template?format=csv&rows=12").text
    ds = client.post("/api/upload", headers=user_headers, files={"file": ("t.csv", csv.encode(), "text/csv")}).json()
    assert ds["summary"]["simulatable_rows"] == 12 and ds["summary"]["has_labels"]
    js = client.get("/api/dataset/template?format=json&rows=6").text
    ds = client.post("/api/upload", headers=user_headers, files={"file": ("t.json", js.encode(), "application/json")}).json()
    assert ds["row_count"] == 6


# ------------------------------------------------------------------ history
def test_history_filters_and_export(client, user_headers):
    client.post("/api/predict", headers=user_headers, json={"features": FEATURES, "data_source": "LIVE"})
    client.post("/api/simulate", headers=user_headers, json={"object_id": "steel", "seed": 2})
    all_items = client.get("/api/history", headers=user_headers).json()
    assert all_items["total"] == 2
    live = client.get("/api/history?source=LIVE", headers=user_headers).json()
    assert live["total"] == 1 and live["items"][0]["data_source"] == "LIVE"
    steel = client.get("/api/history?q=steel", headers=user_headers).json()
    assert steel["total"] >= 1
    csv = client.get("/api/history/export?format=csv", headers=user_headers)
    assert csv.status_code == 200 and csv.text.startswith("id,created_at,data_source")
    assert len(csv.text.strip().splitlines()) == 3
    js = client.get("/api/history/export?format=json", headers=user_headers).json()
    assert len(js) == 2 and "probabilities" in js[0]
    item_id = all_items["items"][0]["id"]
    assert client.delete(f"/api/history/{item_id}", headers=user_headers).status_code == 204
    assert client.get("/api/history", headers=user_headers).json()["total"] == 1


def test_metrics_are_computed_from_history(client, user_headers):
    empty = client.get("/api/metrics", headers=user_headers).json()
    assert empty["total_predictions"] == 0 and empty["labeled_evaluation"]["accuracy"] is None
    for s in range(4):
        client.post("/api/simulate", headers=user_headers, json={"object_id": "cube", "seed": s})
    m = client.get("/api/metrics", headers=user_headers).json()
    assert m["total_predictions"] == 4
    assert sum(x["count"] for x in m["source_distribution"]) == 4
    assert sum(x["count"] for x in m["confidence_histogram"]) == 4
    assert m["labeled_evaluation"]["labeled_predictions"] == 4
    assert m["model"]["metrics"]["accuracy"] > 0.9
    assert client.get("/api/metrics?scope=all", headers=user_headers).status_code == 403


# --------------------------------------------------------------------- model
def test_model_status_and_classes(client):
    s = client.get("/api/model/status").json()
    assert s["ready"] and s["model_type"] == "RandomForestClassifier"
    assert s["params"] == {"n_estimators": 100, "max_depth": 12, "random_state": 42}
    assert "class_feature_stats" not in s  # internal stats are not exposed
    assert len(client.get("/api/model/classes").json()["classes"]) == 6


def test_admin_can_retrain(tmp_path, model_dir):
    import shutil

    own_dir = tmp_path / "model"
    shutil.copytree(model_dir, own_dir)
    app = create_app(make_settings(tmp_path, own_dir))
    with TestClient(app) as c:
        h = login(c, *ADMIN)
        before = c.get("/api/model/status").json()["version"]
        r = c.post("/api/model/train", headers=h, json={"n_samples": 3000, "seed": 7})
        assert r.status_code == 200, r.text
        after = r.json()
        assert after["version"] != before and after["dataset"]["n_samples"] == 3000
        assert c.get("/api/model/status").json()["version"] == after["version"]
        runs = c.get("/api/model/runs", headers=h).json()["runs"]
        assert runs[0]["model_version"] == after["version"] and runs[0]["triggered_by"] == ADMIN[0]
        assert c.post("/api/model/train", headers=h, json={"n_samples": 100}).status_code == 422


def test_dataset_info_and_download(client, user_headers):
    info = client.get("/api/dataset/info", headers=user_headers).json()
    assert info["simulated"] is True and info["n_samples"] == 4800
    csv = client.get("/api/dataset/download", headers=user_headers).text
    assert len(csv.strip().splitlines()) == 4801


# ------------------------------------------------------------- live sensors
def test_sensor_ingest_auth(client, user_headers):
    body = {"device_id": "esp32-01", "samples": [FEATURES]}
    assert client.post("/api/sensors/data", json=body).status_code == 401
    assert client.post("/api/sensors/data", json=body, headers={"X-Device-Key": "wrong"}).status_code == 401
    ok = client.post("/api/sensors/data", json=body, headers={"X-Device-Key": "test-device-key"})
    assert ok.status_code == 200
    assert client.post("/api/sensors/data", json=body, headers=user_headers).status_code == 200


def test_live_status_reflects_real_ingestion(client, user_headers):
    s = client.get("/api/sensors/live-status", headers=user_headers).json()
    assert s["connected"] is False and s["samples_received"] == 0 and s["state"] == "NO_DATA"
    client.post("/api/sensors/data", headers={"X-Device-Key": "test-device-key"}, json={"device_id": "esp32-01", "samples": [FEATURES, FEATURES]})
    s = client.get("/api/sensors/live-status", headers=user_headers).json()
    assert s["connected"] is True and s["samples_received"] == 2 and s["device_id"] == "esp32-01"
    assert s["is_simulated"] is False
    polled = client.get("/api/sensors/latest?since=1", headers=user_headers).json()
    assert [x["seq"] for x in polled["samples"]] == [2]
    assert polled["samples"][0]["prediction"]["material"]


def test_live_ingest_reports_invalid_and_no_contact(client):
    h = {"X-Device-Key": "test-device-key"}
    r = client.post("/api/sensors/data", headers=h, json={"samples": [{**FEATURES, "vibration": "loud"}, {**FEATURES, "pressure": 1.0}]}).json()
    assert r["results"][0]["errors"][0]["code"] == "not_numeric"
    assert r["results"][1]["errors"][0]["code"] == "no_contact"
    assert r["results"][1]["prediction"] is None


def test_websocket_requires_auth_and_streams(client, user_headers):
    from starlette.websockets import WebSocketDisconnect

    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect("/ws/sensors") as ws:
            ws.receive_json()
    token = user_headers["Authorization"].split()[1]
    with client.websocket_connect(f"/ws/sensors?token={token}") as ws:
        first = ws.receive_json()
        assert first["type"] == "status"
        ws.send_json({"type": "ping", "t": 123})
        msgs = [ws.receive_json() for _ in range(3)]
        assert any(m["type"] == "pong" and m["t"] == 123 for m in msgs)


def test_websocket_device_can_publish(client, user_headers):
    with client.websocket_connect("/ws/sensors?device_key=test-device-key") as ws:
        ws.receive_json()  # status
        ws.send_json({"type": "sample", "device_id": "ws-esp32", "data": FEATURES})
        for _ in range(5):
            m = ws.receive_json()
            if m["type"] == "ack":
                assert m["seq"] >= 1 and m["errors"] == []
                break
        else:
            pytest.fail("no ack received")
    s = client.get("/api/sensors/live-status", headers=user_headers).json()
    assert s["device_id"] == "ws-esp32"


def test_simulated_stream_start_stop(client, user_headers):
    import time

    r = client.post("/api/sensors/stream/start", headers=user_headers, json={"rate_hz": 20})
    assert r.status_code == 200 and "SIMULATED" in r.json()["label"]
    deadline = time.time() + 5
    status = {}
    while time.time() < deadline:
        status = client.get("/api/sensors/live-status", headers=user_headers).json()
        if status["samples_received"] >= 3:
            break
        time.sleep(0.1)
    assert status["samples_received"] >= 3
    assert status["is_simulated"] is True and status["source"] == "SIMULATED_LIVE_STREAM"
    assert client.post("/api/sensors/stream/stop", headers=user_headers).json()["stream"]["running"] is False


# ---------------------------------------------------------- settings / admin
def test_user_settings_roundtrip(client, user_headers):
    s = client.get("/api/settings", headers=user_headers).json()
    assert s["user"]["theme"] == "dark"
    r = client.put("/api/settings", headers=user_headers, json={"theme": "light", "playback_speed": 2.0, "default_object": "ball"})
    assert r.json()["user"]["theme"] == "light"
    assert client.get("/api/settings", headers=user_headers).json()["user"]["playback_speed"] == 2.0
    assert client.put("/api/settings", headers=user_headers, json={"playback_speed": 3.0}).status_code == 422


def test_admin_user_management_and_system_settings(client, admin_headers, user_headers):
    users = client.get("/api/admin/users", headers=admin_headers).json()["users"]
    demo = next(u for u in users if u["email"] == "demo@test.dev")
    me = next(u for u in users if u["email"] == ADMIN[0])
    assert client.patch(f"/api/admin/users/{me['id']}", headers=admin_headers, json={"role": "USER"}).status_code == 400
    assert client.patch(f"/api/admin/users/{demo['id']}", headers=admin_headers, json={"is_active": False}).json()["is_active"] is False
    assert client.get("/api/auth/me", headers=user_headers).status_code == 401  # deactivated
    client.patch(f"/api/admin/users/{demo['id']}", headers=admin_headers, json={"is_active": True})
    s = client.put("/api/admin/system-settings", headers=admin_headers, json={"allow_registration": False, "announcement": "Exam day"}).json()
    assert s["allow_registration"] is False
    assert client.post("/api/auth/register", json={"email": "late@test.dev", "password": "password-123"}).status_code == 403
    assert client.get("/api/settings/public").json()["announcement"] == "Exam day"
    stats = client.get("/api/admin/stats", headers=admin_headers).json()
    assert stats["users"]["total"] == 2 and stats["system"]["database"] in ("sqlite", "postgresql")
