from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
from typing import Tuple


def _number(name: str, default: float, minimum: float) -> float:
    try:
        return max(minimum, float(os.getenv(name, str(default))))
    except ValueError:
        return default


def _list(name: str, default: str = "") -> Tuple[str, ...]:
    return tuple(part.strip().rstrip("/") for part in os.getenv(name, default).split(",") if part.strip())


@dataclass(frozen=True)
class Settings:
    environment: str
    worker_secret: str
    storage_dir: Path
    use_celery: bool
    cors_origins: Tuple[str, ...]
    allowed_hosts: Tuple[str, ...]
    callback_origins: Tuple[str, ...]
    max_upload_bytes: int
    max_duration_seconds: float
    max_width: int
    max_height: int
    max_fps: float
    storage_quota_bytes: int
    min_free_bytes: int
    retention_seconds: int
    max_concurrent_jobs: int
    rate_limit_per_minute: int

    @property
    def production(self) -> bool:
        return self.environment.lower() == "production"

    def validate(self) -> None:
        if self.production and (len(self.worker_secret) < 32 or self.worker_secret == "default_secret"):
            raise RuntimeError("CLEANER_WORKER_SECRET deve ter ao menos 32 caracteres em producao")
        if self.production and not self.cors_origins:
            raise RuntimeError("CORS_ORIGINS deve listar a origem HTTPS do aplicativo")
        if self.production and not self.callback_origins:
            raise RuntimeError("CLEANER_CALLBACK_ORIGINS deve listar a origem HTTPS do aplicativo")


def get_settings() -> Settings:
    settings = Settings(
        environment=os.getenv("CLEANER_ENV", "development"),
        worker_secret=os.getenv("CLEANER_WORKER_SECRET", "default_secret"),
        storage_dir=Path(os.getenv("CLEANER_STORAGE", "storage")).resolve(),
        use_celery=os.getenv("USE_CELERY", "0") == "1",
        cors_origins=_list("CORS_ORIGINS"),
        allowed_hosts=_list("CLEANER_ALLOWED_HOSTS", "localhost,127.0.0.1"),
        callback_origins=_list("CLEANER_CALLBACK_ORIGINS"),
        max_upload_bytes=int(_number("CLEANER_MAX_UPLOAD_GB", 2, 0.05) * 1024**3),
        max_duration_seconds=_number("CLEANER_MAX_DURATION_SECONDS", 3600, 1),
        max_width=int(_number("CLEANER_MAX_WIDTH", 3840, 320)),
        max_height=int(_number("CLEANER_MAX_HEIGHT", 2160, 240)),
        max_fps=_number("CLEANER_MAX_FPS", 60, 1),
        storage_quota_bytes=int(_number("CLEANER_STORAGE_QUOTA_GB", 50, 1) * 1024**3),
        min_free_bytes=int(_number("CLEANER_MIN_FREE_GB", 10, 1) * 1024**3),
        retention_seconds=int(_number("CLEANER_RETENTION_HOURS", 72, 1) * 3600),
        max_concurrent_jobs=int(_number("CLEANER_MAX_CONCURRENT_JOBS", 1, 1)),
        rate_limit_per_minute=int(_number("CLEANER_RATE_LIMIT_PER_MINUTE", 120, 10)),
    )
    settings.validate()
    return settings
