"""What the server does to a `card` role output before the drawer shows it (§13):

- drops evidence indexes outside the notes, and evidence/ai_guess paths the type does not have;
- drops references to cards that are not in the work (or not of the right type), and to itself;
- gives milestones and foreshadowing server ids, keeping an id whose text did not change;
- places a new episode or part (part, order, prev) and keeps an edited card's placement;
- restores pinned fields from the card shown before.
"""

import secrets
import sqlite3
from types import UnionType
from typing import Any, Union, get_args, get_origin

from pydantic import BaseModel, TypeAdapter

from aiplot.db import cards as cards_db
from aiplot.generated.card.character import CharacterData
from aiplot.generated.card.episode import EpisodeData
from aiplot.generated.card.main_story import MainStoryData
from aiplot.generated.card.part import PartData
from aiplot.generated.card.region import RegionData
from aiplot.generated.card.world import WorldData
from aiplot.generated.roles.card_output import CardOutput
from aiplot.services.cards import Scope

DATA_MODELS: dict[str, type[BaseModel]] = {
    "world": WorldData,
    "character": CharacterData,
    "region": RegionData,
    "main_story": MainStoryData,
    "part": PartData,
    "episode": EpisodeData,
}

OUTPUT = TypeAdapter(CardOutput)


def nested_model(annotation: Any) -> type[BaseModel] | None:
    """The model inside an optional annotation (X | None), if any."""
    if isinstance(annotation, type) and issubclass(annotation, BaseModel):
        return annotation
    if get_origin(annotation) in (Union, UnionType):
        for arg in get_args(annotation):
            found = nested_model(arg)
            if found is not None:
                return found
    return None


def field_paths(card_type: str) -> set[str]:
    """Paths evidence, ai_guess and pinned may name: name, data keys and their sub-keys."""
    paths = {"name"}
    for key, info in DATA_MODELS[card_type].model_fields.items():
        paths.add(key)
        inner = nested_model(info.annotation)
        if inner is not None:
            paths |= {f"{key}.{sub}" for sub in inner.model_fields}
    return paths


def get_path(value: dict[str, Any], path: str) -> Any:
    current: Any = value
    for key in path.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current


def set_path(
    value: dict[str, Any], path: str, item: Any, shown: dict[str, Any] | None = None
) -> None:
    """Sets value[path]. When the parent object is undecided (null) in value, it is rebuilt
    with only the pinned key filled: its other keys empty (null, or [] where shown has a list)."""
    keys = path.split(".")
    current = value
    shape = shown
    for key in keys[:-1]:
        parent = shape.get(key) if isinstance(shape, dict) else None
        if not isinstance(current.get(key), dict):
            if not isinstance(parent, dict):
                return
            current[key] = {k: [] if isinstance(v, list) else None for k, v in parent.items()}
        current = current[key]
        shape = parent
    current[keys[-1]] = item


def new_id(prefix: str) -> str:
    return f"{prefix}_{secrets.token_hex(6)}"


def keep_ids(items: list[dict[str, Any]], before: list[dict[str, Any]], prefix: str) -> None:
    """Items whose text is unchanged keep their id; the rest get a new server id (§13)."""
    by_text: dict[str, list[str]] = {}
    for item in before:
        by_text.setdefault(item.get("text", ""), []).append(item["id"])
    for item in items:
        # Two items with the same text keep one old id each, in order.
        same = by_text.get(item.get("text", ""))
        item["id"] = same.pop(0) if same else new_id(prefix)


def place_episode(
    conn: sqlite3.Connection, data: dict[str, Any], part_id: str | None, work_id: str
) -> None:
    """A new episode goes last in its part, after that part's last episode (§8)."""
    data["worldline_id"] = None
    data["links"]["next"] = None
    data["part_id"] = part_id
    if part_id is None:
        data["order"] = None
        data["links"]["prev"] = None
        return
    rows = conn.execute(
        'SELECT card_id, "order" FROM episode WHERE part_id = ? ORDER BY "order" DESC, rowid DESC',
        (part_id,),
    ).fetchall()
    data["order"] = (rows[0][1] or len(rows)) + 1 if rows else 1
    data["links"]["prev"] = rows[0][0] if rows else None


