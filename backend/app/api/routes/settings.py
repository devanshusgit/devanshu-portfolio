from __future__ import annotations

import time

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func, select

from app.api.deps import DB, AdminUser, Ctx, CurrentUser
from app.api.routes.auth import user_public
from app.db.models import Dataset, ModelTrainingRun, PredictionHistory, User
from app.schemas.api import AdminUserUpdate, SystemSettingsUpdate, UserSettingsUpdate
from app.services.accounts import (
    get_or_create_user_settings,
    get_system_settings,
    update_system_settings,
    user_settings_dict,
)

router = APIRouter(prefix="/api", tags=["settings & admin"])


@router.get("/settings")
def get_settings(db: DB, user: CurrentUser):
    system = get_system_settings(db)
    return {
        "user": user_settings_dict(get_or_create_user_settings(db, user)),
        "system": {"announcement": system["announcement"], "allow_registration": system["allow_registration"]},
    }


@router.put("/settings")
def put_settings(body: UserSettingsUpdate, db: DB, user: CurrentUser):
    s = get_or_create_user_settings(db, user)
    for key, value in body.model_dump(exclude_unset=True, exclude_none=True).items():
        setattr(s, key, value)
    db.commit()
    return {"user": user_settings_dict(s)}


@router.get("/settings/public")
def public_settings(db: DB):
    system = get_system_settings(db)
    return {"announcement": system["announcement"], "allow_registration": system["allow_registration"]}


# ----------------------------------------------------------------------- admin
@router.get("/admin/stats")
def admin_stats(ctx: Ctx, db: DB, admin: AdminUser):
    by_source = dict(db.execute(select(PredictionHistory.data_source, func.count()).group_by(PredictionHistory.data_source)).all())
    by_safety = dict(db.execute(select(PredictionHistory.safety_status, func.count()).group_by(PredictionHistory.safety_status)).all())
    by_role = dict(db.execute(select(User.role, func.count()).group_by(User.role)).all())
    labeled = db.scalar(select(func.count()).where(PredictionHistory.is_correct.is_not(None))) or 0
    correct = db.scalar(select(func.count()).where(PredictionHistory.is_correct.is_(True))) or 0
    reg = ctx.registry
    return {
        "users": {
            "total": db.scalar(select(func.count()).select_from(User)) or 0,
            "active": db.scalar(select(func.count()).where(User.is_active.is_(True))) or 0,
            "by_role": by_role,
        },
        "predictions": {
            "total": db.scalar(select(func.count()).select_from(PredictionHistory)) or 0,
            "by_source": by_source,
            "by_safety": by_safety,
            "labeled": labeled,
            "labeled_accuracy": round(correct / labeled, 4) if labeled else None,
        },
        "datasets": {
            "total": db.scalar(select(func.count()).select_from(Dataset)) or 0,
            "rows": db.scalar(select(func.coalesce(func.sum(Dataset.row_count), 0))) or 0,
        },
        "model": {
            "ready": reg.ready,
            "training": reg.training,
            "version": reg.metadata["version"] if reg.ready else None,
            "accuracy": reg.metadata["metrics"]["accuracy"] if reg.ready else None,
            "training_runs": db.scalar(select(func.count()).select_from(ModelTrainingRun)) or 0,
        },
        "live": ctx.live.status(),
        "system": {
            "environment": ctx.settings.environment,
            "database": ctx.db.backend,
            "uptime_s": round(time.time() - ctx.started_at, 1),
        },
    }


@router.get("/admin/users")
def admin_users(db: DB, admin: AdminUser):
    users = db.scalars(select(User).order_by(User.created_at)).all()
    counts = dict(db.execute(select(PredictionHistory.user_id, func.count()).group_by(PredictionHistory.user_id)).all())
    return {"users": [{**user_public(u), "predictions": counts.get(u.id, 0)} for u in users]}


@router.patch("/admin/users/{user_id}")
def admin_update_user(user_id: int, body: AdminUserUpdate, db: DB, admin: AdminUser):
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if target.id == admin.id and (body.role == "USER" or body.is_active is False):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "You cannot demote or deactivate your own account")
    if body.role is not None:
        target.role = body.role
    if body.is_active is not None:
        target.is_active = body.is_active
    db.commit()
    return user_public(target)


@router.get("/admin/system-settings")
def admin_get_system(db: DB, admin: AdminUser):
    return get_system_settings(db)


@router.put("/admin/system-settings")
def admin_put_system(body: SystemSettingsUpdate, db: DB, admin: AdminUser):
    return update_system_settings(db, body.model_dump(exclude_unset=True, exclude_none=True))
