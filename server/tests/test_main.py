import pytest
from fastapi.testclient import TestClient

from aiplot.main import DEV_PORT, create_app, main, resolve_port


def test_health_ok() -> None:
    client = TestClient(create_app())
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


@pytest.mark.parametrize("value", [None, ""])
def test_resolve_port_dev_default(value: str | None) -> None:
    assert resolve_port(value, dev=True) == DEV_PORT


@pytest.mark.parametrize("value", [None, ""])
def test_resolve_port_required_outside_dev(value: str | None) -> None:
    with pytest.raises(ValueError):
        resolve_port(value, dev=False)


@pytest.mark.parametrize(("value", "expected"), [("1", 1), ("9001", 9001), ("65535", 65535)])
def test_resolve_port_reads_value(value: str, expected: int) -> None:
    assert resolve_port(value, dev=False) == expected


@pytest.mark.parametrize("value", ["abc", "0", "-1", "65536", " 9001 ", "+9001", "9_001", "٩٠٠١"])
def test_resolve_port_rejects_invalid(value: str) -> None:
    with pytest.raises(ValueError):
        resolve_port(value, dev=False)


def test_main_exits_on_invalid_port(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("AIPLOT_PORT", "abc")
    with pytest.raises(SystemExit) as exc_info:
        main([])
    assert exc_info.value.code == 2
    assert "invalid AIPLOT_PORT" in capsys.readouterr().err
