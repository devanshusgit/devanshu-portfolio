"""Safe CSV / JSON ingestion for external sensor datasets.

Security model: uploaded files are treated purely as *data*. They are decoded as
text, parsed with the standard-library ``csv`` / ``json`` parsers and stored as
plain JSON values. Nothing is ever evaluated, imported, unpickled or executed.
"""

from __future__ import annotations

import csv
import io
import json
import math
import re
from collections import Counter
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

from app.domain.materials import FEATURE_SPECS, FEATURES, normalize_material
from app.ml.preprocessing import coerce_number, is_missing, out_of_distribution, validate_sample

ALLOWED_EXTENSIONS = {".csv": "csv", ".json": "json", ".ndjson": "json", ".jsonl": "json"}
MAX_COLUMNS = 200
MAX_CELL_CHARS = 256


class UploadError(ValueError):
    def __init__(self, message: str, code: str = "invalid_file"):
        self.code = code
        super().__init__(message)


# --------------------------------------------------------------------------- aliases
FEATURE_ALIASES: dict[str, tuple[str, ...]] = {
    "pressure": ("pressure", "force", "grip_force", "load", "force_sensor", "contact_pressure"),
    "temperature": ("temperature", "temp", "temperature_c", "temp_c", "contact_temperature", "surface_temperature"),
    "vibration": ("vibration", "acceleration", "accelerometer", "imu", "frequency", "vibration_frequency"),
    "conductivity": ("conductivity", "resistance", "resistivity", "electrical_conductivity"),
    "contact_duration": ("contact_duration", "duration", "contact_time", "touch_duration", "settling_time"),
}
LABEL_ALIASES = ("material", "label", "class", "target", "object_material", "ground_truth", "true_material")
ID_ALIASES = ("row_id", "id", "sample_id", "index", "sample", "row", "record_id")

# Unit suffix -> (feature it applies to, conversion key)
UNIT_SUFFIXES: dict[str, tuple[str | None, str | None]] = {
    "kpa": ("pressure", None),
    "pa": ("pressure", "pa_to_kpa"),
    "mpa": ("pressure", "mpa_to_kpa"),
    "psi": ("pressure", "psi_to_kpa"),
    "bar": ("pressure", "bar_to_kpa"),
    "c": ("temperature", None),
    "celsius": ("temperature", None),
    "degc": ("temperature", None),
    "f": ("temperature", "f_to_c"),
    "fahrenheit": ("temperature", "f_to_c"),
    "degf": ("temperature", "f_to_c"),
    "k": ("temperature", "k_to_c"),
    "kelvin": ("temperature", "k_to_c"),
    "hz": ("vibration", None),
    "khz": ("vibration", "khz_to_hz"),
    "s_m": ("conductivity", None),
    "us_cm": ("conductivity", "us_cm_to_s_m"),
    "s": ("contact_duration", None),
    "sec": ("contact_duration", None),
    "seconds": ("contact_duration", None),
    "ms": ("contact_duration", "ms_to_s"),
}

CONVERSIONS: dict[str, tuple[str, Any]] = {
    "pa_to_kpa": ("Pa -> kPa (÷1000)", lambda v: v / 1000.0),
    "mpa_to_kpa": ("MPa -> kPa (×1000)", lambda v: v * 1000.0),
    "psi_to_kpa": ("psi -> kPa (×6.89476)", lambda v: v * 6.89476),
    "bar_to_kpa": ("bar -> kPa (×100)", lambda v: v * 100.0),
    "f_to_c": ("°F -> °C", lambda v: (v - 32.0) * 5.0 / 9.0),
    "k_to_c": ("K -> °C (−273.15)", lambda v: v - 273.15),
    "khz_to_hz": ("kHz -> Hz (×1000)", lambda v: v * 1000.0),
    "us_cm_to_s_m": ("µS/cm -> S/m (×1e-4)", lambda v: v * 1e-4),
    "ms_to_s": ("ms -> s (÷1000)", lambda v: v / 1000.0),
    "reciprocal": ("resistivity/resistance -> conductivity (1/x)", lambda v: (1.0 / v) if v > 0 else math.inf),
}

ALIAS_NOTES = {
    "force": "force-like column interpreted as contact pressure in kPa - verify units",
    "grip_force": "force-like column interpreted as contact pressure in kPa - verify units",
    "load": "load column interpreted as contact pressure in kPa - verify units",
    "force_sensor": "force sensor column interpreted as contact pressure in kPa - verify units",
    "acceleration": "acceleration column interpreted as vibration frequency in Hz - verify units",
    "accelerometer": "accelerometer column interpreted as vibration frequency in Hz - verify units",
    "imu": "IMU column interpreted as vibration frequency in Hz - verify units",
    "resistance": "resistance converted to conductivity as 1/R (assumes unit cell geometry)",
    "resistivity": "resistivity (Ω·m) converted to conductivity (S/m) as 1/ρ",
}


