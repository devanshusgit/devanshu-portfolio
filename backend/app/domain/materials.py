"""Canonical material and sensor-feature definitions.

Everything that needs to know "which materials exist" or "which features does the
model consume, in which order and in which unit" imports from this module, so the
training pipeline, the inference pipeline, the CSV/JSON importer and the API all
agree on one definition.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class DataSource(str, Enum):
    SIMULATED = "SIMULATED"
    UPLOADED = "UPLOADED"
    LIVE = "LIVE"


# Order matters: it defines the column order of the model's feature matrix.
FEATURES: tuple[str, ...] = ("pressure", "temperature", "vibration", "conductivity", "contact_duration")

MATERIALS: tuple[str, ...] = ("Glass", "Steel", "Plastic", "Wood", "Rubber", "Fabric")


@dataclass(frozen=True)
class FeatureSpec:
    name: str
    label: str
    unit: str
    description: str
    # Hard physical bounds. A value outside these bounds is rejected as invalid
    # (it cannot be a reading from the modelled tactile sensor).
    hard_min: float
    hard_max: float
    # Whether the value spans many orders of magnitude (UI uses a log slider).
    log_scale: bool = False


FEATURE_SPECS: dict[str, FeatureSpec] = {
    "pressure": FeatureSpec(
        name="pressure",
        label="Contact pressure",
        unit="kPa",
        description=(
            "Mean fingertip contact pressure during a standardised ~2 N probing press. "
            "Stiff objects concentrate the load on a small contact patch (high pressure); "
            "compliant objects deform and spread it (low pressure)."
        ),
        hard_min=0.0,
        hard_max=5000.0,
    ),
    "temperature": FeatureSpec(
        name="temperature",
        label="Contact temperature",
        unit="°C",
        description=(
            "Fingertip/object interface temperature. The fingertip is held near skin "
            "temperature; materials with high thermal effusivity (metals, glass) pull it "
            "towards ambient and feel cold."
        ),
        hard_min=-40.0,
        hard_max=150.0,
    ),
    "vibration": FeatureSpec(
        name="vibration",
        label="Vibration frequency",
        unit="Hz",
        description=(
            "Dominant frequency of the micro-vibration picked up by the fingertip "
            "accelerometer during a short tap-and-slide. Rigid, dense materials ring at "
            "high frequency; damped materials (rubber, fabric) respond at low frequency."
        ),
        hard_min=0.0,
        hard_max=50000.0,
    ),
    "conductivity": FeatureSpec(
        name="conductivity",
        label="Electrical conductivity",
        unit="S/m",
        description=(
            "Surface electrical conductivity measured between two fingertip electrodes. "
            "Spans ~18 orders of magnitude (metals ~10^6 S/m, insulators near the sensor "
            "noise floor ~10^-12 S/m); the model consumes log10 of this value."
        ),
        hard_min=0.0,
        hard_max=1e9,
        log_scale=True,
    ),
    "contact_duration": FeatureSpec(
        name="contact_duration",
        label="Contact settling time",
        unit="s",
        description=(
            "Time for the contact reading to settle after touch-down. Viscoelastic "
            "materials creep and take longer to settle than rigid ones."
        ),
        hard_min=0.0,
        hard_max=60.0,
    ),
}


@dataclass(frozen=True)
class MaterialSpec:
    name: str
    # Normalised base grip (0-100 %). NOT a physical force in newtons.
    base_grip: float
    # Grip-percentage points removed to protect fragile materials.
    fragility_points: float
    grip_mode: str
    grip_mode_label: str
    # Mechanical compliance 0..1 used to visualise object deformation in 3D.
    compliance: float
    description: str
    appearance: str


MATERIAL_SPECS: dict[str, MaterialSpec] = {
    "Glass": MaterialSpec(
        "Glass", 25.0, 4.0, "GENTLE", "Gentle", 0.0,
        "Brittle, rigid, smooth. Fails suddenly under concentrated load.",
        "transparent",
    ),
    "Steel": MaterialSpec(
        "Steel", 75.0, 0.0, "FIRM_RIGID", "Firm (rigid)", 0.0,
        "Rigid, dense, conductive. Tolerates high grip; smooth surface can slip.",
        "metallic",
    ),
    "Plastic": MaterialSpec(
        "Plastic", 45.0, 1.5, "MODERATE", "Moderate", 0.12,
        "Semi-rigid polymer. Thin walls can buckle under excessive grip.",
        "glossy",
    ),
    "Wood": MaterialSpec(
        "Wood", 65.0, 0.0, "FIRM", "Firm", 0.02,
        "Rigid, textured, good friction. Tolerates a strong grip.",
        "grain",
    ),
    "Rubber": MaterialSpec(
        "Rubber", 50.0, 0.0, "MODERATE_FIRM", "Moderate-firm", 0.35,
        "Elastic and compliant with high friction; deforms visibly under load.",
        "matte",
    ),
    "Fabric": MaterialSpec(
        "Fabric", 20.0, 0.5, "LIGHT", "Light", 0.55,
        "Very compliant, low stiffness. Needs only light pressure to hold.",
        "soft",
    ),
}

CONSERVATIVE_MODE = ("CONSERVATIVE", "Conservative")

# Confidence policy (spec): >= 80 % HIGH, 60-79 % MODERATE, < 60 % LOW / uncertain.
HIGH_CONFIDENCE = 0.80
MODERATE_CONFIDENCE = 0.60


MATERIAL_ALIASES: dict[str, str] = {
    "glass": "Glass",
    "steel": "Steel",
    "stainless": "Steel",
    "stainless steel": "Steel",
    "metal": "Steel",
    "iron": "Steel",
    "plastic": "Plastic",
    "abs": "Plastic",
    "pla": "Plastic",
    "pet": "Plastic",
    "polymer": "Plastic",
    "polypropylene": "Plastic",
    "wood": "Wood",
    "wooden": "Wood",
    "timber": "Wood",
    "rubber": "Rubber",
    "silicone": "Rubber",
    "elastomer": "Rubber",
    "fabric": "Fabric",
    "cloth": "Fabric",
    "textile": "Fabric",
    "cotton": "Fabric",
    "foam": "Fabric",
}


def normalize_material(label: object) -> str | None:
    """Map a free-text ground-truth label to a canonical material, or None."""
    if label is None:
        return None
    text = str(label).strip().lower().replace("_", " ").replace("-", " ")
    if not text:
        return None
    return MATERIAL_ALIASES.get(text)


def confidence_level(confidence: float) -> str:
    if confidence >= HIGH_CONFIDENCE:
        return "HIGH"
    if confidence >= MODERATE_CONFIDENCE:
        return "MODERATE"
    return "LOW"
