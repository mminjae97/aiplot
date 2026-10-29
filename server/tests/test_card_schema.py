"""Generated card models must agree with the shared schema fixtures (also checked by Ajv)."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from aiplot.generated.card.card import Card, CharacterCard, RegionCard

FIXTURES = Path(__file__).resolve().parents[2] / "schemas" / "fixtures" / "card" / "card"
VALID = sorted(FIXTURES.glob("*.valid.json"))
INVALID = sorted(FIXTURES.glob("*.invalid.json"))


def load(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


def test_fixtures_exist() -> None:
    assert VALID
    assert INVALID


@pytest.mark.parametrize("path", VALID, ids=lambda p: p.name)
def test_valid_card_fixture_parses(path: Path) -> None:
    card = Card.model_validate(load(path))
    assert card.root.model_dump(mode="json") == load(path)


@pytest.mark.parametrize("path", INVALID, ids=lambda p: p.name)
def test_invalid_card_fixture_rejected(path: Path) -> None:
    with pytest.raises(ValidationError):
        Card.model_validate(load(path))


def test_type_selects_variant() -> None:
    character = Card.model_validate(load(FIXTURES / "character.valid.json"))
    region = Card.model_validate(load(FIXTURES / "region.valid.json"))
    assert isinstance(character.root, CharacterCard)
    assert isinstance(region.root, RegionCard)
