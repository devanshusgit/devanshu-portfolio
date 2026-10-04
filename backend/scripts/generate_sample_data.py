#!/usr/bin/env python3
"""Regenerate the example upload files in ../sample_data (deterministic, seeded).

All values are SIMULATED readings from app.sensors.physics.

    python scripts/generate_sample_data.py
"""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.domain.materials import FEATURES, MATERIALS  # noqa: E402
from app.ml.dataset import round_readings  # noqa: E402
from app.sensors.physics import Environment, generate_readings  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / "sample_data"


def rows(n: int, seed: int) -> list[dict]:
    rng = np.random.default_rng(seed)
    labels = [MATERIALS[i % len(MATERIALS)] for i in range(n)]
    rng.shuffle(labels)
    v = round_readings(generate_readings(labels, rng, Environment()))
    return [{"row_id": i + 1, **{f: float(v[f][i]) for f in FEATURES}, "material": m} for i, m in enumerate(labels)]


def write_csv(path: Path, records: list[dict], fields: list[str]) -> None:
    with path.open("w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(records)


def main() -> None:
    OUT.mkdir(exist_ok=True)
    labelled = rows(60, 2026)
    write_csv(OUT / "tactile_labelled.csv", labelled, ["row_id", *FEATURES, "material"])
    write_csv(OUT / "tactile_unlabelled.csv", rows(24, 7), ["row_id", *FEATURES])
    (OUT / "tactile_samples.json").write_text(
        json.dumps({"description": "NeuroGrip example - SIMULATED tactile readings", "data": rows(30, 99)}, indent=2)
    )

    # Messy file: alias column names, other units, missing and invalid cells.
    messy = []
    for r in rows(20, 404):
        messy.append(
            {
                "Sample ID": f"S-{r['row_id']:03d}",
                "Force": r["pressure"],
                "Temp (°F)": round(r["temperature"] * 9 / 5 + 32, 2),
                "imu": r["vibration"],
                "Resistivity": f"{1 / r['conductivity']:.4g}",
                "contact_time_ms": round(r["contact_duration"] * 1000, 1),
                "label": r["material"].lower(),
            }
        )
    messy[3]["Force"] = ""  # missing value
    messy[7]["imu"] = "n/a"  # missing token
    messy[11]["Temp (°F)"] = "warm"  # not a number
    messy[15]["label"] = "unobtainium"  # unknown label
    write_csv(OUT / "tactile_messy_aliases.csv", messy, list(messy[0].keys()))
    print(f"Wrote sample datasets to {OUT}")


if __name__ == "__main__":
    main()
