"""Dataset generation, preprocessing, training, persistence and prediction."""

from __future__ import annotations

import math

import numpy as np
import pytest
from sklearn.metrics import accuracy_score
from sklearn.model_selection import train_test_split

from app.domain.materials import FEATURES, MATERIALS
from app.ml.dataset import generate_dataset
from app.ml.preprocessing import (
    SensorFeatureTransformer,
    out_of_distribution,
    to_feature_matrix,
    validate_sample,
)
from app.ml.registry import ModelRegistry
from app.ml.train import RF_PARAMS, load_model

GOOD = {"pressure": 230.0, "temperature": 27.5, "vibration": 2700.0, "conductivity": 1.5e-12, "contact_duration": 0.15}


# ------------------------------------------------------------------ validation
def test_validate_sample_accepts_numbers_and_numeric_strings():
    r = validate_sample({**GOOD, "pressure": "230.5", "extra": "ignored"})
    assert r.ok
    assert r.features["pressure"] == 230.5
    assert set(r.features) == set(FEATURES)


@pytest.mark.parametrize(
    "patch,code",
    [
        ({"pressure": None}, "missing"),
        ({"temperature": ""}, "missing"),
        ({"vibration": "NaN"}, "missing"),
        ({"vibration": "abc"}, "not_numeric"),
        ({"conductivity": float("inf")}, "not_finite"),
        ({"pressure": -5}, "out_of_bounds"),
        ({"temperature": 500}, "out_of_bounds"),
        ({"contact_duration": True}, "not_numeric"),
    ],
)
def test_validate_sample_rejects_bad_values(patch, code):
    r = validate_sample({**GOOD, **patch})
    assert not r.ok
    assert r.features is None
    assert r.errors[0].code == code


def test_validate_sample_reports_every_missing_feature():
    r = validate_sample({})
    assert [e.feature for e in r.errors] == list(FEATURES)


# --------------------------------------------------------------- preprocessing
def test_feature_transformer_log_transforms_conductivity_only():
    X = to_feature_matrix([GOOD, {**GOOD, "conductivity": 2.0e6}])
    Xt = SensorFeatureTransformer().fit(X).transform(X)
    idx = FEATURES.index("conductivity")
    assert Xt[0, idx] == pytest.approx(math.log10(1.5e-12))
    assert Xt[1, idx] == pytest.approx(math.log10(2.0e6))
    other = [i for i in range(len(FEATURES)) if i != idx]
    np.testing.assert_array_equal(Xt[:, other], X[:, other])
    assert X[0, idx] == 1.5e-12  # input not mutated


def test_feature_matrix_column_order_matches_feature_definition():
    X = to_feature_matrix([GOOD])
    assert X.shape == (1, 5)
    assert list(X[0]) == [GOOD[f] for f in FEATURES]


def test_out_of_distribution_flags_extreme_values(registry):
    ranges = registry.metadata["feature_ranges"]
    assert out_of_distribution(GOOD, ranges) == []
    flagged = out_of_distribution({**GOOD, "temperature": 90.0}, ranges)
    assert [f["feature"] for f in flagged] == ["temperature"]


# --------------------------------------------------------------------- dataset
def test_dataset_is_reproducible_and_balanced():
    a = generate_dataset(3000, seed=42)
    b = generate_dataset(3000, seed=42)
    c = generate_dataset(3000, seed=43)
    assert a.equals(b)
    assert not a.equals(c)
    assert len(a) == 3000
    assert set(a["material"].unique()) == set(MATERIALS)
    assert a["material"].value_counts().nunique() == 1  # perfectly balanced
    assert list(a.columns) == ["sample_id", *FEATURES, "material"]


