import json
from pathlib import Path

import pytest

from aiplot.llm.lora import LoraError, resolve, scan

BASE = "a" * 64
OTHER = "b" * 64


def install(lora_dir: Path, lora_id: str, base: str, *, adapter: bool = True) -> None:
    lora_dir.mkdir(parents=True, exist_ok=True)
    manifest = {"id": lora_id, "file": f"{lora_id}.gguf", "sha256": "c" * 64, "base_sha256": base}
    (lora_dir / f"{lora_id}.json").write_text(json.dumps(manifest), encoding="utf-8")
    if adapter:
        (lora_dir / f"{lora_id}.gguf").write_bytes(b"GGUF")


def test_scan_marks_compatibility(tmp_path: Path) -> None:
    install(tmp_path, "direction-v1", BASE)
    install(tmp_path, "webnovel-v1", OTHER)
    entries = {e.manifest.id: e for e in scan(tmp_path, BASE)}
    assert entries["direction-v1"].compatible
    assert not entries["webnovel-v1"].compatible
    assert entries["direction-v1"].path == tmp_path / "direction-v1.gguf"


def test_scan_skips_broken_entries(tmp_path: Path, caplog: pytest.LogCaptureFixture) -> None:
    install(tmp_path, "good", BASE)
    install(tmp_path, "no-adapter", BASE, adapter=False)
    (tmp_path / "broken.json").write_text("{", encoding="utf-8")
    install(tmp_path, "renamed", BASE)
    (tmp_path / "renamed.json").rename(tmp_path / "other-name.json")
    assert [e.manifest.id for e in scan(tmp_path, BASE)] == ["good"]
    assert "broken.json" in caplog.text
    assert "missing no-adapter.gguf" in caplog.text
    assert "must match the file name" in caplog.text


def test_scan_missing_dir(tmp_path: Path) -> None:
    assert scan(tmp_path / "lora", BASE) == []


def test_resolve(tmp_path: Path) -> None:
    install(tmp_path, "direction-v1", BASE)
    assert resolve(tmp_path, "direction-v1", BASE) == tmp_path / "direction-v1.gguf"


def test_resolve_never_returns_mismatched_adapter(tmp_path: Path) -> None:
    install(tmp_path, "direction-v1", OTHER)
    with pytest.raises(LoraError, match="another base model"):
        resolve(tmp_path, "direction-v1", BASE)


def test_resolve_missing(tmp_path: Path) -> None:
    with pytest.raises(LoraError, match="not installed"):
        resolve(tmp_path, "direction-v1", BASE)
