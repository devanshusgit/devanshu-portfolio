"""Grip Engine: converts a material prediction into a safe grip decision.

    grip = material_base + sensor_adjustment - fragility_protection + confidence_adjustment
    grip = clamp(grip, 0, 100)

All grip values are NORMALISED SIMULATION PERCENTAGES (0-100 % of the virtual
actuator's range). They are not forces in newtons and have not been calibrated
against any physical prosthesis.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Mapping

from app.domain.materials import (
    CONSERVATIVE_MODE,
    FEATURE_SPECS,
    MATERIAL_SPECS,
    confidence_level,
)
from app.domain.objects import DEFAULT_OBJECT_FOR_MATERIAL, FINGERS, OBJECTS, VirtualObject
from app.ml.preprocessing import model_space

# Sensor adjustment: grip-percentage points per standard deviation that the reading
# deviates from what is typical for the predicted material.
SENSOR_GAINS: dict[str, tuple[float, str]] = {
    "pressure": (2.0, "contact is stiffer than typical -> object tolerates more grip"),
    "vibration": (1.5, "higher-frequency (smoother) surface -> lower friction, more slip risk"),
    "contact_duration": (-1.5, "slower settling -> more compliant/viscoelastic, avoid crushing"),
}
SENSOR_Z_CLAMP = 3.0
SENSOR_ADJUSTMENT_LIMIT = 8.0

# Confidence policy.
MODERATE_PENALTY_SLOPE = 40.0  # points per unit of confidence below 0.80
PLAUSIBLE_PROBABILITY = 0.15  # classes at/above this are "plausible" when uncertain
LOW_CONFIDENCE_MARGIN = 5.0
CONSERVATIVE_GRIP_CAP = 35.0
OOD_PENALTY = 5.0
ATYPICAL_PENALTY = 8.0

OBJECT_FRAGILITY_POINTS = 3.0

THERMAL_HOT_C = 45.0
THERMAL_COLD_C = 5.0

CLOSURE_SPEED = {
    "GENTLE": 0.45,
    "LIGHT": 0.55,
    "MODERATE": 0.7,
    "MODERATE_FIRM": 0.75,
    "FIRM": 0.85,
    "FIRM_RIGID": 0.9,
    "CONSERVATIVE": 0.35,
}


@dataclass
class SafetyWarning:
    code: str
    severity: str  # INFO | CAUTION | WARNING
    message: str


@dataclass
class GripDecision:
    material: str
    is_uncertain: bool
    confidence: float
    confidence_level: str
    object_id: str
    object_auto_selected: bool
    base_grip: float
    sensor_adjustment: float
    sensor_breakdown: dict[str, float]
    fragility_protection: float
    confidence_adjustment: float
    raw_grip: float
    grip_percent: float
    grip_mode: str
    grip_mode_label: str
    grasp_profile: str
    grasp_type: str
    safety_status: str  # NOMINAL | CAUTION | WARNING
    warnings: list[SafetyWarning]
    action: str
    explanation: list[str]
    plausible_materials: list[str] = field(default_factory=list)
    structural_limit: float = 100.0
    typicality_score: float | None = None
    typicality_threshold: float | None = None

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["warnings"] = [asdict(w) for w in self.warnings]
        return d


@dataclass
class SimulationCommand:
    """Everything the 3D hand needs to execute the decision. The frontend animates
    this command; it does not re-derive any grip logic."""

    object_id: str
    profile_id: str
    grasp_type: str
    grip_percent: float
    finger_force: dict[str, float]  # normalised per-digit squeeze 0..1
    finger_spread: float
    closure_speed: float  # 0..1 (1 = fastest)
    palm_height_fraction: float
    hold_ms: int
    lift_height: float
    lift_speed: float
    lift_permitted: bool
    object_deformation: float  # visual compression of compliant objects 0..1
    sensor_intensity: float  # tactile marker intensity 0..1

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


class GripEngine:
    def __init__(self, class_feature_stats: Mapping[str, Mapping[str, Mapping[str, float]]] | None = None):
        # Per-class feature statistics from the trained model (model space).
        self.class_stats = class_feature_stats or {}

    # ----------------------------------------------------------- components
    def sensor_adjustment(self, material: str, features: Mapping[str, float]) -> tuple[float, dict[str, float]]:
        stats = self.class_stats.get(material, {})
        breakdown: dict[str, float] = {}
        for feature, (gain, _why) in SENSOR_GAINS.items():
            s = stats.get(feature)
            if not s or s.get("std", 0) <= 1e-9:
                breakdown[feature] = 0.0
                continue
            z = (model_space(feature, features[feature]) - s["mean"]) / s["std"]
            z = max(-SENSOR_Z_CLAMP, min(SENSOR_Z_CLAMP, z))
            breakdown[feature] = round(gain * z, 2)
        total = sum(breakdown.values())
        total = max(-SENSOR_ADJUSTMENT_LIMIT, min(SENSOR_ADJUSTMENT_LIMIT, total))
        return round(total, 2), breakdown

    @staticmethod
    def fragility(materials: list[str], obj: VirtualObject) -> float:
        material_pts = max(MATERIAL_SPECS[m].fragility_points for m in materials)
        return round(material_pts + OBJECT_FRAGILITY_POINTS * obj.profile.object_fragility, 2)

    # ---------------------------------------------------------------- decide
    def decide(
        self,
        probabilities: Mapping[str, float],
        features: Mapping[str, float],
        object_id: str | None = None,
        ood_features: list[dict] | None = None,
        typicality: tuple[float, float] | None = None,
    ) -> tuple[GripDecision, SimulationCommand]:
        """Decide grip from class probabilities and the (validated) sensor reading.

        ``typicality`` is ``(score, threshold)`` of the sample relative to the predicted
        class's training distribution; a score above the threshold means the reading is
        unlike anything the class was trained on (novelty), regardless of confidence.
        """
        ranked = sorted(probabilities.items(), key=lambda kv: kv[1], reverse=True)
        material, confidence = ranked[0]
        level = confidence_level(confidence)
        uncertain = level == "LOW"
        ood_features = ood_features or []

        auto_object = object_id is None or object_id not in OBJECTS
        obj = OBJECTS[DEFAULT_OBJECT_FOR_MATERIAL[material]] if auto_object else OBJECTS[object_id]
        spec = MATERIAL_SPECS[material]

        base = spec.base_grip
        sensor_adj, breakdown = self.sensor_adjustment(material, features)
        explanation = [f"Base grip for {material}: {base:.0f}% (normalised material baseline)."]
        if sensor_adj:
            parts = ", ".join(f"{FEATURE_SPECS[f].label.lower()} {v:+.1f}" for f, v in breakdown.items() if v)
            explanation.append(f"Sensor adjustment {sensor_adj:+.1f}% from readings vs typical {material} ({parts}).")
        else:
            explanation.append("Sensor readings are typical for this material: no sensor adjustment.")

        warnings: list[SafetyWarning] = []
        plausible = [m for m, p in ranked if p >= PLAUSIBLE_PROBABILITY] or [material]
        if material not in plausible:
            plausible.insert(0, material)

        if uncertain:
            fragility = self.fragility(plausible, obj)
            target_base = min(MATERIAL_SPECS[m].base_grip for m in plausible)
            conf_adj = (target_base - base) - LOW_CONFIDENCE_MARGIN
            explanation.append(
                f"LOW confidence ({confidence:.0%}): treating the object as the most fragile plausible "
                f"material ({', '.join(plausible)}) -> confidence adjustment {conf_adj:+.1f}%."
            )
            warnings.append(
                SafetyWarning(
                    "LOW_CONFIDENCE",
                    "WARNING",
                    f"Material uncertain ({confidence:.0%} confidence). Conservative grip with reduced force.",
                )
            )
        else:
            fragility = self.fragility([material], obj)
            if level == "MODERATE":
                conf_adj = -MODERATE_PENALTY_SLOPE * (0.80 - confidence)
                explanation.append(
                    f"MODERATE confidence ({confidence:.0%}): grip reduced by {abs(conf_adj):.1f}% as a safety margin."
                )
                warnings.append(
                    SafetyWarning(
                        "MODERATE_CONFIDENCE",
                        "CAUTION",
                        f"Moderate confidence ({confidence:.0%}). Grip reduced as a precaution.",
                    )
                )
            else:
                conf_adj = 0.0
                explanation.append(f"HIGH confidence ({confidence:.0%}): no confidence penalty.")

        if fragility:
            explanation.append(
                f"Fragility protection -{fragility:.1f}% (material + {obj.name.lower()} structure)."
            )

        if ood_features:
            conf_adj -= OOD_PENALTY
            names = ", ".join(FEATURE_SPECS[o["feature"]].label.lower() for o in ood_features)
            warnings.append(
                SafetyWarning(
                    "OUT_OF_DISTRIBUTION",
                    "CAUTION",
                    f"Reading outside the training range ({names}); prediction may be unreliable.",
                )
            )
            explanation.append(f"Out-of-distribution input ({names}): additional -{OOD_PENALTY:.0f}% margin.")

        atypical = typicality is not None and typicality[0] > typicality[1]
        if atypical and not uncertain:
            conf_adj -= ATYPICAL_PENALTY
            warnings.append(
                SafetyWarning(
                    "ATYPICAL_SAMPLE",
                    "CAUTION",
                    f"Readings are atypical for {material} (novelty score {typicality[0]:.1f} > "
                    f"{typicality[1]:.1f}); possible poor contact or unfamiliar object.",
                )
            )
            explanation.append(
                f"Novelty check: sample is atypical for {material} despite {confidence:.0%} confidence "
                f"-> additional -{ATYPICAL_PENALTY:.0f}% margin."
            )

        raw = base + sensor_adj - fragility + conf_adj
        grip = max(0.0, min(100.0, raw))
        if uncertain and grip > CONSERVATIVE_GRIP_CAP:
            grip = CONSERVATIVE_GRIP_CAP
            explanation.append(f"Conservative cap applied: grip limited to {CONSERVATIVE_GRIP_CAP:.0f}%.")
        structural_cap = obj.profile.max_safe_grip
        capped_by_object = grip > structural_cap
        if capped_by_object:
            grip = structural_cap
            explanation.append(
                f"Object-structure limit: {obj.name.lower()} form allows at most {structural_cap:.0f}% grip."
            )
            warnings.append(
                SafetyWarning(
                    "OBJECT_FORCE_LIMIT",
                    "CAUTION",
                    f"Grip limited to {structural_cap:.0f}% by the {obj.name.lower()}'s structural limit.",
                )
            )
        grip = round(grip, 1)

        if uncertain:
            mode, mode_label = CONSERVATIVE_MODE
        else:
            mode, mode_label = spec.grip_mode, spec.grip_mode_label

        if material == "Glass" or (uncertain and "Glass" in plausible):
            warnings.append(SafetyWarning("FRAGILE_MATERIAL", "CAUTION", "Fragile material: gentle, slow closure."))
        if obj.profile.object_fragility >= 0.5 and not auto_object:
            warnings.append(
                SafetyWarning("FRAGILE_OBJECT", "INFO", f"{obj.name} has a fragile structure; force limited.")
            )
        temperature = features["temperature"]
        if temperature >= THERMAL_HOT_C:
            warnings.append(SafetyWarning("HOT_SURFACE", "WARNING", f"Surface at {temperature:.1f} °C: thermal hazard."))
        elif temperature <= THERMAL_COLD_C:
            warnings.append(SafetyWarning("COLD_SURFACE", "CAUTION", f"Surface at {temperature:.1f} °C: very cold."))

        severities = {w.severity for w in warnings}
        status = "WARNING" if "WARNING" in severities else "CAUTION" if "CAUTION" in severities else "NOMINAL"

        explanation.append(f"Final grip {grip:.1f}% (clamped to 0-100 %), mode {mode_label}.")
        if uncertain:
            action = (
                f"Conservative {obj.profile.grasp_type.lower()} grasp at {grip:.0f}% grip: slow closure, "
                "reduced force, slow lift. Verify material before relying on the grasp."
            )
        else:
            action = f"Execute {obj.profile.name.lower()} at {grip:.0f}% normalised grip ({mode_label.lower()} closure)."

        decision = GripDecision(
            material=material,
            is_uncertain=uncertain,
            confidence=round(confidence, 4),
            confidence_level=level,
            object_id=obj.id,
            object_auto_selected=auto_object,
            base_grip=base,
            sensor_adjustment=sensor_adj,
            sensor_breakdown=breakdown,
            fragility_protection=fragility,
            confidence_adjustment=round(conf_adj, 2),
            raw_grip=round(raw, 2),
            grip_percent=grip,
            grip_mode=mode,
            grip_mode_label=mode_label,
            grasp_profile=obj.profile.name,
            grasp_type=obj.profile.grasp_type,
            safety_status=status,
            warnings=warnings,
            action=action,
            explanation=explanation,
            plausible_materials=plausible if uncertain else [material],
            structural_limit=structural_cap,
            typicality_score=round(typicality[0], 3) if typicality else None,
            typicality_threshold=round(typicality[1], 3) if typicality else None,
        )
        return decision, self.command(decision, obj)

    # --------------------------------------------------------------- command
    @staticmethod
    def command(decision: GripDecision, obj: VirtualObject) -> SimulationCommand:
        g = decision.grip_percent / 100.0
        profile = obj.profile
        speed = CLOSURE_SPEED[decision.grip_mode] * profile.closure_speed_factor
        compliance = MATERIAL_SPECS[decision.material].compliance if not decision.is_uncertain else 0.0
        return SimulationCommand(
            object_id=obj.id,
            profile_id=profile.id,
            grasp_type=profile.grasp_type,
            grip_percent=decision.grip_percent,
            finger_force={f: round(profile.finger_participation[f] * g, 3) for f in FINGERS},
            finger_spread=profile.finger_spread,
            closure_speed=round(max(0.15, min(1.0, speed)), 3),
            palm_height_fraction=profile.palm_height_fraction,
            hold_ms=1400 if not decision.is_uncertain else 1800,
            lift_height=profile.lift_height * (0.6 if decision.is_uncertain else 1.0),
            lift_speed=0.5 if decision.is_uncertain else 1.0,
            lift_permitted=True,
            object_deformation=round(compliance * g, 3),
            sensor_intensity=round(0.25 + 0.75 * g, 3),
        )
