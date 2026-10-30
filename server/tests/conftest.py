import pytest


@pytest.fixture
def anyio_backend() -> str:
    # The server runs on uvicorn's asyncio loop.
    return "asyncio"