def normalize_column(name: str) -> str:
    """'Pressure (kPa)' -> 'pressure_kpa', 'Temp °F' -> 'temp_f', 'sensors.pressure' -> 'pressure'."""
    text = str(name).strip()
    if "." in text and not text.replace(".", "").isdigit():
        text = text.split(".")[-1]  # flattened JSON key: use the leaf
    text = text.replace("µ", "u").replace("μ", "u").replace("Ω", "ohm")

    def unit_token(raw: str) -> str:
        u = raw.lower().replace("°", "")
        u = re.sub(r"[^a-z0-9]+", "_", u).strip("_")
        return {"degc": "c", "degf": "f"}.get(u, u)

    units = [unit_token(u) for u in re.findall(r"[\(\[]([^\)\]]*)[\)\]]", text)]
    base = re.sub(r"[\(\[][^\)\]]*[\)\]]", " ", text)
    base = base.replace("°", " ")
    # camelCase -> camel_case, but leave unit-like tokens such as 'kPa' intact
    base = re.sub(r"([a-z0-9])([A-Z][a-z]{2,})", r"\1_\2", base)
    base = re.sub(r"[^a-z0-9]+", "_", base.lower()).strip("_")
    return "_".join([base] + [u for u in units if u])


@dataclass
class ColumnMatch:
    feature: str
    column: str
    quality: str  # exact | alias | fuzzy
    conversion: str | None
    note: str | None


def _match_column(column: str) -> ColumnMatch | None:
    norm = normalize_column(column)
    candidates = [(norm, None)]
    # Strip a recognised unit suffix: 'pressure_pa' -> ('pressure', 'pa')
    for suffix in sorted(UNIT_SUFFIXES, key=len, reverse=True):
        if norm.endswith("_" + suffix):
            candidates.append((norm[: -len(suffix) - 1], suffix))
    for base, suffix in candidates:
        for feature, aliases in FEATURE_ALIASES.items():
            if base in aliases:
                conversion = None
                if suffix is not None:
                    unit_feature, conv = UNIT_SUFFIXES[suffix]
                    if unit_feature != feature:
                        continue  # e.g. 'duration_c' makes no sense - skip
                    conversion = conv
                if feature == "conductivity" and base in ("resistance", "resistivity"):
                    conversion = "reciprocal"
                quality = "exact" if base == feature and suffix is None else "alias"
                return ColumnMatch(feature, column, quality, conversion, ALIAS_NOTES.get(base))
    for feature, aliases in FEATURE_ALIASES.items():
        for alias in sorted(aliases, key=len, reverse=True):
            if len(alias) >= 4 and re.search(rf"(^|_){re.escape(alias)}(_|$)", norm):
                conversion = "reciprocal" if alias in ("resistance", "resistivity") else None
                return ColumnMatch(feature, column, "fuzzy", conversion, f"fuzzy match on '{alias}' - please confirm")
    return None


def detect_mapping(columns: list[str]) -> dict[str, Any]:
    """Automatic schema detection using the alias table (manual override possible)."""
    rank = {"exact": 0, "alias": 1, "fuzzy": 2}
    best: dict[str, ColumnMatch] = {}
    for col in columns:
        m = _match_column(col)
        if m is None:
            continue
        current = best.get(m.feature)
        if current is None or rank[m.quality] < rank[current.quality]:
            best[m.feature] = m

    norm_cols = {c: normalize_column(c) for c in columns}
    used = {m.column for m in best.values()}
    label_column = next((c for alias in LABEL_ALIASES for c in columns if norm_cols[c] == alias and c not in used), None)
    id_column = next(
        (c for alias in ID_ALIASES for c in columns if norm_cols[c] == alias and c not in used and c != label_column),
        None,
    )
    notes = [f"{m.column} -> {m.feature}: {m.note}" for m in best.values() if m.note]
    for feature, m in best.items():
        if m.conversion and m.conversion != "reciprocal":
            notes.append(f"{m.column} -> {feature}: unit conversion {CONVERSIONS[m.conversion][0]}")
    return {
        "features": {f: (best[f].column if f in best else None) for f in FEATURES},
        "conversions": {f: (best[f].conversion if f in best else None) for f in FEATURES},
        "quality": {f: (best[f].quality if f in best else None) for f in FEATURES},
        "label_column": label_column,
        "id_column": id_column,
        "notes": notes,
        "auto": True,
    }


