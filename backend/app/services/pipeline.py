"""The canonical NeuroGrip prediction pipeline.

    SensorData -> Validation -> Preprocessing -> Predictor -> PredictionResult
               -> GripEngine -> SimulationCommand

There is exactly ONE implementation. The simulator, uploaded CSV/JSON rows (single,
playback and batch), the live sensor stream and the experiment controls all call
:meth:`PredictionPipeline.run` / :meth:`PredictionPipeline.run_batch`.
"""

from __future__ import annotations

import time
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import numpy as np

from app.domain.materials import FEATURES, DataSource, confidence_level, normalize_material
from app.grip.engine import GripDecision, GripEngine, SimulationCommand
from app.ml.preprocessing import (
    FieldIssue,
    out_of_distribution,
    to_feature_matrix,
    typicality_score,
    validate_sample,
)
from app.ml.registry import ModelRegistry


class SampleValidationError(ValueError):
    def __init__(self, errors: list[FieldIssue]):
        self.errors = errors
        super().__init__("; ".join(e.message for e in errors))


@dataclass
class PredictionContext:
    data_source: DataSource
    source_detail: str | None = None
    object_id: str | None = None
    ground_truth: str | None = None
    dataset_id: int | None = None
    row_index: int | None = None
    row_id: str | None = None
    meta: dict[str, Any] = field(default_factory=dict)


@dataclass
class PipelineResult:
    context: PredictionContext
    features: dict[str, float]
    probabilities: dict[str, float]
    material: str
    confidence: float
    confidence_level: str
    is_uncertain: bool
    ood: list[dict]
    grip: GripDecision
    command: SimulationCommand
    trace: list[dict]
    model_version: str
    ground_truth: str | None
    latency_ms: float
    timestamp: datetime

    @property
    def correct(self) -> bool | None:
        return None if self.ground_truth is None else self.ground_truth == self.material

    @property
    def display_label(self) -> str:
        return "Uncertain" if self.is_uncertain else self.material

    def to_dict(self) -> dict[str, Any]:
        ranked = sorted(self.probabilities.items(), key=lambda kv: kv[1], reverse=True)
        ctx = self.context
        return {
            "timestamp": self.timestamp.isoformat(),
            "data_source": ctx.data_source.value,
            "source_detail": ctx.source_detail,
            "sample": dict(self.features),
            "ground_truth": self.ground_truth,
            "correct": self.correct,
            "dataset_ref": (
                {"dataset_id": ctx.dataset_id, "row_index": ctx.row_index, "row_id": ctx.row_id}
                if ctx.dataset_id is not None
                else None
            ),
            "prediction": {
                "material": self.material,
                "display_label": self.display_label,
                "is_uncertain": self.is_uncertain,
                "confidence": round(self.confidence, 4),
                "confidence_level": self.confidence_level,
                "probabilities": {k: round(v, 4) for k, v in ranked},
                "ranking": [{"material": k, "probability": round(v, 4)} for k, v in ranked],
                "out_of_distribution": self.ood,
            },
            "grip": self.grip.to_dict(),
            "command": self.command.to_dict(),
            "model_version": self.model_version,
            "trace": self.trace,
            "latency_ms": round(self.latency_ms, 3),
        }


@dataclass
class BatchItem:
    index: int
    result: PipelineResult | None
    errors: list[FieldIssue]


