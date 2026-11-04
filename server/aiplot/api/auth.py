"""Bearer token check for every /api/v1 route (§16); Electron passes it as AIPLOT_TOKEN.

It runs as ASGI middleware, before routing and body parsing: a request without the token gets
401 even when its body or query would not validate (422) or its route does not exist (404).
CORS preflight never reaches it in --dev: the CORS middleware sits outside and answers it.
"""

import hmac

from starlette.types import ASGIApp, Receive, Scope, Send

from aiplot.api.errors import error_response
from aiplot.generated.common.error import ApiError

UNAUTHORIZED = ApiError(code="UNAUTHORIZED", message="missing or invalid bearer token", hint=None)


def token_ok(authorization: str | None, expected: str) -> bool:
    """`Bearer <token>`, the scheme case-insensitive, the token compared in constant time."""
    if not authorization:
        return False
    scheme, _, credentials = authorization.partition(" ")
    if scheme.lower() != "bearer" or not credentials:
        return False
    # Bytes: compare_digest rejects non-ASCII str, and client headers can contain anything.
    return hmac.compare_digest(credentials.encode(), expected.encode())


class TokenMiddleware:
    """401 UNAUTHORIZED for any HTTP request under `prefix` without the right token."""

    def __init__(self, app: ASGIApp, *, token: str, prefix: str) -> None:
        self.app = app
        self.token = token
        self.prefix = prefix

    def guarded(self, path: str) -> bool:
        return path == self.prefix or path.startswith(f"{self.prefix}/")

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http" and self.guarded(scope["path"]):
            header = next((v for k, v in scope["headers"] if k.lower() == b"authorization"), None)
            authorization = None if header is None else header.decode("latin-1")
            if not token_ok(authorization, self.token):
                response = error_response(401, UNAUTHORIZED, {"WWW-Authenticate": "Bearer"})
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)
