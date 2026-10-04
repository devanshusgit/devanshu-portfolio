"""Physics-inspired tactile sensor model.

Readings are not drawn from arbitrary per-class random ranges. Each sample first
draws *latent physical properties* of the touched object (Young's modulus, density,
thermal effusivity, electrical conductivity, viscoelastic relaxation time, surface
finish), an *environment* (ambient temperature, humidity, probing force) and a
*contact quality*, and then computes what an idealised multi-modal fingertip sensor
would report:

* pressure      - Hertz-inspired: mean contact pressure grows with the effective
                  stiffness E* of the probe/object pair (stiff => small contact patch).
* temperature   - semi-infinite body contact temperature:
                  T_c = (e_s*T_s + e_o*T_o) / (e_s + e_o), e = thermal effusivity.
* vibration     - tap/slide response frequency ~ k * sqrt(E/rho) (speed of sound),
                  shifted down by material damping.
* conductivity  - true conductivity (+ humidity for hygroscopic materials, coatings,
                  conductive fillers) seen through partial electrode contact and a
                  sensor noise floor.
* contact_duration - settling time dominated by viscoelastic creep.

Real-world nuisances are modelled on purpose (painted steel, varnished wood,
carbon-filled rubber, poor contact, sensor noise) so the classification problem has
genuine overlap and the model's confidence is meaningful.

All values produced here are SIMULATED. They are not physical measurements.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.domain.materials import FEATURES, MATERIALS

# Fingertip sensor constants.
SENSOR_EFFUSIVITY = 1100.0  # W s^0.5 m^-2 K^-1 (skin-like silicone skin, actively warmed)
PROBE_MODULUS_GPA = 3.0  # rigid polymer sensing dome
NOMINAL_PROBE_FORCE_N = 2.0
CONDUCTIVITY_NOISE_FLOOR_LOG10 = -12.0


@dataclass(frozen=True)
class MaterialPhysics:
    """Distributions of latent physical properties for one material class."""

    modulus_gpa: tuple[float, float]  # lognormal (median, sigma in ln-space)
    density: tuple[float, float]  # normal (mean, std) kg/m^3
    effusivity: tuple[float, float]  # lognormal (median, sigma)
    log10_conductivity: tuple[float, float]  # normal (mean, std)
    relaxation_s: tuple[float, float]  # lognormal (median, sigma)
    hygroscopic: float  # sensitivity of log10 conductivity to humidity
    # (probability, log10 conductivity mean, std) of a surface variant
    variant: tuple[float, float, float] | None
    variant_name: str | None


PHYSICS: dict[str, MaterialPhysics] = {
    "Steel": MaterialPhysics((195.0, 0.05), (7850, 150), (9500, 0.30), (6.4, 0.25), (0.012, 0.30), 0.0,
                             (0.12, -13.0, 0.8), "painted / insulating coating"),
    "Glass": MaterialPhysics((70.0, 0.06), (2500, 80), (1450, 0.08), (-12.5, 0.6), (0.015, 0.30), 0.5,
                             None, None),
    "Wood": MaterialPhysics((9.0, 0.35), (600, 120), (420, 0.20), (-9.5, 0.9), (0.07, 0.35), 3.0,
                            (0.30, -12.8, 0.7), "varnished surface"),
    "Plastic": MaterialPhysics((2.4, 0.30), (1100, 150), (560, 0.15), (-14.5, 0.8), (0.12, 0.35), 0.0,
                               None, None),
    "Rubber": MaterialPhysics((0.03, 0.60), (1150, 100), (640, 0.15), (-12.0, 1.0), (0.32, 0.30), 0.0,
                              (0.20, -3.0, 0.8), "carbon-black filled (conductive)"),
    "Fabric": MaterialPhysics((0.004, 0.60), (350, 120), (90, 0.40), (-10.5, 1.0), (0.45, 0.35), 3.0,
                              None, None),
}


@dataclass
class Environment:
    ambient_temperature: float | None = None  # °C, None => sampled (room conditions)
    humidity: float | None = None  # 0..1 relative humidity
    probe_force: float | None = None  # N
    contact_quality: float | None = None  # 0..1 (1 = full, clean contact)
    noise_level: float = 1.0  # multiplier on sensor noise (1 = nominal)


def _lognormal(rng: np.random.Generator, median: float, sigma: float, n: int) -> np.ndarray:
    return median * np.exp(rng.normal(0.0, sigma, n))


def generate_readings(
    materials: np.ndarray | list[str],
    rng: np.random.Generator,
    env: Environment | None = None,
) -> dict[str, np.ndarray]:
    """Vectorised generation of sensor readings for the given material labels.

    Returns a dict with one array per feature in :data:`FEATURES`, plus latent
    variables (prefixed ``latent_``) useful for explaining a simulated sample.
    """
    env = env or Environment()
    labels = np.asarray(materials, dtype=object)
    n = labels.shape[0]
    noise = float(max(env.noise_level, 0.0))

    def env_or(value: float | None, draw: np.ndarray) -> np.ndarray:
        return np.full(n, float(value)) if value is not None else draw

    ambient = env_or(env.ambient_temperature, rng.normal(22.0, 2.0, n))
    humidity = np.clip(env_or(env.humidity, rng.uniform(0.3, 0.7, n)), 0.0, 1.0)
    force = np.clip(env_or(env.probe_force, rng.normal(NOMINAL_PROBE_FORCE_N, 0.15, n)), 0.2, 20.0)
    quality = np.clip(env_or(env.contact_quality, rng.beta(9.0, 1.4, n)), 0.05, 1.0)
    skin_temp = rng.normal(33.0, 0.4, n)

    modulus = np.empty(n)
    density = np.empty(n)
    effusivity = np.empty(n)
    log_sigma = np.empty(n)
    relaxation = np.empty(n)
    variant = np.zeros(n, dtype=bool)

    for name in MATERIALS:
        idx = np.flatnonzero(labels == name)
        if idx.size == 0:
            continue
        p = PHYSICS[name]
        k = idx.size
        modulus[idx] = _lognormal(rng, *p.modulus_gpa, k)
        density[idx] = np.clip(rng.normal(*p.density, k), 50.0, None)
        effusivity[idx] = _lognormal(rng, *p.effusivity, k)
        ls = rng.normal(*p.log10_conductivity, k) + p.hygroscopic * (humidity[idx] - 0.5)
        if p.variant is not None:
            prob, mu, sd = p.variant
            is_variant = rng.random(k) < prob
            ls = np.where(is_variant, rng.normal(mu, sd, k), ls)
            variant[idx] = is_variant
        log_sigma[idx] = ls
        relaxation[idx] = _lognormal(rng, *p.relaxation_s, k)

    unknown = ~np.isin(labels, MATERIALS)
    if unknown.any():
        raise ValueError(f"Unknown material label(s): {sorted(set(labels[unknown]))}")

    # --- pressure (kPa) -------------------------------------------------------
    e_star = 1.0 / (1.0 / modulus + 1.0 / PROBE_MODULUS_GPA)
    stiffness_ratio = e_star / PROBE_MODULUS_GPA
    curvature = np.exp(rng.normal(0.0, 0.10, n))
    pressure = (force / NOMINAL_PROBE_FORCE_N) * (12.0 + 240.0 * stiffness_ratio**0.35) * curvature
    pressure *= 0.4 + 0.6 * quality  # partial contact spreads less load through the sensor
    pressure += rng.normal(0.0, 3.0 * noise, n)

    # --- temperature (°C) -----------------------------------------------------
    t_contact = (SENSOR_EFFUSIVITY * skin_temp + effusivity * ambient) / (SENSOR_EFFUSIVITY + effusivity)
    # An air gap (poor contact) decouples the fingertip from the object.
    temperature = quality * t_contact + (1.0 - quality) * skin_temp
    temperature += rng.normal(0.0, 0.25 * noise, n)

    # --- vibration (Hz) -------------------------------------------------------
    sound_speed = np.sqrt(modulus * 1e9 / density)
    geometry = np.exp(rng.normal(np.log(0.55), 0.18, n))
    vibration = geometry * sound_speed / (1.0 + 4.0 * relaxation)
    vibration *= 0.85 + 0.15 * quality
    vibration += rng.normal(0.0, 6.0 * noise, n)

    # --- conductivity (S/m) ---------------------------------------------------
    floor = 10.0 ** rng.normal(CONDUCTIVITY_NOISE_FLOOR_LOG10, 0.25 * max(noise, 0.2), n)
    conductivity = (10.0**log_sigma) * quality**4 + floor

    # --- contact settling time (s) --------------------------------------------
    contact_duration = 0.08 + 2.2 * relaxation * (force / NOMINAL_PROBE_FORCE_N) ** 0.3
    contact_duration += 0.3 * (1.0 - quality)
    contact_duration += rng.normal(0.0, 0.015 * noise, n)

    out = {
        "pressure": np.clip(pressure, 0.5, None),
        "temperature": temperature,
        "vibration": np.clip(vibration, 1.0, None),
        "conductivity": conductivity,
        "contact_duration": np.clip(contact_duration, 0.02, None),
        "latent_modulus_gpa": modulus,
        "latent_density": density,
        "latent_effusivity": effusivity,
        "latent_log10_conductivity": log_sigma,
        "latent_relaxation_s": relaxation,
        "latent_variant": variant,
        "env_ambient_temperature": ambient,
        "env_humidity": humidity,
        "env_probe_force": force,
        "env_contact_quality": quality,
    }
    assert all(f in out for f in FEATURES)
    return out


def variant_name(material: str) -> str | None:
    return PHYSICS[material].variant_name
