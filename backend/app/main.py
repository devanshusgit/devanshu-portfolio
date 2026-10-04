"""NeuroGrip FastAPI application factory."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from app import __version__
from app.api.routes import auth, datasets, history, model, predict, sensors, settings, system
from app.core.config import Settings, get_settings
from app.core.context import AppContext
from app.ingest.parser import UploadError
from app.ml.registry import ModelBusyError, ModelNotReadyError
from app.services.accounts import seed_accounts
from app.services.pipeline import SampleValidationError

log = logging.getLogger("neurogrip")


def _startup(ctx: AppContext) -> None:
    ctx.db.create_all()
    with ctx.db.SessionLocal() as db:
        seed_accounts(db, ctx.settings)
    trained_now = not ctx.registry.ready and not ctx.registry.load()
    if trained_now and ctx.settings.train_on_startup_if_missing:
        meta = ctx.registry.train()
        with ctx.db.SessionLocal() as db:
            model.record_run(db, meta, "startup (no artifact found)")


def create_app(app_settings: Settings | None = None) -> FastAPI:
    app_settings = app_settings or get_settings()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    ctx = AppContext.build(app_settings)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        await run_in_threadpool(_startup, ctx)
        log.info("NeuroGrip ready (db=%s, model=%s)", ctx.db.backend, ctx.registry.metadata.get("version") if ctx.registry.ready else None)
        yield
        await ctx.live.shutdown()
        ctx.db.engine.dispose()

    app = FastAPI(
        title="NeuroGrip API",
        version=__version__,
        description=(
            "AI-powered virtual prosthetic hand intelligence platform. "
            "SENSE -> UNDERSTAND -> DECIDE -> ACT. Sensor values are SIMULATED unless "
            "real hardware is connected; grip values are normalised simulation percentages."
        ),
        lifespan=lifespan,
    )
    app.state.ctx = ctx

    app.add_middleware(
        CORSMiddleware,
        allow_origins=app_settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Device-Key"],
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
        return response

    # ------------------------------------------------------- error handling
    @app.exception_handler(SampleValidationError)
    async def _sample_invalid(_: Request, exc: SampleValidationError):
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={
                "detail": "Sensor sample failed validation",
                "code": "invalid_sample",
                "errors": [e.to_dict() for e in exc.errors],
            },
        )

    @app.exception_handler(UploadError)
    async def _upload_error(_: Request, exc: UploadError):
        code = status.HTTP_413_CONTENT_TOO_LARGE if exc.code == "file_too_large" else status.HTTP_400_BAD_REQUEST
        return JSONResponse(status_code=code, content={"detail": str(exc), "code": exc.code})

    @app.exception_handler(ModelNotReadyError)
    async def _not_ready(_: Request, exc: ModelNotReadyError):
        return JSONResponse(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, content={"detail": str(exc), "code": "model_not_ready"})

    @app.exception_handler(ModelBusyError)
    async def _busy(_: Request, exc: ModelBusyError):
        return JSONResponse(status_code=status.HTTP_409_CONFLICT, content={"detail": str(exc), "code": "model_busy"})

    @app.exception_handler(ValueError)
    async def _value_error(_: Request, exc: ValueError):
        return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content={"detail": str(exc), "code": "bad_request"})

    @app.exception_handler(RequestValidationError)
    async def _request_invalid(_: Request, exc: RequestValidationError):
        errors = [
            {"loc": [str(p) for p in e.get("loc", [])], "message": e.get("msg", ""), "type": e.get("type", "")}
            for e in exc.errors()
        ]
        first = errors[0] if errors else None
        summary = f"{'.'.join(first['loc'][1:]) or 'request'}: {first['message']}" if first else "Invalid request"
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            content={"detail": summary, "code": "invalid_request", "errors": errors},
        )

    for module in (system, auth, predict, datasets, sensors, history, model, settings):
        app.include_router(module.router)
    app.include_router(sensors.ws_router)
    return app


app = create_app()  # uvicorn app.main:app
