from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import time
import uuid
from typing import Dict


def job_dir(storage_dir: Path, job_id: str) -> Path:
    uuid.UUID(job_id)
    root = storage_dir.resolve()
    target = (root / job_id).resolve()
    if target.parent != root:
        raise ValueError("invalid job id")
    return target


def directory_size(path: Path) -> int:
    total = 0
    if not path.exists():
        return 0
    for item in path.rglob("*"):
        try:
            if item.is_file() and not item.is_symlink():
                total += item.stat().st_size
        except OSError:
            continue
    return total


def read_state(directory: Path) -> Dict[str, object]:
    try:
        return json.loads((directory / "state.json").read_text(encoding="utf-8"))
    except (OSError, ValueError, TypeError):
        return {}


def write_state(directory: Path, state: Dict[str, object]) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    state = {**state, "updated_at": int(time.time())}
    temporary = directory / ".state.json.tmp"
    temporary.write_text(json.dumps(state, ensure_ascii=True), encoding="utf-8")
    os.replace(temporary, directory / "state.json")


def cleanup_expired(storage_dir: Path, retention_seconds: int) -> int:
    if not storage_dir.exists():
        return 0
    cutoff = time.time() - retention_seconds
    removed = 0
    for directory in storage_dir.iterdir():
        if not directory.is_dir():
            continue
        state = read_state(directory)
        if state.get("status") in {"processing", "inpainting", "queued", "analyzing", "detecting"}:
            continue
        try:
            updated = float(state.get("updated_at") or directory.stat().st_mtime)
        except (OSError, TypeError, ValueError):
            continue
        if updated < cutoff:
            shutil.rmtree(directory, ignore_errors=True)
            removed += 1
    return removed
