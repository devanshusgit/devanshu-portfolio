#!/usr/bin/env python3
"""Mock external tactile-sensor device.

Runs as a separate process and talks to NeuroGrip exactly like a microcontroller
bridge would: it POSTs readings to ``/api/sensors/data`` with the ``X-Device-Key``
header. Standard library only, so it can also serve as a template for a Raspberry
Pi / serial bridge.

The readings it sends are SIMULATED (typical values per material plus noise), and
the payload declares ``"simulated": true`` so the UI labels them honestly.

    python scripts/mock_sensor_device.py --url http://localhost:8000 \
        --device-key dev-sensor-device-key --rate 4 --duration 30
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import time
import urllib.error
import urllib.request

# Typical (median) readings per material with relative spread - illustrative only.
TYPICAL = {
    "Glass": {"pressure": 228, "temperature": 27.5, "vibration": 2690, "conductivity": 1.4e-12, "contact_duration": 0.15},
    "Steel": {"pressure": 232, "temperature": 24.5, "vibration": 2580, "conductivity": 1.2e6, "contact_duration": 0.14},
    "Plastic": {"pressure": 178, "temperature": 29.8, "vibration": 540, "conductivity": 1.0e-12, "contact_duration": 0.38},
    "Wood": {"pressure": 207, "temperature": 30.4, "vibration": 1640, "conductivity": 5.0e-11, "contact_duration": 0.27},
    "Rubber": {"pressure": 55, "temperature": 29.6, "vibration": 36, "conductivity": 2.4e-12, "contact_duration": 0.83},
    "Fabric": {"pressure": 33, "temperature": 32.3, "vibration": 22, "conductivity": 1.9e-11, "contact_duration": 1.13},
}


def reading(material: str, rng: random.Random) -> dict:
    t = TYPICAL[material]
    return {
        "pressure": round(t["pressure"] * rng.gauss(1, 0.08), 2),
        "temperature": round(t["temperature"] + rng.gauss(0, 0.5), 2),
        "vibration": round(max(1.0, t["vibration"] * rng.gauss(1, 0.12)), 1),
        "conductivity": float(f"{t['conductivity'] * 10 ** rng.gauss(0, 0.2):.4g}"),
        "contact_duration": round(max(0.02, t["contact_duration"] * rng.gauss(1, 0.1)), 3),
        "ground_truth": material,
    }


def post(url: str, key: str, payload: dict) -> dict:
    req = urllib.request.Request(
        url.rstrip("/") + "/api/sensors/data",
        data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "X-Device-Key": key},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read())


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default="http://localhost:8000")
    ap.add_argument("--device-key", default="dev-sensor-device-key")
    ap.add_argument("--device-id", default="mock-esp32-01")
    ap.add_argument("--rate", type=float, default=4.0, help="samples per second")
    ap.add_argument("--duration", type=float, default=30.0, help="seconds to run (0 = forever)")
    ap.add_argument("--dwell", type=float, default=4.0, help="seconds spent touching each material")
    ap.add_argument("--seed", type=int, default=None)
    args = ap.parse_args()

    rng = random.Random(args.seed)
    materials = list(TYPICAL)
    started = time.monotonic()
    sent = 0
    print(f"Streaming SIMULATED readings to {args.url} as '{args.device_id}' at {args.rate} Hz (Ctrl+C to stop)")
    try:
        while args.duration <= 0 or time.monotonic() - started < args.duration:
            material = materials[int((time.monotonic() - started) // args.dwell) % len(materials)]
            payload = {"device_id": args.device_id, "simulated": True, "samples": [reading(material, rng)]}
            try:
                result = post(args.url, args.device_key, payload)["results"][0]
                pred = result.get("prediction") or {}
                sent += 1
                print(
                    f"#{result['seq']:>5}  touching {material:<7} -> {pred.get('display_label', '-'):<9} "
                    f"conf={pred.get('confidence', 0):.2f} grip={pred.get('grip_percent', 0):5.1f}% {pred.get('safety_status', '')}"
                )
            except urllib.error.HTTPError as exc:
                print(f"HTTP {exc.code}: {exc.read().decode()[:200]}", file=sys.stderr)
                if exc.code in (401, 403):
                    return 1
            except urllib.error.URLError as exc:
                print(f"Connection failed: {exc.reason}", file=sys.stderr)
            time.sleep(1.0 / args.rate)
    except KeyboardInterrupt:
        pass
    print(f"Sent {sent} samples.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
