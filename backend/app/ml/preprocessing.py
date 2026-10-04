"""Shared validation + preprocessing.

Every sensor sample - simulated, uploaded (CSV/JSON) or live - passes through
:func:`validate_sample` and :func:`to_feature_matrix` before reaching the model.
The model-facing transform (:class:`SensorFeatureTransformer`) is embedded inside the
persisted scikit-learn ``Pipeline``, so training and inference apply byte-identical
transforms.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from sklearn.base import BaseEstimator, TransformerMixin

from app.domain.materials import FEATURE_SPECS, FEATURES

CONDUCTIVITY_INDEX = FEATURES.index("conductivity")
LOG_FLOOR = 1e-15


class SensorFeatureTransformer(TransformerMixin, BaseEstimator):
    """Model-facing transform.

    Conductivity spans ~18 orders of magnitude (steel ~1e6 S/m, insulators ~1e-12 S/m),
    so it is mapped to log10 space. The remaining features are physically linear and
    passed through unchanged (standardisation happens in the next pipeline step).
    """

    def fit(self, X, y=None):  # noqa: N803 - sklearn naming convention
        X = np.asarray(X, dtype=float)
        self.n_features_in_ = X.shape[1]
        return self

    def transform(self, X):  # noqa: N803
        X = np.array(X, dtype=float, copy=True)
        X[:, CONDUCTIVITY_INDEX] = np.log10(np.maximum(X[:, CONDUCTIVITY_INDEX], LOG_FLOOR))
        return X

    def get_feature_names_out(self, input_features=None):
        return np.array([("log10_" + f) if f == "conductivity" else f for f in FEATURES], dtype=object)


def model_space(feature: str, value: float) -> float:
    """Map a raw feature value into the space the model reasons in (for stats/OOD)."""
    if feature == "conductivity":
        return math.log10(max(value, LOG_FLOOR))
    return value


@dataclass
class FieldIssue:
    feature: str
    code: str
    message: str
    value: Any = None

    def to_dict(self) -> dict:
        return {"feature": self.feature, "code": self.code, "message": self.message, "value": _jsonable(self.value)}


@dataclass
class ValidationResult:
    features: dict[str, float] | None
    errors: list[FieldIssue] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.errors and self.features is not None


def _jsonable(value: Any) -> Any:
    if value is None or isinstance(value, (bool, int, str)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else str(value)
    return str(value)[:120]


def coerce_number(value: Any) -> float | None:
    """Convert a raw cell (number or numeric string) to float; None if not numeric."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float, np.integer, np.floating)):
        return float(value)
    if isinstance(value, str):
        # Deliberately strict: "1,000" vs "1,5" is ambiguous, so commas are rejected
        # with a clear "not a number" error rather than guessed.
        text = value.strip()
        if text == "":
            return None
        try:
            return float(text)
        except ValueError:
            return None
    return None


MISSING_TOKENS = {"", "na", "n/a", "nan", "null", "none", "-", "?"}


def is_missing(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, float) and math.isnan(value):
        return True
    return isinstance(value, str) and value.strip().lower() in MISSING_TOKENS


def validate_sample(raw: Mapping[str, Any]) -> ValidationResult:
    """Validate one sensor sample (all five features required, numeric, finite, in bounds)."""
    errors: list[FieldIssue] = []
    features: dict[str, float] = {}
    for name in FEATURES:
        spec = FEATURE_SPECS[name]
        if name not in raw or is_missing(raw[name]):
            errors.append(FieldIssue(name, "missing", f"{spec.label} is missing"))
            continue
        value = coerce_number(raw[name])
        if value is None:
            errors.append(FieldIssue(name, "not_numeric", f"{spec.label} is not a number", raw[name]))
            continue
        if not math.isfinite(value):
            errors.append(FieldIssue(name, "not_finite", f"{spec.label} must be a finite number", value))
            continue
        if value < spec.hard_min or value > spec.hard_max:
            errors.append(
                FieldIssue(
                    name,
                    "out_of_bounds",
                    f"{spec.label} {value:g} {spec.unit} is outside the physically valid range "
                    f"[{spec.hard_min:g}, {spec.hard_max:g}] {spec.unit}",
                    value,
                )
            )
            continue
        features[name] = value
    return ValidationResult(features=None if errors else features, errors=errors)


def to_feature_matrix(samples: Sequence[Mapping[str, float]]) -> np.ndarray:
    """Order validated samples into the model's (n, len(FEATURES)) float matrix."""
    return np.array([[float(s[f]) for f in FEATURES] for s in samples], dtype=float).reshape(len(samples), len(FEATURES))


def typicality_score(features: Mapping[str, float], class_stats: Mapping[str, Mapping[str, float]]) -> float:
    """Mean squared z-score of a sample relative to one class's training distribution.

    A novelty measure independent of the classifier: a random forest can be very
    confident about a sample that looks nothing like its training data (e.g. a poor
    contact). Thresholds are calibrated per class at training time.
    """
    total = 0.0
    for name in FEATURES:
        s = class_stats[name]
        std = max(s["std"], 1e-9)
        total += ((model_space(name, features[name]) - s["mean"]) / std) ** 2
    return total / len(FEATURES)


def out_of_distribution(features: Mapping[str, float], ranges: Mapping[str, Mapping[str, float]]) -> list[dict]:
    """Return features that fall outside the range seen during training.

    ``ranges`` comes from the trained model's metadata (model-space 0.1/99.9 percentiles
    widened by 10 % of the span). Out-of-distribution inputs still get a prediction, but
    the grip engine treats them conservatively and the UI flags them.
    """
    flagged = []
    for name in FEATURES:
        r = ranges.get(name)
        if not r:
            continue
        v = model_space(name, features[name])
        span = r["high"] - r["low"]
        lo, hi = r["low"] - 0.1 * span, r["high"] + 0.1 * span
        if v < lo or v > hi:
            flagged.append({"feature": name, "value": features[name], "expected_low": r["raw_low"], "expected_high": r["raw_high"]})
    return flagged