class PredictionPipeline:
    def __init__(self, registry: ModelRegistry):
        self.registry = registry
        self._engine: GripEngine | None = None
        self._engine_version: str | None = None

    @property
    def grip_engine(self) -> GripEngine:
        meta = self.registry.metadata
        if self._engine is None or self._engine_version != meta["version"]:
            # Sensor adjustments compare readings to the active model's training stats.
            self._engine = GripEngine(meta.get("class_feature_stats"))
            self._engine_version = meta["version"]
        return self._engine

    # ------------------------------------------------------------------ single
    def run(self, raw: Mapping[str, Any], context: PredictionContext) -> PipelineResult:
        item = self.run_batch([raw], [context])[0]
        if item.result is None:
            raise SampleValidationError(item.errors)
        return item.result

    # ------------------------------------------------------------------- batch
    def run_batch(
        self,
        raws: Sequence[Mapping[str, Any]],
        contexts: Sequence[PredictionContext] | PredictionContext,
    ) -> list[BatchItem]:
        n = len(raws)
        if isinstance(contexts, PredictionContext):
            contexts = [contexts] * n
        if len(contexts) != n:
            raise ValueError("contexts must match raws")

        started = time.perf_counter()

        # 1) Validation -------------------------------------------------------
        t0 = time.perf_counter()
        validations = [validate_sample(r) for r in raws]
        valid_idx = [i for i, v in enumerate(validations) if v.ok]
        validation_ms = (time.perf_counter() - t0) * 1000

        items = [BatchItem(i, None, v.errors) for i, v in enumerate(validations)]
        if not valid_idx:
            return items

        # 2+3) Preprocessing + inference (single vectorised call) ---------------
        samples = [validations[i].features for i in valid_idx]
        X = to_feature_matrix(samples)  # type: ignore[arg-type]
        inference = self.registry.predict_proba(X)
        meta = self.registry.metadata
        ranges = meta.get("feature_ranges", {})
        engine = self.grip_engine
        n_valid = len(valid_idx)

        for row, i in enumerate(valid_idx):
            ctx = contexts[i]
            features = samples[row]
            assert features is not None

            # 4) Material recognition -------------------------------------------
            t_rec = time.perf_counter()
            probs = {c: float(p) for c, p in zip(inference.classes, inference.probabilities[row])}
            material = max(probs, key=probs.get)  # type: ignore[arg-type]
            confidence = probs[material]
            level = confidence_level(confidence)
            ood = out_of_distribution(features, ranges)
            typicality = None
            stats = meta.get("class_feature_stats", {}).get(material)
            threshold = meta.get("typicality_thresholds", {}).get(material)
            if stats and threshold:
                typicality = (typicality_score(features, stats), float(threshold))
            rec_ms = (time.perf_counter() - t_rec) * 1000

            # 5) Grip engine -> simulation command ------------------------------
            t_grip = time.perf_counter()
            decision, command = engine.decide(probs, features, ctx.object_id, ood, typicality)
            grip_ms = (time.perf_counter() - t_grip) * 1000

            truth = normalize_material(ctx.ground_truth) if ctx.ground_truth is not None else None
            trace = [
                _stage("validation", "Data validation", validation_ms / n, "5 features present, numeric, within physical bounds"),
                _stage("preprocessing", "Preprocessing", inference.preprocess_ms / n_valid, "feature ordering, log10(conductivity), standard scaling"),
                _stage("inference", "Random forest inference", inference.inference_ms / n_valid, f"{meta['params']['n_estimators']} trees, predict_proba"),
                _stage("recognition", "Material recognition", rec_ms, f"{material} @ {confidence:.1%} ({level})" + (" - uncertain" if level == "LOW" else "")),
                _stage("grip", "Grip engine", grip_ms, f"{decision.grip_percent:.1f}% {decision.grip_mode_label}, {decision.safety_status}"),
                _stage("command", "Prosthetic command", 0.0, f"{command.grasp_type}, closure speed {command.closure_speed:.2f}"),
            ]
            items[i].result = PipelineResult(
                context=ctx,
                features=dict(features),
                probabilities=probs,
                material=material,
                confidence=confidence,
                confidence_level=level,
                is_uncertain=level == "LOW",
                ood=ood,
                grip=decision,
                command=command,
                trace=trace,
                model_version=inference.model_version,
                ground_truth=truth,
                latency_ms=(time.perf_counter() - started) * 1000 / n,
                timestamp=datetime.now(timezone.utc),
            )
        return items


def _stage(key: str, label: str, ms: float, detail: str) -> dict:
    return {"stage": key, "label": label, "duration_ms": round(ms, 3), "status": "ok", "detail": detail}


def results_matrix(results: Sequence[PipelineResult]) -> np.ndarray:
    return to_feature_matrix([r.features for r in results])


__all__ = [
    "FEATURES",
    "BatchItem",
    "PipelineResult",
    "PredictionContext",
    "PredictionPipeline",
    "SampleValidationError",
]
