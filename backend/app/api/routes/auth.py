from __future__ import annotations

import time
from collections import defaultdict, deque
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request, status
from sqlalchemy import select

from app.api.deps import DB, Ctx, CurrentUser
from app.core.security import create_access_token, hash_password, verify_password
from app.db.models import User
from app.schemas.api import LoginRequest, PasswordChange, ProfileUpdate, RegisterRequest
from app.services.accounts import create_user, get_system_settings

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Simple in-process brute-force throttle: max 10 failed logins / 5 min per email+IP.
_FAILED: dict[str, deque[float]] = defaultdict(deque)
_WINDOW_S = 300.0
_MAX_FAILS = 10


def _throttle_key(request: Request, email: str) -> str:
    host = request.client.host if request.client else "unknown"
    return f"{email.lower()}|{host}"


def _check_throttle(key: str) -> None:
    q = _FAILED[key]
    now = time.monotonic()
    while q and now - q[0] > _WINDOW_S:
        q.popleft()
    if len(q) >= _MAX_FAILS:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many failed login attempts. Try again later.")


def user_public(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role,
        "is_active": user.is_active,
        "created_at": user.created_at.isoformat() if user.created_at else None,
        "last_login_at": user.last_login_at.isoformat() if user.last_login_at else None,
    }


def token_response(ctx, user: User) -> dict:
    token = create_access_token(
        str(user.id), user.role, ctx.settings.secret_key, ctx.settings.jwt_algorithm, ctx.settings.access_token_expire_minutes
    )
    return {
        "access_token": token,
        "token_type": "bearer",
        "expires_in": ctx.settings.access_token_expire_minutes * 60,
        "user": user_public(user),
    }


@router.post("/register", status_code=status.HTTP_201_CREATED)
def register(body: RegisterRequest, ctx: Ctx, db: DB):
    if not get_system_settings(db)["allow_registration"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Registration is currently disabled by the administrator")
    if db.scalar(select(User).where(User.email == body.email.lower())) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists")
    user = create_user(db, body.email, body.password, body.full_name, role="USER")
    return token_response(ctx, user)


@router.post("/login")
def login(body: LoginRequest, request: Request, ctx: Ctx, db: DB):
    key = _throttle_key(request, body.email)
    _check_throttle(key)
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if user is None or not verify_password(body.password, user.hashed_password):
        _FAILED[key].append(time.monotonic())
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Incorrect email or password")
    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account has been deactivated")
    _FAILED.pop(key, None)
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    return token_response(ctx, user)


@router.get("/me")
def me(user: CurrentUser):
    return user_public(user)


@router.patch("/me")
def update_me(body: ProfileUpdate, user: CurrentUser, db: DB):
    user.full_name = body.full_name.strip()
    db.commit()
    return user_public(user)


@router.post("/change-password")
def change_password(body: PasswordChange, user: CurrentUser, db: DB):
    if not verify_password(body.current_password, user.hashed_password):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")
    user.hashed_password = hash_password(body.new_password)
    db.commit()
    return {"ok": True}