def process(
    conn: sqlite3.Connection,
    output: CardOutput,
    *,
    work_id: str,
    card_id: str | None,
    part_id: str | None,
    sentences: int,
    saved: dict[str, Any] | None,
    shown: dict[str, Any] | None,
    pinned: list[str],
) -> CardOutput:
    """saved: the card as stored (edit mode); shown: the card the user saw last (the last
    generated one, else saved), whose pinned fields come back."""
    card_type = output.type
    value = output.model_dump(mode="json")
    data: dict[str, Any] = value["data"]
    scope = Scope(conn, work_id, card_id or "")
    saved_data: dict[str, Any] = saved["data"] if saved is not None else {}

    match card_type:
        case "world":
            data["related"] = scope.keep(data["related"], "character", "region", "world")
        case "character":
            people = scope.ids("character")
            data["relations"] = [r for r in data["relations"] if r["target_id"] in people]
            data["origin_region_id"] = scope.one(data["origin_region_id"], "region")
        case "region":
            data["parent_id"] = scope.one(data["parent_id"], "region")
            regions = scope.ids("region")
            data["links"] = [link for link in data["links"] if link["target_id"] in regions]
        case "main_story":
            keep_ids(data["milestones"], saved_data.get("milestones", []), "ms")
        case "part":
            milestones = cards_db.milestone_ids(conn, work_id)
            data["fulfills"] = [m for m in dict.fromkeys(data["fulfills"]) if m in milestones]
            if saved is not None:
                data["order"] = saved_data.get("order")
            else:
                data["order"] = cards_db.last_part_order(conn, work_id) + 1
        case "episode":
            data["characters"] = scope.keep(data["characters"], "character")
            data["locations"]["main"] = scope.one(data["locations"]["main"], "region")
            others = scope.keep(data["locations"]["others"], "region")
            data["locations"]["others"] = [r for r in others if r != data["locations"]["main"]]
            data["world"] = scope.keep(data["world"], "world")
            data["links"]["causes"] = scope.keep(data["links"]["causes"], "episode")
            milestones = cards_db.milestone_ids(conn, work_id)
            data["fulfills"] = [m for m in dict.fromkeys(data["fulfills"]) if m in milestones]
            plants = data["foreshadowing"]["plants"]
            keep_ids(plants, (saved_data.get("foreshadowing") or {}).get("plants", []), "fs")
            planted = cards_db.foreshadowing_ids(conn, work_id)
            data["foreshadowing"]["payoffs"] = [
                fid
                for fid in dict.fromkeys(data["foreshadowing"]["payoffs"])
                if fid in planted and planted[fid] != card_id
            ]
            if saved is not None:
                # Placement belongs to the story screen; regenerating never moves the episode.
                for key in ("part_id", "order", "worldline_id"):
                    data[key] = saved_data.get(key)
                data["links"]["prev"] = (saved_data.get("links") or {}).get("prev")
                data["links"]["next"] = (saved_data.get("links") or {}).get("next")
            else:
                place_episode(conn, data, part_id, work_id)

    if shown is not None:
        for path in pinned:
            if path == "name":
                value["name"] = shown.get("name")
            elif path in field_paths(card_type):
                shown_data = shown.get("data") or {}
                set_path(data, path, get_path(shown_data, path), shown_data)

    paths = field_paths(card_type)
    value["evidence"] = {
        path: sorted({i for i in indexes if i < sentences})
        for path, indexes in value["evidence"].items()
        if path in paths
    }
    value["evidence"] = {path: idx for path, idx in value["evidence"].items() if idx}
    value["ai_guess"] = [p for p in dict.fromkeys(value["ai_guess"]) if p in paths]
    return OUTPUT.validate_python(value)
