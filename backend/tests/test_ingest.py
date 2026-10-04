"""External CSV/JSON parsing, schema detection, mapping and validation."""

from __future__ import annotations

import json

import pytest

from app.ingest.parser import (
    UploadError,
    apply_manual_mapping,
    detect_mapping,
    parse_upload,
    resolve_row,
    safe_csv_cell,
    summarize,
)

MB = 1024 * 1024
CSV = b"""row_id,pressure,temperature,vibration,conductivity,contact_duration,material
1,231.4,27.1,2810.5,1.8e-12,0.142,Glass
2,35.2,32.3,22.0,4.1e-11,1.21,fabric
3,,29.0,500,1e-12,0.4,Plastic
4,abc,29.0,500,1e-12,0.4,unobtainium
"""


def parse(name: str, content: bytes, max_rows: int = 1000):
    return parse_upload(name, content, 5 * MB, max_rows)


def test_parse_csv_and_auto_mapping():
    t = parse("data.csv", CSV)
    assert t.file_format == "csv" and len(t.rows) == 4
    m = detect_mapping(t.columns)
    assert m["features"] == {f: f for f in ("pressure", "temperature", "vibration", "conductivity", "contact_duration")}
    assert m["label_column"] == "material" and m["id_column"] == "row_id"
    assert all(q == "exact" for q in m["quality"].values())


def test_summary_detects_missing_invalid_and_labels(registry):
    t = parse("data.csv", CSV)
    m = detect_mapping(t.columns)
    s = summarize(t.rows, m, registry.metadata["feature_ranges"])
    assert s["row_count"] == 4
    assert s["invalid_rows"] == 2
    assert s["missing_by_feature"]["pressure"] == 1
    assert s["invalid_by_feature"]["pressure"] == 1
    assert s["has_labels"] is True
    assert s["label_distribution"] == {"Glass": 1, "Fabric": 1, "Plastic": 1}
    codes = {i["code"] for i in s["issues_sample"]}
    assert {"missing", "not_numeric", "unknown_label"} <= codes


def test_resolve_row_keeps_exact_values_and_normalises_label():
    t = parse("data.csv", CSV)
    m = detect_mapping(t.columns)
    r = resolve_row(t.rows[1], m, 1)
    assert r.row_id == "2"
    assert r.features == {"pressure": 35.2, "temperature": 32.3, "vibration": 22.0, "conductivity": 4.1e-11, "contact_duration": 1.21}
    assert r.label == "Fabric"


def test_semicolon_delimiter_and_aliases_with_units():
    content = "id;Force;Temp (°F);imu;Resistance;contact_time_ms;class\n7;120;80.6;900;2e11;350;wood\n".encode()
    t = parse("eu.csv", content)
    m = detect_mapping(t.columns)
    assert m["features"]["pressure"] == "Force"
    assert m["conversions"]["temperature"] == "f_to_c"
    assert m["conversions"]["conductivity"] == "reciprocal"
    assert m["conversions"]["contact_duration"] == "ms_to_s"
    r = resolve_row(t.rows[0], m, 0)
    assert r.features["temperature"] == pytest.approx(27.0)
    assert r.features["conductivity"] == pytest.approx(5e-12)
    assert r.features["contact_duration"] == pytest.approx(0.35)
    assert r.label == "Wood" and r.row_id == "7"
    assert any("verify units" in n for n in m["notes"])


@pytest.mark.parametrize(
    "payload",
    [
        [{"pressure": 1, "temperature": 2, "vibration": 3, "conductivity": 4, "contact_duration": 5}],
        {"data": [{"pressure": 1, "temperature": 2, "vibration": 3, "conductivity": 4, "contact_duration": 5}]},
        {"columns": ["pressure", "temperature", "vibration", "conductivity", "contact_duration"], "data": [[1, 2, 3, 4, 5]]},
        {"samples": [{"sensors": {"pressure": 1, "temperature": 2, "vibration": 3, "conductivity": 4, "contact_duration": 5}}]},
    ],
)
def test_json_variants(payload):
    t = parse("d.json", json.dumps(payload).encode())
    m = detect_mapping(t.columns)
    r = resolve_row(t.rows[0], m, 0)
    assert r.features == {"pressure": 1, "temperature": 2, "vibration": 3, "conductivity": 4, "contact_duration": 5}


def test_json_lines():
    content = b'{"pressure": 1, "temperature": 2}\n{"pressure": 3, "temperature": 4}\n'
    t = parse("d.jsonl", content)
    assert len(t.rows) == 2 and t.rows[1]["pressure"] == 3


def test_manual_mapping_override_and_duplicate_rejection():
    content = b"a,b,c,d,e\n200,25,2000,1e-12,0.2\n"
    t = parse("anon.csv", content)
    m = detect_mapping(t.columns)
    assert all(v is None for v in m["features"].values())
    m2 = apply_manual_mapping(
        t.columns, m, {"features": {"pressure": "a", "temperature": "b", "vibration": "c", "conductivity": "d", "contact_duration": "e"}}
    )
    assert resolve_row(t.rows[0], m2, 0).features["vibration"] == 2000
    assert m2["quality"]["pressure"] == "manual"
    with pytest.raises(UploadError):
        apply_manual_mapping(t.columns, m2, {"features": {"temperature": "a"}})
    with pytest.raises(UploadError):
        apply_manual_mapping(t.columns, m2, {"features": {"pressure": "nonexistent"}})
    with pytest.raises(UploadError):
        apply_manual_mapping(t.columns, m2, {"conversions": {"pressure": "rm -rf"}})


@pytest.mark.parametrize(
    "name,content,code",
    [
        ("evil.py", b"import os", "unsupported_type"),
        ("data.xlsx", b"PK..", "unsupported_type"),
        ("data.csv", b"", "empty_file"),
        ("data.csv", b"pressure\n", "empty_file"),
        ("data.csv", b"\x00\x01\x02binary", "binary_file"),
        ("data.json", b"{not json", "malformed_json"),
        ("data.json", b"[1, 2, 3]", "malformed_json"),
    ],
)
def test_rejects_unsafe_or_malformed_files(name, content, code):
    with pytest.raises(UploadError) as exc:
        parse(name, content)
    assert exc.value.code == code


def test_size_and_row_limits():
    with pytest.raises(UploadError) as exc:
        parse_upload("big.csv", b"a\n" + b"1\n" * 600_000, 1 * MB, 10**6)
    assert exc.value.code == "file_too_large"
    with pytest.raises(UploadError) as exc:
        parse("many.csv", b"a\n" + b"1\n" * 50, max_rows=10)
    assert exc.value.code == "too_many_rows"


def test_uploaded_content_is_inert_text():
    content = b'pressure,temperature,vibration,conductivity,contact_duration,material\n"=1+1",25,2000,1e-12,0.2,"__import__(\'os\')"\n'
    t = parse("x.csv", content)
    assert t.rows[0]["pressure"] == "=1+1"  # stored as text, never evaluated
    assert safe_csv_cell("=1+1") == "'=1+1"
    assert safe_csv_cell("@SUM(A1)") == "'@SUM(A1)"
    assert safe_csv_cell("-5.2") == "-5.2"  # negative numbers are untouched
    assert safe_csv_cell(3.0) == 3.0
