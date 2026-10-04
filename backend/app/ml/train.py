"""Training pipeline for the material classifier.

Run directly to (re)train and persist the model::

    python -m app.ml.train --samples 4800 --seed 42

All reported metrics are computed on a held-out, stratified test split that the
model never sees during fitting. Nothing here is hard-coded.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import sklearn
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    precision_recall_fscore_support,
)
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import LabelEncoder, StandardScaler

from app.domain.materials import FEATURE_SPECS, FEATURES, HIGH_CONFIDENCE, MATERIALS, MODERATE_CONFIDENCE
from app.ml.dataset import generate_dataset
from app.ml.preprocessing import SensorFeatureTransformer, typicality_score

MODEL_FILENAME = "material_classifier.joblib"
METADATA_FILENAME = "model_metadata.json"

RF_PARAMS: dict[str, Any] = {"n_estimators": 100, "max_depth": 12, "random_state": 42}


@dataclass
class TrainedModel:
    pipeline: Pipeline
    label_encoder: LabelEncoder
    metadata: dict[str, Any]

    @property
    def classes(self) -> list[str]:
        return [str(c) for c in self.label_encoder.classes_]


def build_pipeline() -> Pipeline:
    return Pipeline(
        steps=[
            ("features", SensorFeatureTransformer()),
            ("scaler", StandardScaler()),
            ("classifier", RandomForestClassifier(**RF_PARAMS)),
        ]
    )


def _feature_statistics(X_model: np.ndarray, X_raw: np.ndarray, y_text: np.ndarray) -> tuple[dict, dict]:
    """Training-set statistics used for OOD detection and grip sensor adjustment.

    ``X_model`` is in model space (log10 conductivity); ``X_raw`` is in raw units.
    """
    ranges: dict[str, dict[str, float]] = {}
    for j, name in enumerate(FEATURES):
        lo, hi = np.percentile(X_model[:, j], [0.1, 99.9])
        raw_lo, raw_hi = np.percentile(X_raw[:, j], [0.1, 99.9])
        ranges[name] = {"low": float(lo), "high": float(hi), "raw_low": float(raw_lo), "raw_high": float(raw_hi)}

    per_class: dict[str, dict[str, dict[str, float]]] = {}
    for material in MATERIALS:
        mask = y_text == material
        per_class[material] = {}
        for j, name in enumerate(FEATURES):
            col_model = X_model[mask, j]
            col_raw = X_raw[mask, j]
            per_class[material][name] = {
                "mean": float(col_model.mean()),
                "std": float(col_model.std(ddof=1)),
                "raw_median": float(np.median(col_raw)),
                "raw_p05": float(np.percentile(col_raw, 5)),
                "raw_p95": float(np.percentile(col_raw, 95)),
            }
    return ranges, per_class


def train_model(n_samples: int = 4800, seed: int = 42, test_size: float = 0.2) -> TrainedModel:
    if not 0.05 <= test_size <= 0.5:
        raise ValueError("test_size must be between 0.05 and 0.5")
    started = time.perf_counter()
    df = generate_dataset(n_samples=n_samples, seed=seed)
    X = df[list(FEATURES)].to_numpy(dtype=float)
    y_text = df["material"].to_numpy(dtype=object)

    encoder = LabelEncoder().fit(list(MATERIALS))
    y = encoder.transform(y_text)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=test_size, random_state=seed, stratify=y
    )

    pipeline = build_pipeline()
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=seed)
    cv_scores = cross_val_score(build_pipeline(), X_train, y_train, cv=cv, scoring="accuracy")

    pipeline.fit(X_train, y_train)
    y_pred = pipeline.predict(X_test)
    proba = pipeline.predict_proba(X_test)
    confidence = proba.max(axis=1)

    classes = [str(c) for c in encoder.classes_]
    labels_idx = list(range(len(classes)))
    precision, recall, f1, support = precision_recall_fscore_support(
        y_test, y_pred, labels=labels_idx, zero_division=0
    )
    p_macro, r_macro, f1_macro, _ = precision_recall_fscore_support(
        y_test, y_pred, average="macro", zero_division=0
    )
    p_w, r_w, f1_w, _ = precision_recall_fscore_support(y_test, y_pred, average="weighted", zero_division=0)
    cm = confusion_matrix(y_test, y_pred, labels=labels_idx)

    # Does confidence mean something? Accuracy of test predictions per confidence band.
    bands = []
    for name, lo, hi in (
        ("HIGH", HIGH_CONFIDENCE, 1.0 + 1e-9),
        ("MODERATE", MODERATE_CONFIDENCE, HIGH_CONFIDENCE),
        ("LOW", 0.0, MODERATE_CONFIDENCE),
    ):
        mask = (confidence >= lo) & (confidence < hi)
        count = int(mask.sum())
        bands.append(
            {
                "level": name,
                "count": count,
                "share": count / len(confidence),
                "accuracy": float((y_pred[mask] == y_test[mask]).mean()) if count else None,
            }
        )

    X_train_model = pipeline.named_steps["features"].transform(X_train)
    y_train_text = encoder.inverse_transform(y_train).astype(object)
    ranges, per_class = _feature_statistics(X_train_model, X_train, y_train_text)

    # Per-class novelty thresholds: 99.5th percentile of the typicality score of that
    # class's own training samples.
    typicality: dict[str, float] = {}
    for material in MATERIALS:
        rows = X_train[y_train_text == material]
        scores = [typicality_score(dict(zip(FEATURES, r)), per_class[material]) for r in rows]
        typicality[material] = float(np.percentile(scores, 99.5))
    test_text = encoder.inverse_transform(y_pred)
    flagged = np.array(
        [
            typicality_score(dict(zip(FEATURES, r)), per_class[m]) > typicality[m]
            for r, m in zip(X_test, test_text)
        ]
    )
    importances = pipeline.named_steps["classifier"].feature_importances_

    trained_at = datetime.now(timezone.utc)
    fingerprint = hashlib.sha1(f"{trained_at.isoformat()}-{seed}-{n_samples}".encode()).hexdigest()[:8]
    metadata: dict[str, Any] = {
        "version": f"rf-{trained_at:%Y%m%d%H%M%S}-{fingerprint}",
        "model_type": "RandomForestClassifier",
        "pipeline_steps": [
            "SensorFeatureTransformer (log10 conductivity)",
            "StandardScaler",
            "RandomForestClassifier",
        ],
        "params": dict(RF_PARAMS),
        "sklearn_version": sklearn.__version__,
        "classes": classes,
        "features": list(FEATURES),
        "feature_units": {f: FEATURE_SPECS[f].unit for f in FEATURES},
        "trained_at": trained_at.isoformat(),
        "training_duration_s": round(time.perf_counter() - started, 3),
        "dataset": {
            "generator": "physics-inspired tactile sensor model (app.sensors.physics)",
            "n_samples": int(n_samples),
            "seed": int(seed),
            "test_size": float(test_size),
            "train_size": int(len(y_train)),
            "test_count": int(len(y_test)),
            "class_counts": {m: int((y_text == m).sum()) for m in MATERIALS},
        },
        "metrics": {
            "accuracy": float(accuracy_score(y_test, y_pred)),
            "precision_macro": float(p_macro),
            "recall_macro": float(r_macro),
            "f1_macro": float(f1_macro),
            "precision_weighted": float(p_w),
            "recall_weighted": float(r_w),
            "f1_weighted": float(f1_w),
        },
        "per_class": {
            classes[i]: {
                "precision": float(precision[i]),
                "recall": float(recall[i]),
                "f1": float(f1[i]),
                "support": int(support[i]),
            }
            for i in labels_idx
        },
        "confusion_matrix": {"labels": classes, "matrix": cm.astype(int).tolist()},
        "cross_validation": {
            "folds": 5,
            "scores": [float(s) for s in cv_scores],
            "mean": float(cv_scores.mean()),
            "std": float(cv_scores.std()),
        },
        "confidence_bands": bands,
        "feature_importances": {f: float(v) for f, v in zip(FEATURES, importances)},
        "feature_ranges": ranges,
        "class_feature_stats": per_class,
        "typicality_thresholds": typicality,
        "typicality_test_flag_rate": float(flagged.mean()),
    }
    return TrainedModel(pipeline=pipeline, label_encoder=encoder, metadata=metadata)


def save_model(model: TrainedModel, model_dir: Path) -> Path:
    model_dir.mkdir(parents=True, exist_ok=True)
    path = model_dir / MODEL_FILENAME
    tmp = path.with_suffix(".tmp")
    joblib.dump(
        {"pipeline": model.pipeline, "label_encoder": model.label_encoder, "metadata": model.metadata},
        tmp,
        compress=3,
    )
    tmp.replace(path)  # atomic swap so readers never see a half-written file
    (model_dir / METADATA_FILENAME).write_text(json.dumps(model.metadata, indent=2))
    return path


def load_model(model_dir: Path) -> TrainedModel:
    """Load a persisted model bundle.

    Only ever called on artifacts this application wrote itself - joblib/pickle files
    must never be loaded from untrusted sources (e.g. user uploads).
    """
    bundle = joblib.load(model_dir / MODEL_FILENAME)
    return TrainedModel(bundle["pipeline"], bundle["label_encoder"], bundle["metadata"])


def main() -> None:
    from app.core.config import get_settings

    settings = get_settings()
    parser = argparse.ArgumentParser(description="Train the NeuroGrip material classifier")
    parser.add_argument("--samples", type=int, default=settings.dataset_samples)
    parser.add_argument("--seed", type=int, default=settings.dataset_seed)
    parser.add_argument("--test-size", type=float, default=settings.test_size)
    parser.add_argument("--out", type=Path, default=settings.model_dir)
    args = parser.parse_args()

    model = train_model(args.samples, args.seed, args.test_size)
    path = save_model(model, args.out)
    m = model.metadata["metrics"]
    print(f"Saved {path}")
    print(
        f"accuracy={m['accuracy']:.4f} precision={m['precision_macro']:.4f} "
        f"recall={m['recall_macro']:.4f} f1={m['f1_macro']:.4f} "
        f"cv={model.metadata['cross_validation']['mean']:.4f}±{model.metadata['cross_validation']['std']:.4f}"
    )


if __name__ == "__main__":
    main()