def apply_manual_mapping(columns: list[str], current: Mapping[str, Any], update: Mapping[str, Any]) -> dict[str, Any]:
    """Validate and apply a user-supplied mapping on top of the current one."""
    features = dict(current.get("features", {}))
    conversions = dict(current.get("conversions", {}))
    quality = dict(current.get("quality", {}))
    for feature, column in (update.get("features") or {}).items():
        if feature not in FEATURES:
            raise UploadError(f"Unknown feature '{feature}'", "invalid_mapping")
        if column is not None and column not in columns:
            raise UploadError(f"Column '{column}' does not exist in the dataset", "invalid_mapping")
        if features.get(feature) != column:
            features[feature] = column
            quality[feature] = "manual" if column else None
            conversions[feature] = None
            if column:
                match = _match_column(column)
                if match and match.feature == feature:
                    conversions[feature] = match.conversion
    for feature, conv in (update.get("conversions") or {}).items():
        if feature not in FEATURES:
            raise UploadError(f"Unknown feature '{feature}'", "invalid_mapping")
        if conv is not None and conv not in CONVERSIONS:
            raise UploadError(f"Unknown unit conversion '{conv}'", "invalid_mapping")
        conversions[feature] = conv
    chosen = [c for c in features.values() if c]
    duplicates = [c for c, n in Counter(chosen).items() if n > 1]
    if duplicates:
        raise UploadError(f"Column(s) mapped to more than one feature: {', '.join(duplicates)}", "invalid_mapping")

    label_column = update.get("label_column", current.get("label_column"))
    id_column = update.get("id_column", current.get("id_column"))
    for col in (label_column, id_column):
        if col is not None and col not in columns:
            raise UploadError(f"Column '{col}' does not exist in the dataset", "invalid_mapping")
    notes = [n for n in current.get("notes", []) if any(n.startswith(f"{c} ->") for c in chosen)]
    for f, conv in conversions.items():
        if conv and features.get(f):
            note = f"{features[f]} -> {f}: unit conversion {CONVERSIONS[conv][0]}"
            if note not in notes and conv != "reciprocal":
                notes.append(note)
    return {
        "features": features,
        "conversions": conversions,
        "quality": quality,
        "label_column": label_column,
        "id_column": id_column,
        "notes": notes,
        "auto": False,
    }


# --------------------------------------------------------------------------- parse
@dataclass
class ParsedTable:
    file_format: str
    columns: list[str]
    rows: list[dict[str, Any]]
    notes: list[str] = field(default_factory=list)


def _decode(content: bytes) -> tuple[str, list[str]]:
    if b"\x00" in content[:8192]:
        raise UploadError("The file appears to be binary, not CSV/JSON text", "binary_file")
    try:
        return content.decode("utf-8-sig"), []
    except UnicodeDecodeError:
        return content.decode("latin-1"), ["File is not valid UTF-8; decoded as Latin-1"]


def _clean_cell(value: Any) -> Any:
    if isinstance(value, str):
        value = value.strip()
        return value[:MAX_CELL_CHARS]
    if isinstance(value, bool) or value is None:
        return value
    if isinstance(value, (int, float)):
        return value if not (isinstance(value, float) and not math.isfinite(value)) else str(value)
    return json.dumps(value)[:MAX_CELL_CHARS]  # nested list/dict -> inert text


def _unique_headers(headers: Iterable[Any]) -> tuple[list[str], list[str]]:
    seen: Counter[str] = Counter()
    out, notes = [], []
    for i, h in enumerate(headers):
        name = str(h).strip()[:80] if h is not None else ""
        if not name:
            name = f"column_{i + 1}"
            notes.append(f"Empty header in position {i + 1} renamed to '{name}'")
        if seen[name]:
            new = f"{name}_{seen[name] + 1}"
            notes.append(f"Duplicate header '{name}' renamed to '{new}'")
            seen[name] += 1
            name = new
        seen[name] += 1
        out.append(name)
    return out, notes


