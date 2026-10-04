"""Single-container hosting: the API can also serve the built SPA."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import create_app
from tests.conftest import make_settings


def test_serves_spa_with_fallback_and_keeps_api(tmp_path, model_dir):
    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<html>neurogrip-spa</html>")
    (dist / "assets" / "app.js").write_text("console.log(1)")
    (dist / "favicon.svg").write_text("<svg/>")
    (tmp_path / "secret.txt").write_text("do-not-serve")

    app = create_app(make_settings(tmp_path, model_dir, frontend_dist=dist))
    with TestClient(app) as c:
        assert "neurogrip-spa" in c.get("/").text
        assert "neurogrip-spa" in c.get("/lab").text  # client-side route
        assert c.get("/assets/app.js").text == "console.log(1)"
        assert c.get("/favicon.svg").text == "<svg/>"
        assert c.get("/api/health").json()["status"] == "ok"
        assert c.get("/api/does-not-exist").status_code == 404
        assert "do-not-serve" not in c.get("/../secret.txt").text
        assert "do-not-serve" not in c.get("/%2e%2e/secret.txt").text
