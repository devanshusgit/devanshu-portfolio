"""CRITICAL END-TO-END ACCEPTANCE TEST.

UPLOAD -> PARSE -> VALIDATE -> DISPLAY -> SELECT ROW 1 -> SIMULATE THIS SAMPLE
-> SHARED PREPROCESSING -> ACTUAL RANDOM FOREST -> ACTUAL PROBABILITIES
-> ACTUAL CONFIDENCE -> GRIP ENGINE -> SIMULATION COMMAND -> SAVE HISTORY

Proves the stages are connected: the API result for an uploaded row must be
bit-for-bit what the persisted model + grip engine produce for those exact values,
and different rows must produce different, row-specific outputs.
"""

from __future__ import annotations

import pytest

from app.domain.materials import FEATURES
from app.grip.engine import GripEngine
from app.ml.preprocessing import out_of_distribution, to_feature_matrix, typicality_score

CSV = (
    "row_id,pressure,temperature,vibration,conductivity,contact_duration\n"
    "1,229.8,27.42,2741.3,1.62e-12,0.151\n"  # glass-like
    "2,248.1,23.05,2655.0,2.4e6,0.118\n"  # steel-like
    "3,33.9,32.31,21.7,3.3e-11,1.18\n"  # fabric-like
)
ROWS = [
    {"pressure": 229.8, "temperature": 27.42, "vibration": 2741.3, "conductivity": 1.62e-12, "contact_duration": 0.151},
    {"pressure": 248.1, "temperature": 23.05, "vibration": 2655.0, "conductivity": 2.4e6, "contact_duration": 0.118},
    {"pressure": 33.9, "temperature": 32.31, "vibration": 21.7, "conductivity": 3.3e-11, "contact_duration": 1.18},
]


def expected_for(registry, features: dict, object_id=None):
    """Independent recomputation straight from the persisted model artifact."""
    model = registry.model
    proba = model.pipeline.predict_proba(to_feature_matrix([features]))[0]
    probs = {c: float(p) for c, p in zip(model.classes, proba)}
    material = max(probs, key=probs.get)
    meta = registry.metadata
    typ = (typicality_score(features, meta["class_feature_stats"][material]), meta["typicality_thresholds"][material])
    ood = out_of_distribution(features, meta["feature_ranges"])
    decision, command = GripEngine(meta["class_feature_stats"]).decide(probs, features, object_id, ood, typ)
    return probs, material, decision, command


def upload(client, headers):
    r = client.post("/api/upload", headers=headers, files={"file": ("examiner.csv", CSV.encode(), "text/csv")})
    assert r.status_code == 201, r.text
    return r.json()


def test_uploaded_row_travels_through_the_real_pipeline(client, user_headers, registry):
    # UPLOAD -> PARSE -> VALIDATE -> DISPLAY
    ds = upload(client, user_headers)
    assert ds["row_count"] == 3
    assert ds["summary"]["valid_rows"] + ds["summary"]["warning_rows"] == 3
    assert ds["mapping"]["features"] == {f: f for f in FEATURES}
    preview_row1 = ds["preview"][0]
    assert preview_row1["row_id"] == "1"
    assert preview_row1["features"] == ROWS[0]  # displayed values are the exact CSV values

    # SELECT ROW 1 -> SIMULATE THIS SAMPLE
    r = client.post(f"/api/datasets/{ds['id']}/rows/0/simulate", headers=user_headers, json={})
    assert r.status_code == 200, r.text
    out = r.json()

    # The exact row entered the pipeline (no substitution, no demo values).
    assert out["sample"] == ROWS[0]
    assert out["data_source"] == "UPLOADED"
    assert out["dataset_ref"] == {"dataset_id": ds["id"], "row_index": 0, "row_id": "1"}

    # ACTUAL RANDOM FOREST -> ACTUAL PROBABILITIES -> ACTUAL CONFIDENCE
    probs, material, decision, command = expected_for(registry, ROWS[0])
    pred = out["prediction"]
    assert pred["material"] == material
    for cls, p in probs.items():
        assert pred["probabilities"][cls] == pytest.approx(p, abs=1e-4)
    assert pred["confidence"] == pytest.approx(max(probs.values()), abs=1e-4)
    assert sum(pred["probabilities"].values()) == pytest.approx(1.0, abs=1e-3)
    assert pred["is_uncertain"] == (max(probs.values()) < 0.6)

    # GRIP ENGINE -> SIMULATION COMMAND
    grip = out["grip"]
    assert grip["grip_percent"] == decision.grip_percent
    assert grip["grip_mode"] == decision.grip_mode
    assert grip["safety_status"] == decision.safety_status
    assert grip["base_grip"] == decision.base_grip
    assert out["command"] == command.to_dict()
    assert out["command"]["object_id"] == decision.object_id

    # Every stage reported, with real timings.
    assert [s["stage"] for s in out["trace"]] == ["validation", "preprocessing", "inference", "recognition", "grip", "command"]
    assert out["model_version"] == registry.metadata["version"]

    # SAVE HISTORY
    assert out["persisted"] is True
    h = client.get(f"/api/history/{out['id']}", headers=user_headers).json()
    assert h["data_source"] == "UPLOADED"
    assert h["features"] == ROWS[0]
    assert h["predicted_material"] == material
    assert h["confidence"] == pytest.approx(max(probs.values()), abs=1e-6)
    assert h["grip_percent"] == decision.grip_percent
    assert h["dataset_id"] == ds["id"] and h["row_ref"] == "0:1"


