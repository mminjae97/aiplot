import pytest
from fastapi.testclient import TestClient

from aiplot.main import DEFAULT_PORT, create_app, resolve_port


def test_health_ok() -> None:
    client = TestClient(create_app())
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.parametrize("value", [None, ""])
def test_resolve_port_defaults(value: str | None) -> None:
    assert resolve_port(value) == DEFAULT_PORT


def test_resolve_port_reads_value() -> None:
    assert resolve_port("9001") == 9001


@pytest.mark.parametrize("value", ["abc", "0", "70000"])
def test_resolve_port_rejects_invalid(value: str) -> None:
    with pytest.raises(ValueError):
        resolve_port(value)
