import logging
from collections.abc import Iterator
from logging.handlers import TimedRotatingFileHandler
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from aiplot.generated.common.health import VramUsage
from aiplot.llm import vram
from aiplot.main import (
    DEV_PORT,
    LOG_RETENTION_DAYS,
    create_app,
    load_settings,
    main,
    resolve_data_dir,
    resolve_port,
    resolve_token,
    setup_logging,
)

TOKEN = "test-token"
AUTH = {"Authorization": f"Bearer {TOKEN}"}


def test_health_reports_fake_llm_and_vram(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(vram, "_cache", None)
    monkeypatch.setattr(vram, "query", lambda: VramUsage(used_mb=6591, total_mb=8192))
    client = TestClient(create_app(token=TOKEN, db_path=tmp_path / "aiplot.db"))
    response = client.get("/api/v1/health", headers=AUTH)
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "llama": {"state": "fake", "profile": None, "restarts": 0, "message": None},
        "vram": {"used_mb": 6591, "total_mb": 8192},
    }


def test_health_without_nvidia_smi(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(vram, "_cache", None)
    monkeypatch.setattr(vram, "query", lambda: None)
    client = TestClient(create_app(token=TOKEN, db_path=tmp_path / "aiplot.db"))
    assert client.get("/api/v1/health", headers=AUTH).json()["vram"] is None


def test_fake_llm_setting(tmp_path: Path) -> None:
    env = {"AIPLOT_PORT": "9001", "AIPLOT_TOKEN": TOKEN, "AIPLOT_DATA_DIR": str(tmp_path)}
    assert not load_settings(env, dev=False).fake_llm
    assert load_settings(env | {"AIPLOT_FAKE_LLM": "1"}, dev=False).fake_llm


@pytest.mark.parametrize(("dev", "status"), [(True, 200), (False, 404)])
def test_docs_only_in_dev(tmp_path: Path, dev: bool, status: int) -> None:
    client = TestClient(create_app(token=TOKEN, db_path=tmp_path / "aiplot.db", dev=dev))
    assert client.get("/docs").status_code == status
    assert client.get("/openapi.json").status_code == status


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


def test_resolve_token_reads_value() -> None:
    assert resolve_token("aB3-_.~!") == "aB3-_.~!"


@pytest.mark.parametrize("value", [None, "", "has space", "tab\there", "토큰", "new\nline"])
def test_resolve_token_rejects_invalid(value: str | None) -> None:
    with pytest.raises(ValueError):
        resolve_token(value)


def test_resolve_data_dir_override(tmp_path: Path) -> None:
    env = {"AIPLOT_DATA_DIR": str(tmp_path / "custom"), "LOCALAPPDATA": str(tmp_path / "local")}
    assert resolve_data_dir(env) == (tmp_path / "custom").resolve()


@pytest.mark.parametrize("override", [None, ""])
def test_resolve_data_dir_default(tmp_path: Path, override: str | None) -> None:
    env = {"LOCALAPPDATA": str(tmp_path)}
    if override is not None:
        env["AIPLOT_DATA_DIR"] = override
    assert resolve_data_dir(env) == (tmp_path / "Aiplot").resolve()


def test_load_settings(tmp_path: Path) -> None:
    env = {"AIPLOT_PORT": "9001", "AIPLOT_TOKEN": TOKEN, "AIPLOT_DATA_DIR": str(tmp_path)}
    settings = load_settings(env, dev=False)
    assert (settings.port, settings.token, settings.data_dir) == (9001, TOKEN, tmp_path.resolve())


@pytest.mark.parametrize(
    ("env", "message"),
    [
        ({"AIPLOT_PORT": "abc", "AIPLOT_TOKEN": TOKEN}, "invalid AIPLOT_PORT"),
        ({"AIPLOT_PORT": "9001"}, "invalid AIPLOT_TOKEN"),
        ({"AIPLOT_PORT": "9001", "AIPLOT_TOKEN": ""}, "invalid AIPLOT_TOKEN"),
    ],
)
def test_main_exits_on_invalid_settings(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    env: dict[str, str],
    message: str,
) -> None:
    for name in ("AIPLOT_PORT", "AIPLOT_TOKEN"):
        monkeypatch.delenv(name, raising=False)
    for name, value in env.items():
        monkeypatch.setenv(name, value)
    with pytest.raises(SystemExit) as exc_info:
        main([])
    assert exc_info.value.code == 2
    assert message in capsys.readouterr().err


@pytest.fixture
def restore_root_logger() -> Iterator[None]:
    root = logging.getLogger()
    saved = (root.handlers[:], root.level)
    yield
    for handler in root.handlers:
        if handler not in saved[0]:
            handler.close()
    root.handlers[:] = saved[0]
    root.setLevel(saved[1])


@pytest.mark.usefixtures("restore_root_logger")
def test_setup_logging_writes_daily_rotated_file(tmp_path: Path) -> None:
    log_dir = tmp_path / "logs"
    setup_logging(log_dir, dev=False)
    logging.getLogger("aiplot.test").info("기록 확인")
    [handler] = logging.getLogger().handlers
    assert isinstance(handler, TimedRotatingFileHandler)
    assert (handler.when, handler.backupCount) == ("MIDNIGHT", LOG_RETENTION_DAYS)
    handler.flush()
    assert "기록 확인" in (log_dir / "server.log").read_text(encoding="utf-8")
