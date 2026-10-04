"""Thread-safe holder for the active material classifier.

The registry owns exactly one loaded model at a time. Retraining builds a complete
new model off to the side and swaps the reference atomically, so in-flight
predictions never observe a half-trained model.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import sklearn

from app.ml.train import MODEL_FILENAME, TrainedModel, load_model, save_model, train_model

log = logging.getLogger(__name__)


class ModelNotReadyError(RuntimeError):
    pass


class ModelBusyError(RuntimeError):
    pass


@dataclass
class Inference:
    probabilities: np.ndarray  # (n, n_classes)
    classes: list[str]
    preprocess_ms: float
    inference_ms: float
    model_version: str


class ModelRegistry:
    def __init__(self, model_dir: Path, n_samples: int = 4800, seed: int = 42, test_size: float = 0.2):
        self.model_dir = Path(model_dir)
        self.defaults = {"n_samples": n_samples, "seed": seed, "test_size": test_size}
        self._model: TrainedModel | None = None
        self._train_lock = threading.Lock()
        self._training = False
        self.last_error: str | None = None

    # ------------------------------------------------------------------ state
    @property
    def ready(self) -> bool:
        return self._model is not None

    @property
    def training(self) -> bool:
        return self._training

    @property
    def model(self) -> TrainedModel:
        model = self._model
        if model is None:
            raise ModelNotReadyError("The material classifier is not loaded yet")
        return model

    @property
    def metadata(self) -> dict[str, Any]:
        return self.model.metadata

    # ------------------------------------------------------------ lifecycle
    def load(self) -> bool:
        path = self.model_dir / MODEL_FILENAME
        if not path.exists():
            return False
        try:
            model = load_model(self.model_dir)
        except Exception as exc:  # corrupt / incompatible artifact
            log.warning("Could not load model artifact %s: %s", path, exc)
            self.last_error = f"load failed: {exc}"
            return False
        saved_version = model.metadata.get("sklearn_version")
        if saved_version != sklearn.__version__:
            log.warning(
                "Model was trained with scikit-learn %s but %s is installed; retraining for safety",
                saved_version,
                sklearn.__version__,
            )
            return False
        self._model = model
        log.info("Loaded material classifier %s", model.metadata.get("version"))
        return True

    def ensure_ready(self, train_if_missing: bool = True) -> None:
        if self.ready or self.load():
            return
        if train_if_missing:
            log.info("No usable model artifact found - training a new model")
            self.train()

    def train(self, n_samples: int | None = None, seed: int | None = None, test_size: float | None = None) -> dict:
        if not self._train_lock.acquire(blocking=False):
            raise ModelBusyError("A training run is already in progress")
        self._training = True
        try:
            params = {
                "n_samples": n_samples or self.defaults["n_samples"],
                "seed": self.defaults["seed"] if seed is None else seed,
                "test_size": test_size or self.defaults["test_size"],
            }
            model = train_model(**params)
            save_model(model, self.model_dir)
            self._model = model  # atomic reference swap
            self.last_error = None
            log.info(
                "Trained %s accuracy=%.4f", model.metadata["version"], model.metadata["metrics"]["accuracy"]
            )
            return model.metadata
        except Exception as exc:
            self.last_error = f"training failed: {exc}"
            raise
        finally:
            self._training = False
            self._train_lock.release()

    # ------------------------------------------------------------- inference
    def predict_proba(self, X: np.ndarray) -> Inference:  # noqa: N803
        """Run the persisted pipeline: preprocessing transforms, then the classifier.

        The two halves are timed separately so the UI can show real stage timings.
        """
        model = self.model
        pipeline = model.pipeline
        t0 = time.perf_counter()
        Xt = pipeline[:-1].transform(X)
        t1 = time.perf_counter()
        proba = pipeline[-1].predict_proba(Xt)
        t2 = time.perf_counter()
        return Inference(
            probabilities=proba,
            classes=model.classes,
            preprocess_ms=(t1 - t0) * 1000,
            inference_ms=(t2 - t1) * 1000,
            model_version=model.metadata["version"],
        )
