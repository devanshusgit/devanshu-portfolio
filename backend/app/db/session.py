"""Engine / session factory. PostgreSQL in production, SQLite as the dev fallback."""

from __future__ import annotations

from collections.abc import Iterator

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


class Base(DeclarativeBase):
    pass


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