def parse_csv(text: str, max_rows: int) -> ParsedTable:
    sample = text[:8192]
    try:
        dialect = csv.Sniffer().sniff(sample, delimiters=",;\t|")
        delimiter = dialect.delimiter
    except csv.Error:
        delimiter = ","
    reader = csv.reader(io.StringIO(text), delimiter=delimiter, skipinitialspace=True)
    try:
        header = next(reader)
    except StopIteration:
        raise UploadError("The CSV file is empty", "empty_file") from None
    except csv.Error as exc:
        raise UploadError(f"Malformed CSV: {exc}", "malformed_csv") from None
    columns, notes = _unique_headers(header)
    if len(columns) > MAX_COLUMNS:
        raise UploadError(f"Too many columns ({len(columns)}); maximum is {MAX_COLUMNS}", "too_many_columns")
    rows: list[dict[str, Any]] = []
    ragged = 0
    try:
        for line_no, record in enumerate(reader, start=2):
            if not record or all(not c.strip() for c in record):
                continue  # skip blank lines
            if len(rows) >= max_rows:
                raise UploadError(f"Too many rows; the maximum is {max_rows}", "too_many_rows")
            if len(record) != len(columns):
                ragged += 1
                if ragged <= 3:
                    notes.append(f"Line {line_no}: expected {len(columns)} fields, found {len(record)}")
                record = (record + [""] * len(columns))[: len(columns)]
            rows.append({c: _clean_cell(v) for c, v in zip(columns, record)})
    except csv.Error as exc:
        raise UploadError(f"Malformed CSV: {exc}", "malformed_csv") from None
    if ragged > 3:
        notes.append(f"{ragged} lines had the wrong number of fields (padded/truncated)")
    if delimiter != ",":
        notes.append(f"Detected delimiter {delimiter!r}")
    return ParsedTable("csv", columns, rows, notes)


def _flatten(obj: Mapping[str, Any], prefix: str = "", depth: int = 0) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for k, v in obj.items():
        key = f"{prefix}{k}"
        if isinstance(v, Mapping) and depth < 2:
            out.update(_flatten(v, key + ".", depth + 1))
        else:
            out[key] = v
    return out


def parse_json(text: str, max_rows: int) -> ParsedTable:
    notes: list[str] = []
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        lines = [ln for ln in text.splitlines() if ln.strip()]
        try:
            data = [json.loads(ln) for ln in lines]
            notes.append("Parsed as JSON Lines (one object per line)")
        except json.JSONDecodeError:
            raise UploadError(f"Invalid JSON: {exc.msg} (line {exc.lineno}, column {exc.colno})", "malformed_json") from None

    if isinstance(data, Mapping):
        if isinstance(data.get("columns"), list) and isinstance(data.get("data"), list):
            cols = [str(c) for c in data["columns"]]
            records = []
            for r in data["data"]:
                if not isinstance(r, list):
                    raise UploadError("'data' must contain arrays when 'columns' is given", "malformed_json")
                records.append(dict(zip(cols, r)))
            data = records
        else:
            for key in ("data", "rows", "samples", "records", "items", "readings"):
                if isinstance(data.get(key), list):
                    data = data[key]
                    break
            else:
                data = [data]  # single sample object
    if not isinstance(data, list):
        raise UploadError("JSON must be an array of objects (or {\"data\": [...]})", "malformed_json")
    if len(data) > max_rows:
        raise UploadError(f"Too many rows ({len(data)}); the maximum is {max_rows}", "too_many_rows")
    rows_raw = []
    for i, item in enumerate(data):
        if not isinstance(item, Mapping):
            raise UploadError(f"Item {i} is not a JSON object", "malformed_json")
        rows_raw.append(_flatten(item))
    columns: list[str] = []
    for r in rows_raw:
        for k in r:
            if k not in columns:
                columns.append(k)
    if len(columns) > MAX_COLUMNS:
        raise UploadError(f"Too many fields ({len(columns)}); maximum is {MAX_COLUMNS}", "too_many_columns")
    rows = [{c: _clean_cell(r.get(c)) for c in columns} for r in rows_raw]
    return ParsedTable("json", columns, rows, notes)


def parse_upload(filename: str, content: bytes, max_bytes: int, max_rows: int) -> ParsedTable:
    name = (filename or "").lower()
    ext = next((e for e in ALLOWED_EXTENSIONS if name.endswith(e)), None)
    if ext is None:
        raise UploadError("Unsupported file type. Upload a .csv or .json file", "unsupported_type")
    if len(content) == 0:
        raise UploadError("The file is empty", "empty_file")
    if len(content) > max_bytes:
        raise UploadError(
            f"File is {len(content) / 1048576:.1f} MB; the maximum is {max_bytes / 1048576:.1f} MB", "file_too_large"
        )
    text, notes = _decode(content)
    table = parse_csv(text, max_rows) if ALLOWED_EXTENSIONS[ext] == "csv" else parse_json(text, max_rows)
    if not table.rows:
        raise UploadError("The file contains no data rows", "empty_file")
    table.notes = notes + table.notes
    return table


# --------------------------------------------------------------------------- rows
@dataclass
class ResolvedRow:
    row_index: int
    row_id: str
    features: dict[str, Any]
    label: str | None
    raw_label: Any
    conversions: dict[str, str]


