import pytest
from pydantic import ValidationError

from aiplot.generated.common.error import ApiError
from aiplot.generated.common.health import HealthResponse


def test_api_error_accepts_upper_snake_code() -> None:
    error = ApiError(code="STAGE_LOCKED", message="locked", hint=None)
    assert error.model_dump() == {"code": "STAGE_LOCKED", "message": "locked", "hint": None}


@pytest.mark.parametrize("code", ["stage_locked", "1LOCKED", "STAGE-LOCKED", ""])
def test_api_error_rejects_bad_code(code: str) -> None:
    with pytest.raises(ValidationError):
        ApiError(code=code, message="m", hint=None)


def test_generated_models_forbid_extra_fields() -> None:
    with pytest.raises(ValidationError):
        HealthResponse.model_validate({"status": "ok", "extra": 1})
