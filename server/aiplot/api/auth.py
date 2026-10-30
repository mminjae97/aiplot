"""Bearer token check for every /api/v1 route (§16); Electron passes it as AIPLOT_TOKEN."""

import hmac
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from aiplot.api.errors import AppError

bearer = HTTPBearer(auto_error=False)


def require_token(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> None:
    expected: str = request.app.state.token
    # Bytes: compare_digest rejects non-ASCII str, and client headers can contain anything.
    if credentials is None or not hmac.compare_digest(
        credentials.credentials.encode(), expected.encode()
    ):
        raise AppError(
            401,
            "UNAUTHORIZED",
            "missing or invalid bearer token",
            headers={"WWW-Authenticate": "Bearer"},
        )