def test_different_rows_produce_row_specific_results(client, user_headers, registry):
    ds = upload(client, user_headers)
    outs = [client.post(f"/api/datasets/{ds['id']}/rows/{i}/simulate", headers=user_headers, json={"persist": False}).json() for i in range(3)]
    materials = [o["prediction"]["material"] for o in outs]
    assert materials == ["Glass", "Steel", "Fabric"]
    grips = [o["grip"]["grip_percent"] for o in outs]
    assert grips[1] > grips[0] and grips[1] > grips[2]  # steel firm, glass/fabric gentle
    for i, o in enumerate(outs):
        assert o["sample"] == ROWS[i]
        assert o["persisted"] is False


def test_batch_and_single_row_agree(client, user_headers):
    ds = upload(client, user_headers)
    single = client.post(f"/api/datasets/{ds['id']}/rows/1/simulate", headers=user_headers, json={"persist": False}).json()
    batch = client.post("/api/process-batch", headers=user_headers, json={"dataset_id": ds["id"]}).json()
    assert batch["processed"] == 3 and batch["ok"] == 3
    row = batch["results"][1]
    assert row["row_id"] == "2"
    assert row["predicted_material"] == single["prediction"]["material"]
    assert row["confidence"] == pytest.approx(single["prediction"]["confidence"], abs=1e-4)
    assert row["grip_percent"] == single["grip"]["grip_percent"]
    assert batch["evaluation"] is None  # no labels -> no invented metrics


def test_live_sample_uses_the_same_pipeline(client, user_headers, registry):
    r = client.post(
        "/api/sensors/data",
        headers={"X-Device-Key": "test-device-key"},
        json={"device_id": "esp32-test", "samples": [ROWS[1]]},
    )
    assert r.status_code == 200, r.text
    seq = r.json()["results"][0]["seq"]
    live = r.json()["results"][0]["prediction"]
    out = client.post(f"/api/sensors/live/{seq}/predict", headers=user_headers, json={}).json()
    probs, material, decision, _ = expected_for(registry, ROWS[1])
    assert live["material"] == out["prediction"]["material"] == material
    assert live["grip_percent"] == out["grip"]["grip_percent"] == decision.grip_percent
    assert out["data_source"] == "LIVE" and out["sample"] == ROWS[1]


def test_simulated_source_uses_the_same_pipeline(client, user_headers, registry):
    sample = client.post("/api/sensors/simulated/sample", headers=user_headers, json={"object_id": "glass", "seed": 11}).json()
    features = sample["reading"]["features"]
    assert sample["reading"]["source"] == "SIMULATED" and sample["reading"]["ground_truth"] == "Glass"
    out = client.post(
        "/api/predict",
        headers=user_headers,
        json={"features": features, "data_source": "SIMULATED", "object_id": "glass", "ground_truth": "Glass"},
    ).json()
    probs, material, decision, command = expected_for(registry, features, "glass")
    assert out["prediction"]["material"] == material
    assert out["grip"]["grip_percent"] == decision.grip_percent
    assert out["command"] == command.to_dict()
