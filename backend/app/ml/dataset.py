"""Reproducible synthetic training dataset.

The dataset is generated from the physics-inspired sensor model in
:mod:`app.sensors.physics` with a fixed random seed, so the exact same dataset (and
therefore the exact same model metrics) can be regenerated anywhere.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from app.domain.materials import FEATURES, MATERIALS
from app.sensors.physics import generate_readings

# Simulated sensor resolution (decimal places) applied to stored readings.
FEATURE_DECIMALS = {"pressure": 2, "temperature": 2, "vibration": 1, "contact_duration": 3}


def round_readings(values: dict[str, np.ndarray] | dict[str, float]) -> dict:
    out = dict(values)
    for feature, decimals in FEATURE_DECIMALS.items():
        if feature in out:
            out[feature] = np.round(out[feature], decimals)
    if "conductivity" in out:
        # 4 significant figures (value spans many orders of magnitude)
        c = np.asarray(out["conductivity"], dtype=float)
        out["conductivity"] = np.array([float(f"{v:.4g}") for v in np.atleast_1d(c)]).reshape(c.shape)
    return out


def class_counts(n_samples: int) -> dict[str, int]:
    base, remainder = divmod(n_samples, len(MATERIALS))
    return {m: base + (1 if i < remainder else 0) for i, m in enumerate(MATERIALS)}


def generate_dataset(n_samples: int = 4800, seed: int = 42) -> pd.DataFrame:
    """Generate a class-balanced dataset of simulated tactile readings."""
    if n_samples < len(MATERIALS) * 20:
        raise ValueError("n_samples too small to train a meaningful model")
    rng = np.random.default_rng(seed)
    counts = class_counts(n_samples)
    labels = np.concatenate([np.repeat(m, c) for m, c in counts.items()]).astype(object)
    rng.shuffle(labels)
    readings = round_readings(generate_readings(labels, rng))
    df = pd.DataFrame({f: np.asarray(readings[f], dtype=float) for f in FEATURES})
    df.insert(0, "sample_id", np.arange(1, n_samples + 1))
    df["material"] = labels.astype(str)
    return df
