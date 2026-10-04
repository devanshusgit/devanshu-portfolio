"""Grip engine: material behaviour, confidence policy, safety logic, clamping."""

from __future__ import annotations

import numpy as np
import pytest

from app.domain.materials import MATERIAL_SPECS, MATERIALS
from app.grip.engine import CONSERVATIVE_GRIP_CAP, GripEngine
from app.sensors.physics import generate_readings


@pytest.fixture(scope="module")
def engine(registry) -> GripEngine:
    return GripEngine(registry.metadata["class_feature_stats"])


def typical(registry, material: str) -> dict[str, float]:
    stats = registry.metadata["class_feature_stats"][material]
    return {f: s["raw_median"] for f, s in stats.items()}


def certain(material: str) -> dict[str, float]:
    return {m: (1.0 if m == material else 0.0) for m in MATERIALS}


def test_grip_ordering_follows_material_safety_policy(engine, registry):
    grips = {m: engine.decide(certain(m), typical(registry, m))[0].grip_percent for m in MATERIALS}
    assert grips["Fabric"] < grips["Plastic"] < grips["Rubber"] < grips["Wood"] < grips["Steel"]
    assert grips["Glass"] < grips["Plastic"]
    assert grips["Glass"] <= 30  # gentle handling
    assert grips["Steel"] >= 65  # firm grip


def test_grip_formula_components_add_up(engine, registry):
    for m in MATERIALS:
        d, _ = engine.decide(certain(m), typical(registry, m), object_id="cube")
        assert d.base_grip == MATERIAL_SPECS[m].base_grip
        assert d.raw_grip == pytest.approx(d.base_grip + d.sensor_adjustment - d.fragility_protection + d.confidence_adjustment, abs=0.02)
        assert d.grip_percent == pytest.approx(min(max(d.raw_grip, 0), 100, d.structural_limit), abs=0.06)
        assert 0 <= d.grip_percent <= 100


def test_typical_readings_need_little_sensor_adjustment(engine, registry):
    for m in MATERIALS:
        d, _ = engine.decide(certain(m), typical(registry, m))
        assert abs(d.sensor_adjustment) <= 3.0


def test_sensor_adjustment_is_bounded(engine, registry):
    extreme = {**typical(registry, "Wood"), "pressure": 4000.0, "vibration": 40000.0, "contact_duration": 0.0}
    d, _ = engine.decide(certain("Wood"), extreme, object_id="cube")
    assert -8.0 <= d.sensor_adjustment <= 8.0


def test_high_confidence_has_no_penalty(engine, registry):
    d, _ = engine.decide({**certain("Steel"), "Steel": 0.9, "Wood": 0.1}, typical(registry, "Steel"))
    assert d.confidence_level == "HIGH"
    assert d.confidence_adjustment == 0
    assert not d.is_uncertain


def test_moderate_confidence_reduces_grip(engine, registry):
    feats = typical(registry, "Steel")
    high, _ = engine.decide({"Steel": 0.95, "Wood": 0.05, **{m: 0 for m in MATERIALS if m not in ("Steel", "Wood")}}, feats)
    mod, _ = engine.decide({"Steel": 0.65, "Wood": 0.35, **{m: 0 for m in MATERIALS if m not in ("Steel", "Wood")}}, feats)
    assert mod.confidence_level == "MODERATE"
    assert mod.grip_percent < high.grip_percent
    assert any(w.code == "MODERATE_CONFIDENCE" for w in mod.warnings)
    assert mod.safety_status in ("CAUTION", "WARNING")


def test_low_confidence_is_uncertain_and_conservative(engine, registry):
    probs = {m: 0.0 for m in MATERIALS}
    probs.update({"Steel": 0.45, "Glass": 0.40, "Wood": 0.15})
    d, cmd = engine.decide(probs, typical(registry, "Steel"))
    assert d.is_uncertain and d.confidence_level == "LOW"
    assert d.grip_mode == "CONSERVATIVE"
    assert d.grip_percent <= CONSERVATIVE_GRIP_CAP
    # Treated as the most fragile plausible material (Glass), not as Steel.
    assert "Glass" in d.plausible_materials
    assert d.grip_percent <= MATERIAL_SPECS["Glass"].base_grip
    assert d.safety_status == "WARNING"
    assert any(w.code == "LOW_CONFIDENCE" for w in d.warnings)
    assert cmd.closure_speed < 0.4 and cmd.lift_speed < 1.0


def test_object_structural_limit_protects_fragile_forms(engine, registry):
    # A confident (but possibly wrong) Steel prediction on a thin glass form is capped.
    d, _ = engine.decide(certain("Steel"), typical(registry, "Steel"), object_id="glass")
    assert d.grip_percent <= 40.0
    assert any(w.code == "OBJECT_FORCE_LIMIT" for w in d.warnings)


def test_out_of_distribution_adds_margin(engine, registry):
    feats = typical(registry, "Wood")
    base, _ = engine.decide(certain("Wood"), feats, object_id="cube")
    ood, _ = engine.decide(certain("Wood"), feats, object_id="cube", ood_features=[{"feature": "temperature"}])
    assert ood.grip_percent < base.grip_percent
    assert any(w.code == "OUT_OF_DISTRIBUTION" for w in ood.warnings)


def test_thermal_warning(engine, registry):
    d, _ = engine.decide(certain("Steel"), {**typical(registry, "Steel"), "temperature": 60.0})
    assert any(w.code == "HOT_SURFACE" for w in d.warnings)
    assert d.safety_status == "WARNING"


def test_command_reflects_grip(engine, registry):
    _, glass = engine.decide(certain("Glass"), typical(registry, "Glass"), object_id="glass")
    _, steel = engine.decide(certain("Steel"), typical(registry, "Steel"), object_id="steel")
    assert glass.grip_percent < steel.grip_percent
    assert glass.closure_speed < steel.closure_speed
    assert max(glass.finger_force.values()) < max(steel.finger_force.values())
    assert glass.profile_id == "precision_cylindrical"
    assert steel.profile_id == "firm_rigid"
    assert set(glass.finger_force) == {"thumb", "index", "middle", "ring", "little"}


def test_auto_object_selection_for_uploaded_rows(engine, registry):
    d, cmd = engine.decide(certain("Rubber"), typical(registry, "Rubber"), object_id=None)
    assert d.object_auto_selected and cmd.object_id == "ball"


def test_clamped_to_valid_range_on_random_inputs(engine):
    rng = np.random.default_rng(0)
    for _ in range(300):
        p = rng.dirichlet(np.ones(6))
        probs = dict(zip(MATERIALS, p))
        feats = {k: float(v[0]) for k, v in generate_readings([str(rng.choice(MATERIALS))], rng).items() if not k.startswith(("latent", "env"))}
        d, cmd = engine.decide(probs, feats, object_id=str(rng.choice(["glass", "bottle", "cube", "ball", "container", "steel"])))
        assert 0.0 <= d.grip_percent <= 100.0
        assert 0.0 < cmd.closure_speed <= 1.0
        assert all(0.0 <= v <= 1.0 for v in cmd.finger_force.values())
