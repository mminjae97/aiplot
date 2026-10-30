"""Every non-2xx response body is ApiError {code, message, hint}; each code maps to a UI state."""

import logging
from collections.abc import Mapping

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from aiplot.generated.common.error import ApiError

logger = logging.getLogger(__name__)

# Framework-raised statuses; services raise AppError with their own codes.
HTTP_CODES = {404: "NOT_FOUND", 405: "METHOD_NOT_ALLOWED"}


class AppError(Exception):
    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        hint: str | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.error = ApiError(code=code, message=message, hint=hint)
        self.headers = headers


def error_response(
    status: int, error: ApiError, headers: Mapping[str, str] | None = None
) -> JSONResponse:
    return JSONResponse(status_code=status, content=error.model_dump(), headers=headers)


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def app_error(_: Request, exc: AppError) -> JSONResponse:
        return error_response(exc.status, exc.error, exc.headers)

    @app.exception_handler(StarletteHTTPException)
    async def http_exception(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = HTTP_CODES.get(exc.status_code, f"HTTP_{exc.status_code}")
        error = ApiError(code=code, message=str(exc.detail), hint=None)
        return error_response(exc.status_code, error, exc.headers)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        first = exc.errors()[0]
        location = ".".join(str(part) for part in first["loc"])
        error = ApiError(code="VALIDATION_ERROR", message=f"{location}: {first['msg']}", hint=None)
        return error_response(422, error)

    @app.exception_handler(Exception)
    async def unhandled(_: Request, exc: Exception) -> JSONResponse:
        logger.exception("unhandled error", exc_info=exc)
        error = ApiError(code="INTERNAL_ERROR", message="internal server error", hint=None)
        return error_response(500, error)