def resolve_row(row: Mapping[str, Any], mapping: Mapping[str, Any], row_index: int) -> ResolvedRow:
    """Apply the column mapping + unit conversions to one raw row.

    Non-numeric cells are passed through untouched so that the shared validator can
    report them precisely ("not a number") instead of silently dropping them.
    """
    features: dict[str, Any] = {}
    applied: dict[str, str] = {}
    for feature in FEATURES:
        column = mapping["features"].get(feature)
        if not column:
            features[feature] = None
            continue
        raw = row.get(column)
        if is_missing(raw):
            features[feature] = None
            continue
        number = coerce_number(raw)
        conv = mapping.get("conversions", {}).get(feature)
        if number is not None and conv:
            number = CONVERSIONS[conv][1](number)
            applied[feature] = conv
        features[feature] = number if number is not None else raw
    id_col = mapping.get("id_column")
    row_id = row.get(id_col) if id_col else None
    row_id_text = str(row_id) if not is_missing(row_id) else str(row_index + 1)
    label_col = mapping.get("label_column")
    raw_label = row.get(label_col) if label_col else None
    return ResolvedRow(
        row_index=row_index,
        row_id=row_id_text[:64],
        features=features,
        label=normalize_material(raw_label) if not is_missing(raw_label) else None,
        raw_label=None if is_missing(raw_label) else raw_label,
        conversions=applied,
    )


def row_view(
    row: Mapping[str, Any], mapping: Mapping[str, Any], row_index: int, ranges: Mapping[str, Any] | None
) -> dict[str, Any]:
    resolved = resolve_row(row, mapping, row_index)
    validation = validate_sample(resolved.features)
    issues = [e.to_dict() for e in validation.errors]
    ood: list[dict] = []
    if validation.ok and ranges:
        ood = out_of_distribution(validation.features, ranges)  # type: ignore[arg-type]
    if resolved.raw_label is not None and resolved.label is None:
        issues.append(
            {"feature": "label", "code": "unknown_label", "message": f"Unrecognised material label '{resolved.raw_label}'", "value": str(resolved.raw_label)}
        )
    status = "invalid" if not validation.ok else ("warning" if ood or issues else "valid")
    return {
        "row_index": row_index,
        "row_id": resolved.row_id,
        "raw": dict(row),
        "features": {k: (v if isinstance(v, (int, float)) and math.isfinite(v) else None) for k, v in resolved.features.items()},
        "label": resolved.label,
        "raw_label": None if resolved.raw_label is None else str(resolved.raw_label),
        "status": status,
        "issues": issues,
        "out_of_distribution": ood,
        "conversions": resolved.conversions,
    }


def summarize(rows: list[Mapping[str, Any]], mapping: Mapping[str, Any], ranges: Mapping[str, Any] | None) -> dict[str, Any]:
    counts = Counter()
    missing = Counter()
    invalid = Counter()
    labels = Counter()
    issues_sample: list[dict] = []
    for i, row in enumerate(rows):
        view = row_view(row, mapping, i, ranges)
        counts[view["status"]] += 1
        for issue in view["issues"]:
            if issue["code"] == "missing":
                missing[issue["feature"]] += 1
            elif issue["feature"] != "label":
                invalid[issue["feature"]] += 1
            if len(issues_sample) < 25:
                issues_sample.append({"row_index": i, "row_id": view["row_id"], **issue})
        if view["label"]:
            labels[view["label"]] += 1
    mapped = [f for f in FEATURES if mapping["features"].get(f)]
    has_labels = bool(mapping.get("label_column")) and sum(labels.values()) > 0
    return {
        "row_count": len(rows),
        "valid_rows": counts["valid"],
        "warning_rows": counts["warning"],
        "invalid_rows": counts["invalid"],
        "simulatable_rows": counts["valid"] + counts["warning"],
        "detected_features": mapped,
        "missing_features": [f for f in FEATURES if f not in mapped],
        "missing_by_feature": {f: missing[f] for f in FEATURES},
        "invalid_by_feature": {f: invalid[f] for f in FEATURES},
        "has_labels": has_labels,
        "label_distribution": dict(labels),
        "issues_sample": issues_sample,
        "feature_units": {f: FEATURE_SPECS[f].unit for f in FEATURES},
    }


CSV_INJECTION_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def safe_csv_cell(value: Any) -> Any:
    """Neutralise spreadsheet formula injection in exported CSV cells."""
    if isinstance(value, str) and value.startswith(CSV_INJECTION_PREFIXES):
        if coerce_number(value) is None:
            return "'" + value
    return value
