"""Engine / session factory. PostgreSQL in production, SQLite as the dev fallback."""

from __future__ import annotations

import logging
import re
from collections.abc import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


log = logging.getLogger(__name__)

_SUPABASE_POOLER = re.compile(r"@aws-(\d)-([a-z0-9-]+)\.pooler\.supabase\.com")


class Base(DeclarativeBase):
    pass


def resolve_supabase_pooler(database_url: str) -> str:
    """Supabase pooler hosts are ``aws-0-<region>`` or ``aws-1-<region>`` depending
    on project age. If the configured one rejects the tenant, try the alternatives."""
    m = _SUPABASE_POOLER.search(database_url)
    if not m:
        return database_url
    candidates = [database_url] + [
        _SUPABASE_POOLER.sub(f"@aws-{n}-{m.group(2)}.pooler.supabase.com", database_url, count=1)
        for n in ("0", "1", "2")
        if n != m.group(1)
    ]
    for url in candidates:
        engine = create_engine(url, pool_pre_ping=True, poolclass=None)
        try:
            with engine.connect():
                pass
            if url != database_url:
                log.warning("Using Supabase pooler host %s", _SUPABASE_POOLER.search(url).group(0)[1:])
            return url
        except Exception as exc:  # pragma: no cover - network dependent
            if "tenant" not in str(exc).lower():
                return database_url  # a different problem: surface it normally
        finally:
            engine.dispose()
    return database_url


def make_engine(database_url: str, pool_size: int = 10, max_overflow: int = 20) -> Engine:
    if database_url.startswith("sqlite"):
        engine = create_engine(
            database_url,
            connect_args={"check_same_thread": False},
            pool_pre_ping=True,
        )

        @event.listens_for(engine, "connect")
        def _sqlite_pragmas(dbapi_conn, _record):  # pragma: no cover - trivial
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            cur.execute("PRAGMA journal_mode=WAL")
            cur.close()

        return engine
    return create_engine(database_url, pool_pre_ping=True, pool_size=pool_size, max_overflow=max_overflow, pool_recycle=300)


class Database:
    def __init__(self, database_url: str, pool_size: int = 10, max_overflow: int = 20):
        database_url = resolve_supabase_pooler(database_url)
        self.url = database_url
        self.engine = make_engine(database_url, pool_size, max_overflow)
        self.SessionLocal = sessionmaker(bind=self.engine, autoflush=False, expire_on_commit=False)

    def create_all(self) -> None:
        from app.db import models  # noqa: F401 - register models

        Base.metadata.create_all(self.engine)

    def session(self) -> Iterator[Session]:
        db = self.SessionLocal()
        try:
            yield db
        finally:
            db.close()

    @property
    def backend(self) -> str:
        return self.engine.dialect.name
