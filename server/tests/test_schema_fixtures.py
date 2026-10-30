"""Generated Pydantic types must agree with every shared schema fixture (also checked by Ajv).

fixtures/<schema path>/<name>.valid.json must parse and round-trip unchanged;
<name>.invalid.json must be rejected. The type is the schema's top-level title in the
generated module for that schema path.
"""

import importlib
import json
from pathlib import Path
from typing import Any, get_args

import pytest
from pydantic import TypeAdapter, ValidationError

from aiplot.generated.card.card import Card, CharacterCard, EpisodeCard, RegionCard, WorldCard
from aiplot.generated.roles.card_output import CardOutput

SCHEMAS = Path(__file__).resolve().parents[2] / "schemas"
FIXTURES = SCHEMAS / "fixtures"
CASES = sorted(FIXTURES.rglob("*.json"))


def adapter_for(fixture: Path) -> TypeAdapter[Any]:
    schema_rel = fixture.parent.relative_to(FIXTURES)
    title = json.loads((SCHEMAS / f"{schema_rel.as_posix()}.json").read_text(encoding="utf-8"))[
        "title"
    ]
    module_name = ".".join(part.replace("-", "_") for part in schema_rel.parts)
    module = importlib.import_module(f"aiplot.generated.{module_name}")
    return TypeAdapter(getattr(module, title))


def load(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def test_fixtures_exist() -> None:
    assert any(p.name.endswith(".valid.json") for p in CASES)
    assert any(p.name.endswith(".invalid.json") for p in CASES)


@pytest.mark.parametrize("path", CASES, ids=lambda p: p.relative_to(FIXTURES).as_posix())
def test_fixture(path: Path) -> None:
    adapter = adapter_for(path)
    data = load(path)
    if path.name.endswith(".valid.json"):
        assert adapter.dump_python(adapter.validate_python(data), mode="json") == data
    else:
        assert path.name.endswith(".invalid.json")
        with pytest.raises(ValidationError):
            adapter.validate_python(data)


def test_card_type_selects_variant() -> None:
    adapter: TypeAdapter[Any] = TypeAdapter(Card)
    card_dir = FIXTURES / "card" / "card"
    assert isinstance(
        adapter.validate_python(load(card_dir / "character.valid.json")), CharacterCard
    )
    assert isinstance(adapter.validate_python(load(card_dir / "region.valid.json")), RegionCard)
    assert isinstance(adapter.validate_python(load(card_dir / "world.valid.json")), WorldCard)


def test_nested_ids_are_plain_strings() -> None:
    card = TypeAdapter(Card).validate_python(
        load(FIXTURES / "card" / "card" / "episode.valid.json")
    )
    assert isinstance(card, EpisodeCard)
    assert "c_teo" in card.data.characters
    assert card.data.part_id == "c_part1"
    assert {"c_teo", "c_mira"} == set(card.data.characters)
    assert card.data.world == ["c_tide"]


def test_card_output_covers_every_card_type() -> None:
    def type_literals(union: object) -> set[str]:
        members = get_args(get_args(union.__value__)[0])  # type: ignore[attr-defined]
        return {get_args(m.model_fields["type"].annotation)[0] for m in members}

    assert type_literals(Card) == type_literals(CardOutput)
    assert type_literals(Card) == {"world", "character", "region", "main_story", "part", "episode"}
