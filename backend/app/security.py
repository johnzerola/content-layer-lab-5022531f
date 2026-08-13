from __future__ import annotations

import hashlib
import hmac
import ipaddress
import os
import socket
import time
from typing import Iterable, Optional
from urllib.parse import urlsplit
import uuid


TOKEN_VERSION = "v2"
TOKEN_SCOPES = frozenset({"upload", "control", "result"})
SERVICE_TOKEN_SCOPES = frozenset({"media"})


class TokenError(ValueError):
    pass


def _signature(secret: str, value: str) -> str:
    return hmac.new(secret.encode(), value.encode(), hashlib.sha256).hexdigest()


def create_job_token(
    secret: str,
    job_id: str,
    scope: str,
    ttl_seconds: int,
    now: Optional[int] = None,
) -> str:
    uuid.UUID(job_id)
    if scope not in TOKEN_SCOPES:
        raise ValueError("invalid token scope")
    expires = (int(time.time()) if now is None else now) + max(1, ttl_seconds)
    payload = f"{TOKEN_VERSION}.{job_id}.{expires}.{scope}"
    return f"{payload}.{_signature(secret, payload)}"


def validate_job_token(
    secret: str,
    job_id: str,
    token: Optional[str],
    allowed_scopes: Iterable[str],
    now: Optional[int] = None,
) -> str:
    if not token:
        raise TokenError("missing job token")
    parts = token.split(".")
    if len(parts) != 5 or parts[0] != TOKEN_VERSION or parts[1] != job_id:
        raise TokenError("invalid job token")
    _, _, expires_text, scope, supplied = parts
    allowed = set(allowed_scopes)
    if scope not in TOKEN_SCOPES or scope not in allowed:
        raise TokenError("token scope not allowed")
    try:
        expires = int(expires_text)
    except ValueError as exc:
        raise TokenError("invalid token expiry") from exc
    current = int(time.time()) if now is None else now
    if expires < current:
        raise TokenError("expired job token")
    expected = _signature(secret, ".".join(parts[:4]))
    if not hmac.compare_digest(expected, supplied):
        raise TokenError("invalid job token")
    return scope


def create_service_token(
    secret: str, scope: str, ttl_seconds: int, now: Optional[int] = None
) -> str:
    if scope not in SERVICE_TOKEN_SCOPES:
        raise ValueError("invalid service token scope")
    expires = (int(time.time()) if now is None else now) + max(1, ttl_seconds)
    payload = f"{TOKEN_VERSION}.service.{expires}.{scope}"
    return f"{payload}.{_signature(secret, payload)}"


def validate_service_token(
    secret: str, token: Optional[str], allowed_scopes: Iterable[str], now: Optional[int] = None
) -> str:
    if not token:
        raise TokenError("missing service token")
    parts = token.split(".")
    if len(parts) != 5 or parts[0] != TOKEN_VERSION or parts[1] != "service":
        raise TokenError("invalid service token")
    _, _, expires_text, scope, supplied = parts
    if scope not in SERVICE_TOKEN_SCOPES or scope not in set(allowed_scopes):
        raise TokenError("service token scope not allowed")
    try:
        expires = int(expires_text)
    except ValueError as exc:
        raise TokenError("invalid service token expiry") from exc
    current = int(time.time()) if now is None else now
    if expires < current:
        raise TokenError("expired service token")
    expected = _signature(secret, ".".join(parts[:4]))
    if not hmac.compare_digest(expected, supplied):
        raise TokenError("invalid service token")
    return scope


def callback_signature(secret: str, timestamp: str, body: str) -> str:
    return _signature(secret, f"{timestamp}.{body}")


def validate_callback_url(url: Optional[str], allowed_origins: Iterable[str]) -> Optional[str]:
    if not url:
        return None
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise ValueError("callback URL must be a plain HTTPS URL")
    origin = f"{parsed.scheme}://{parsed.hostname.lower()}"
    if parsed.port and parsed.port != 443:
        origin += f":{parsed.port}"
    normalized_allowed = {item.rstrip("/").lower() for item in allowed_origins}
    if origin not in normalized_allowed:
        raise ValueError("callback origin is not allowed")

    # An exact origin allowlist is the primary SSRF control. Public DNS is also
    # required so an accidentally private hostname cannot reach local services.
    for result in socket.getaddrinfo(parsed.hostname, parsed.port or 443, type=socket.SOCK_STREAM):
        address = ipaddress.ip_address(result[4][0])
        if not address.is_global:
            raise ValueError("callback host resolves to a private address")
    return url


def callback_timestamp_valid(timestamp: Optional[str], max_age_seconds: int = 300) -> bool:
    if not timestamp:
        return False
    try:
        value = int(timestamp)
    except ValueError:
        return False
    return abs(int(time.time()) - value) <= max_age_seconds