def test_dataset_reflects_physics():
    df = generate_dataset(4800, seed=42)
    med = df.groupby("material").median(numeric_only=True)
    # metals pull the fingertip towards ambient temperature (high effusivity)
    assert med.loc["Steel", "temperature"] < med.loc["Glass", "temperature"] < med.loc["Fabric", "temperature"]
    # compliant materials spread the load -> lower contact pressure
    assert med.loc["Fabric", "pressure"] < med.loc["Rubber", "pressure"] < med.loc["Plastic", "pressure"]
    # steel is (usually) conductive
    assert med.loc["Steel", "conductivity"] > 1e3 > med.loc["Glass", "conductivity"]
    # viscoelastic materials settle slower
    assert med.loc["Fabric", "contact_duration"] > med.loc["Plastic", "contact_duration"] > med.loc["Steel", "contact_duration"]


# -------------------------------------------------------------------- training
def test_model_metadata_and_hyperparameters(registry):
    meta = registry.metadata
    clf = registry.model.pipeline.named_steps["classifier"]
    assert clf.n_estimators == 100 and clf.max_depth == 12 and clf.random_state == 42
    assert meta["params"] == RF_PARAMS
    assert sorted(meta["classes"]) == sorted(MATERIALS)
    cm = np.array(meta["confusion_matrix"]["matrix"])
    assert cm.shape == (6, 6)
    assert cm.sum() == meta["dataset"]["test_count"]
    assert meta["dataset"]["train_size"] + meta["dataset"]["test_count"] == meta["dataset"]["n_samples"]
    for key in ("accuracy", "precision_macro", "recall_macro", "f1_macro"):
        assert 0.0 <= meta["metrics"][key] <= 1.0


def test_reported_accuracy_is_reproducible_from_held_out_split(registry):
    """The stored accuracy must equal an independent recomputation on the test split."""
    meta = registry.metadata
    df = generate_dataset(meta["dataset"]["n_samples"], meta["dataset"]["seed"])
    X = df[list(FEATURES)].to_numpy(float)
    y = registry.model.label_encoder.transform(df["material"])
    _, X_test, _, y_test = train_test_split(
        X, y, test_size=meta["dataset"]["test_size"], random_state=meta["dataset"]["seed"], stratify=y
    )
    acc = accuracy_score(y_test, registry.model.pipeline.predict(X_test))
    assert acc == pytest.approx(meta["metrics"]["accuracy"])
    cm_diag = np.trace(np.array(meta["confusion_matrix"]["matrix"]))
    assert cm_diag / len(y_test) == pytest.approx(acc)
    # Honest goal check (documented target ~90 %): validated, not forced.
    assert acc > 0.9


def test_confidence_is_meaningful(registry):
    bands = {b["level"]: b for b in registry.metadata["confidence_bands"]}
    assert sum(b["count"] for b in bands.values()) == registry.metadata["dataset"]["test_count"]
    assert bands["HIGH"]["accuracy"] > bands["LOW"]["accuracy"]


def test_persistence_roundtrip_gives_identical_predictions(model_dir, registry):
    reloaded = load_model(model_dir)
    X = generate_dataset(300, seed=7)[list(FEATURES)].to_numpy(float)
    np.testing.assert_array_equal(
        reloaded.pipeline.predict_proba(X), registry.model.pipeline.predict_proba(X)
    )


def test_predict_proba_is_a_distribution(registry):
    inf = registry.predict_proba(to_feature_matrix([GOOD]))
    assert inf.probabilities.shape == (1, 6)
    assert inf.probabilities.sum() == pytest.approx(1.0)
    assert inf.classes == registry.metadata["classes"]
    assert inf.inference_ms >= 0 and inf.preprocess_ms >= 0


def test_registry_retrain_swaps_model(tmp_path):
    reg = ModelRegistry(tmp_path)
    assert not reg.ready
    meta = reg.train(n_samples=3000, seed=1)
    assert reg.ready and reg.metadata["version"] == meta["version"]
    assert meta["dataset"]["n_samples"] == 3000
    reg2 = ModelRegistry(tmp_path)
    assert reg2.load()
    assert reg2.metadata["version"] == meta["version"]
