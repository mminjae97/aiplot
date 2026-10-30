"""LoRA registry: {data dir}/lora/{id}.json manifests next to their adapters (§13).

An adapter is loadable only when its manifest's base_sha256 equals the active profile's GGUF
sha256; mismatched ones are listed (settings shows them as not loaded) but never resolved.
"""

import json
import logging
from dataclasses import dataclass
from pathlib import Path

from pydantic import ValidationError

from aiplot.generated.lora.manifest import LoraManifest

logger = logging.getLogger(__name__)


class LoraError(Exception):
    pass


@dataclass(frozen=True)
class LoraEntry:
    manifest: LoraManifest
    path: Path
    compatible: bool


def read_manifest(path: Path) -> LoraManifest:
    try:
        manifest = LoraManifest.model_validate(json.loads(path.read_text(encoding="utf-8")))
    except (OSError, ValueError, ValidationError) as exc:
        raise LoraError(f"{path.name}: {exc}") from exc
    if manifest.id != path.stem:
        raise LoraError(f"{path.name}: id {manifest.id!r} must match the file name")
    return manifest


def scan(lora_dir: Path, base_sha256: str) -> list[LoraEntry]:
    """Every readable manifest whose adapter file exists; broken ones are logged and skipped."""
    entries: list[LoraEntry] = []
    for path in sorted(lora_dir.glob("*.json")):
        try:
            manifest = read_manifest(path)
        except LoraError as exc:
            logger.warning("skipping LoRA manifest: %s", exc)
            continue
        adapter = lora_dir / manifest.file
        if not adapter.is_file():
            logger.warning("skipping LoRA %s: missing %s", manifest.id, manifest.file)
            continue
        entries.append(LoraEntry(manifest, adapter, manifest.base_sha256 == base_sha256))
    return entries


def resolve(lora_dir: Path, lora_id: str, base_sha256: str) -> Path:
    """Adapter path for lora_id, or LoraError if it is missing or built for another base."""
    for entry in scan(lora_dir, base_sha256):
        if entry.manifest.id == lora_id:
            if not entry.compatible:
                raise LoraError(f"LoRA {lora_id} was trained for another base model")
            return entry.path
    raise LoraError(f"LoRA {lora_id} is not installed")
