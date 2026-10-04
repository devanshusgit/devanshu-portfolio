"""Virtual object catalogue and object-specific grasp profiles.

Dimensions are in scene units (1 unit ~= 10 cm) and are served to the frontend via
``GET /api/objects`` so the 3D scene renders exactly the geometry the grasp profile
was designed for.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

FINGERS: tuple[str, ...] = ("thumb", "index", "middle", "ring", "little")


@dataclass(frozen=True)
class GraspProfile:
    id: str
    name: str
    grasp_type: str
    description: str
    # How strongly each digit participates in the grasp (0 = not used, 1 = full).
    finger_participation: dict[str, float]
    # Multiplier applied to the grip engine's closure speed (fragile => slower).
    closure_speed_factor: float
    # Finger spread / abduction in radians (spherical grasps open the hand wider).
    finger_spread: float
    # Height of the palm centre as a fraction of the object height.
    palm_height_fraction: float
    # How far (scene units) the object is lifted during LIFTING.
    lift_height: float
    # Structural fragility of the object form (thin walls, etc.) 0..1.
    object_fragility: float
    # Hard upper limit on grip for this object form, independent of the material
    # prediction (defence in depth against a confident misclassification).
    max_safe_grip: float = 100.0


@dataclass(frozen=True)
class VirtualObject:
    id: str
    name: str
    shape: str
    default_material: str
    dimensions: dict[str, float]
    description: str
    profile: GraspProfile
    tags: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


def _p(**kw: float) -> dict[str, float]:
    return {f: float(kw.get(f, 0.0)) for f in FINGERS}


OBJECTS: dict[str, VirtualObject] = {
    "glass": VirtualObject(
        id="glass",
        name="Glass",
        shape="cylinder",
        default_material="Glass",
        dimensions={"radius": 0.34, "height": 0.95},
        description="Thin-walled drinking glass (tumbler).",
        profile=GraspProfile(
            id="precision_cylindrical",
            name="Gentle precision cylindrical grasp",
            grasp_type="Precision cylindrical",
            description="Thumb opposes index and middle; ring and little fingers support lightly. Slow closure.",
            finger_participation=_p(thumb=1.0, index=1.0, middle=0.9, ring=0.55, little=0.3),
            closure_speed_factor=0.7,
            finger_spread=0.04,
            palm_height_fraction=0.48,
            lift_height=0.55,
            object_fragility=1.0,
            max_safe_grip=40.0,
        ),
    ),
    "bottle": VirtualObject(
        id="bottle",
        name="Bottle",
        shape="bottle",
        default_material="Plastic",
        dimensions={"radius": 0.32, "height": 1.7, "neck_radius": 0.13, "shoulder": 1.15},
        description="Tall bottle with a narrow neck; grasped around the body.",
        profile=GraspProfile(
            id="tall_cylindrical",
            name="Tall cylindrical grasp",
            grasp_type="Tall cylindrical",
            description="Full-hand wrap around the bottle body below the shoulder.",
            finger_participation=_p(thumb=1.0, index=1.0, middle=1.0, ring=0.9, little=0.75),
            closure_speed_factor=0.9,
            finger_spread=0.02,
            palm_height_fraction=0.36,
            lift_height=0.5,
            object_fragility=0.5,
            max_safe_grip=70.0,
        ),
    ),
    "cube": VirtualObject(
        id="cube",
        name="Cube",
        shape="box",
        default_material="Wood",
        dimensions={"size": 0.62, "height": 0.62},
        description="Solid cube grasped across two parallel faces.",
        profile=GraspProfile(
            id="power_side",
            name="Power / side grasp",
            grasp_type="Power side",
            description="Flat-palm power grasp; fingers press one face, thumb the opposite edge.",
            finger_participation=_p(thumb=1.0, index=1.0, middle=1.0, ring=1.0, little=0.85),
            closure_speed_factor=1.0,
            finger_spread=0.0,
            palm_height_fraction=0.5,
            lift_height=0.5,
            object_fragility=0.0,
        ),
    ),
    "ball": VirtualObject(
        id="ball",
        name="Ball",
        shape="sphere",
        default_material="Rubber",
        dimensions={"radius": 0.4, "height": 0.8},
        description="Spherical ball.",
        profile=GraspProfile(
            id="spherical",
            name="Spherical / enclosing grasp",
            grasp_type="Spherical enclosing",
            description="Fingers spread and curl around the sphere; thumb opposes from the far side.",
            finger_participation=_p(thumb=1.0, index=1.0, middle=1.0, ring=0.95, little=0.85),
            closure_speed_factor=0.9,
            finger_spread=0.16,
            palm_height_fraction=0.5,
            lift_height=0.5,
            object_fragility=0.0,
        ),
    ),
    "container": VirtualObject(
        id="container",
        name="Plastic Container",
        shape="container",
        default_material="Plastic",
        dimensions={"radius": 0.45, "height": 0.8, "lid_height": 0.1},
        description="Thin-walled plastic food container with a lid.",
        profile=GraspProfile(
            id="compliant_cylindrical",
            name="Compliant moderate cylindrical grasp",
            grasp_type="Compliant cylindrical",
            description="Moderate wrap that avoids buckling the thin container walls.",
            finger_participation=_p(thumb=1.0, index=1.0, middle=1.0, ring=0.8, little=0.6),
            closure_speed_factor=0.8,
            finger_spread=0.06,
            palm_height_fraction=0.45,
            lift_height=0.5,
            object_fragility=0.6,
            max_safe_grip=55.0,
        ),
    ),
    "steel": VirtualObject(
        id="steel",
        name="Steel Object",
        shape="rod",
        default_material="Steel",
        dimensions={"radius": 0.26, "height": 1.15},
        description="Machined steel cylinder (heavy, rigid, smooth).",
        profile=GraspProfile(
            id="firm_rigid",
            name="Firm rigid grasp",
            grasp_type="Firm rigid power",
            description="Full power wrap with all digits; fast, firm closure to prevent slip.",
            finger_participation=_p(thumb=1.0, index=1.0, middle=1.0, ring=1.0, little=1.0),
            closure_speed_factor=1.1,
            finger_spread=0.0,
            palm_height_fraction=0.5,
            lift_height=0.45,
            object_fragility=0.0,
        ),
    ),
}

# When a sample has no associated object (e.g. an uploaded CSV row) the grip engine
# picks the object whose form best matches the predicted material.
DEFAULT_OBJECT_FOR_MATERIAL: dict[str, str] = {
    "Glass": "glass",
    "Steel": "steel",
    "Plastic": "container",
    "Wood": "cube",
    "Rubber": "ball",
    "Fabric": "ball",
}


def get_object(object_id: str | None) -> VirtualObject | None:
    if object_id is None:
        return None
    return OBJECTS.get(object_id)
