"""The scene role (§9, §13): context, narrowed schema, cleaning and retries."""

import json
import re
import sqlite3
from collections.abc import AsyncGenerator, Iterator
from pathlib import Path
from typing import Any, get_args

import pytest

from aiplot.db.connection import connect
from aiplot.db.migrate import init_db
from aiplot.generated.roles.scene_output import DeviceRole, OutputScene, SceneDevices, SceneOutput
from aiplot.llm.client import ChatRequest, Delta, LlmError, Message, Usage
from aiplot.llm.config import PROMPTS_DIR, load_llm_config
from aiplot.llm.fake import FakeClient
from aiplot.llm.router import Router
from aiplot.services import cards, direction, techniques
from aiplot.services.direction import EpisodeNotReadyError
from tests.test_card_delete import episode
from tests.test_cards import character, fixture, region, save, story
from tests.test_draft_messages import Scripted

pytestmark = pytest.mark.anyio

CATALOG = techniques.load()
BY_ID = {card.id: card for card in CATALOG}
SCHEMAS = Path(__file__).resolve().parents[2] / "schemas" / "technique"
FIVE = ["발단", "전개", "위기", "절정", "결말"]
SUMMARIES = {
    "발단": "테오가 안개 낀 항구에 돌아온다.",
    "전개": "미라가 테오에게 옛 편지를 건넨다.",
    "위기": "편지를 쓴 사람이 테오를 지켜보지만 테오는 모른다.",
    "절정": "등대에서 테오가 편지의 주인과 마주친다.",
    "결말": "테오는 편지를 바다에 던지고 항구를 떠난다.",
}
NO_DEVICES = {key: "none" for key in SceneDevices.model_fields}


TENSION = [1, 2, 4, 5, 3]


def stages() -> dict[str, Any]:
    return {
        "type": 5,
        "stages": [
            {"name": n, "summary": SUMMARIES[n], "tension": t}
            for n, t in zip(FIVE, TENSION, strict=True)
        ],
    }


def ep(card_id: str, name: str, **data: Any) -> dict[str, Any]:
    value = episode(card_id, **data)
    value["name"] = name
    return value


@pytest.fixture
def conn(tmp_path: Path) -> Iterator[sqlite3.Connection]:
    path = tmp_path / "data" / "aiplot.db"
    init_db(path)
    conn = connect(path)
    conn.execute(
        "INSERT INTO work (id, title, updated_at) VALUES ('w_01', '책', '2026-11-04T00:00:00Z')"
    )
    techniques.sync(conn, CATALOG)
    story(conn)
    # Incomplete cards the episode is tied to: inactive, so never in the context (§11).
    save(conn, character("c_ghost", "유령", theme=None))
    save(conn, fixture("world-undecided", id="c_fog", name="안개 계약"))
    save(conn, region("c_ruin", "폐허", appearance=None))
    plants = [{"id": "fs_old", "text": "부서진 등대"}]
    save(conn, ep("c_ep0", "0화", foreshadowing={"plants": plants, "payoffs": []}))
    save(
        conn,
        ep(
            "c_ep1",
            "1화",
            characters=["c_teo", "c_mira", "c_ghost"],
            locations={"main": "c_port", "others": ["c_isle", "c_ruin"]},
            world=["c_tide", "c_fog"],
            foreshadowing={
                "plants": [{"id": "fs_scar", "text": "테오의 왼손 흉터"}],
                "payoffs": ["fs_old"],
            },
            structure=stages(),
            synopsis="테오가 항구에 돌아와 옛 편지의 주인을 찾는다.",
        ),
    )
    assert cards.get(conn, "c_ep1").status == "complete"  # type: ignore[union-attr]
    yield conn
    conn.close()


def make_router(client: FakeClient, tmp_path: Path) -> Router:
    return Router(load_llm_config(), client, lora_dir=tmp_path / "lora")


def user_turn(client: FakeClient, call: int = 0) -> str:
    messages: list[Message] = client.requests[call].messages
    assert [m["role"] for m in messages] == ["system", "user"]
    return messages[1]["content"]


def block(text: str, tag: str) -> str:
    return text.split(f"<{tag}>\n", 1)[1].split(f"\n</{tag}>", 1)[0]


def scenes_json(*scenes: dict[str, Any]) -> str:
    return json.dumps({"scenes": list(scenes)}, ensure_ascii=False)


def scene(number: int, source: str, **changes: Any) -> dict[str, Any]:
    return {
        "scene": number,
        "source": source,
        "summary": SUMMARIES.get(source, "요약"),
        "core": "핵심",
        "devices": NO_DEVICES,
        "effects": ["긴장"],
        "situations": ["위기"],
        **changes,
    }


# scene ------------------------------------------------------------------------------------


async def test_scene_sees_the_episode_and_its_active_cards(
    conn: sqlite3.Connection, tmp_path: Path
) -> None:
    client = FakeClient()
    result = await direction.split_scenes(make_router(client, tmp_path), conn, "c_ep1")
    text = user_turn(client)
    assert text.startswith("<원문>\n") and text.endswith("\n</지시>")
    story_block = block(text, "원문")
    assert story_block.splitlines() == [
        "제목: 1화",
        "주제: 귀환",
        "메인 스토리와의 관계: 첫 흔적을 발견한다",
        "줄거리: 테오가 항구에 돌아와 옛 편지의 주인을 찾는다.",
        "구조: 5단계",
        *(f"- {n} (긴장도 {t}): {SUMMARIES[n]}" for n, t in zip(FIVE, TENSION, strict=True)),
        "이 에피소드에서 심는 복선:",
        "- 테오의 왼손 흉터",
        "앞에서 심었고 이 에피소드에서 회수하는 복선:",
        "- 부서진 등대",
    ]

    cards_block = block(text, "참고 카드")
    assert cards_block.splitlines() == [
        "메인 스토리: 상실과 회복",
        "  전제: 죽은 줄 알았던 가족의 흔적을 좇는다",
        "부 1부 항구: 출발",
        "인물 테오: 잃어버린 가족을 찾는 귀환자",
        "  성격: 과묵함, 집요함",
        "인물 미라: 잃어버린 가족을 찾는 귀환자",
        "  성격: 과묵함, 집요함",
        "주 무대 북부 항구: 안개 낀 석조 부두",
        "장소 섬: 안개 낀 석조 부두",
        "세계관(규칙·능력) 조수 마법: 바닷물을 매개로 하는 마법",
    ]
    # Inactive cards and ids stay out.
    for word in ("유령", "안개 계약", "폐허", "c_", "fs_", "ms_"):
        assert word not in text, word
    assert block(text, "지시") == "나눌 단계: 발단, 전개, 위기, 절정, 결말"

    assert [s.source for s in result.scenes] == FIVE
    assert (result.meta.role, result.meta.prompt_version) == ("scene", 5)
    # The fixture client reports no usage.
    assert (result.usage, result.generations) == (None, 1)


async def test_scene_schema_limits_source_to_the_stage_names(
    conn: sqlite3.Connection, tmp_path: Path
) -> None:
    client = FakeClient()
    await direction.split_scenes(make_router(client, tmp_path), conn, "c_ep1")
    schema = client.requests[0].json_schema
    assert schema == direction.scene_schema(FIVE)
    assert schema is not None
    source = schema["$defs"]["OutputScene"]["properties"]["source"]
    assert source == {"type": "string", "enum": FIVE}
    assert_plain(schema)
    # The model's own schema is left as it was.
    assert (
        "enum"
        not in SceneOutput.model_json_schema()["$defs"]["OutputScene"]["properties"]["source"]
    )


async def test_scene_output_is_cleaned(conn: sqlite3.Connection, tmp_path: Path) -> None:
    client = Scripted()
    client.say(
        "scene",
        scenes_json(
            scene(1, "발단", effects=["긴장", "긴장"]),
            scene(2, "기"),  # not a stage of this episode
            scene(7, "결말"),
        ),
    )
    result = await direction.split_scenes(make_router(client, tmp_path), conn, "c_ep1")
    assert [(s.scene, s.source, s.effects) for s in result.scenes] == [
        (1, "발단", ["긴장"]),
        (2, "결말", ["긴장"]),
    ]


async def test_scene_regenerates_once_when_nothing_survives(
    conn: sqlite3.Connection, tmp_path: Path
) -> None:
    client = Scripted()
    client.say("scene", scenes_json(scene(1, "기")), scenes_json(scene(1, "위기")))
    result = await direction.split_scenes(make_router(client, tmp_path), conn, "c_ep1")
    assert [s.source for s in result.scenes] == ["위기"]
    assert len(client.requests) == 2

    client = Scripted()
    client.say("scene", scenes_json(scene(1, "기")))
    with pytest.raises(LlmError) as exc_info:
        await direction.split_scenes(make_router(client, tmp_path), conn, "c_ep1")
    assert exc_info.value.code == "LLM_INVALID_OUTPUT"
    assert len(client.requests) == 2


async def test_scene_regenerates_once_when_a_scene_answers_too_many_devices_main(
    conn: sqlite3.Connection, tmp_path: Path
) -> None:
    all_yes = {key: "main" for key in NO_DEVICES}
    client = Scripted()
    client.say(
        "scene",
        scenes_json(scene(1, "발단"), scene(2, "위기", devices=all_yes)),
        scenes_json(scene(1, "발단"), scene(2, "위기")),
    )
    result = await direction.split_scenes(make_router(client, tmp_path), conn, "c_ep1")
    assert [s.source for s in result.scenes] == ["발단", "위기"]
    assert (len(client.requests), result.generations) == (2, 2)


async def test_episode_not_ready_is_refused_before_any_call(
    conn: sqlite3.Connection, tmp_path: Path
) -> None:
    client = FakeClient()
    router = make_router(client, tmp_path)
    # Incomplete: no stage summaries.
    blank = stages()
    blank["stages"][0]["summary"] = None
    save(conn, ep("c_ep2", "2화", structure=blank))
    # Complete, but its part is incomplete (§11: inactive too).
    untitled = {**fixture("part")["data"], "title": None, "fulfills": []}
    save(conn, fixture("part", id="c_part9", name="9부", data=untitled))
    save(conn, ep("c_ep3", "3화", part_id="c_part9"))
    assert cards.get(conn, "c_ep3").status == "complete"  # type: ignore[union-attr]
    for card_id in ("c_ep2", "c_ep3", "c_teo"):
        with pytest.raises(EpisodeNotReadyError):
            await direction.split_scenes(router, conn, card_id)
    with pytest.raises(cards.CardNotFoundError):
        await direction.split_scenes(router, conn, "c_nothing")
    assert client.requests == []


async def test_an_incomplete_main_story_makes_every_episode_inactive(
    conn: sqlite3.Connection, tmp_path: Path
) -> None:
    client = FakeClient()
    router = make_router(client, tmp_path)
    main = fixture("main-story")
    save(conn, {**main, "data": {**main["data"], "theme": None}})
    assert cards.get(conn, "c_main").status == "incomplete"  # type: ignore[union-attr]
    assert cards.get(conn, "c_ep1").status == "complete"  # type: ignore[union-attr]
    with pytest.raises(EpisodeNotReadyError):
        await direction.split_scenes(router, conn, "c_ep1")
    assert client.requests == []


async def test_payoffs_planted_in_an_inactive_episode_stay_out(
    conn: sqlite3.Connection, tmp_path: Path
) -> None:
    plants = [{"id": "fs_old", "text": "부서진 등대"}]
    save(conn, ep("c_ep0", "0화", foreshadowing={"plants": plants, "payoffs": []}, synopsis=None))
    assert cards.get(conn, "c_ep0").status == "incomplete"  # type: ignore[union-attr]
    # The row is still there (§11 keeps it); only the context leaves it out.
    row = conn.execute("SELECT payoff_episode_id FROM foreshadowing WHERE id = 'fs_old'")
    assert row.fetchone()[0] == "c_ep1"
    client = FakeClient()
    await direction.split_scenes(make_router(client, tmp_path), conn, "c_ep1")
    text = user_turn(client)
    assert "부서진 등대" not in text
    assert "회수하는 복선" not in text
    assert "- 테오의 왼손 흉터" in text


# usage --------------------------------------------------------------------------------------


class Metered(Scripted):
    """Scripted, with usage on every finish: completion tokens = 10 x the call's number."""

    async def stream(self, request: ChatRequest) -> AsyncGenerator[Delta, None]:
        async for delta in super().stream(request):
            if delta.kind == "finish":
                usage = Usage(
                    prompt_tokens=100, cached_tokens=0, completion_tokens=10 * len(self.requests)
                )
                delta = Delta("finish", delta.text, usage)
            yield delta


async def test_results_carry_the_kept_usage_and_every_generation(
    conn: sqlite3.Connection, tmp_path: Path
) -> None:
    client = Metered()
    client.say("scene", scenes_json(scene(1, "기")), scenes_json(scene(1, "위기")))
    result = await direction.split_scenes(make_router(client, tmp_path), conn, "c_ep1")
    assert result.generations == 2
    assert result.usage == Usage(prompt_tokens=100, cached_tokens=0, completion_tokens=20)


# prompts ----------------------------------------------------------------------------------


async def test_system_prompts_hold_no_per_call_values(
    conn: sqlite3.Connection, tmp_path: Path
) -> None:
    client = FakeClient()
    router = make_router(client, tmp_path)
    save(conn, ep("c_ep4", "4화", theme="다른 주제", structure=stages()))
    await direction.split_scenes(router, conn, "c_ep1")
    await direction.split_scenes(router, conn, "c_ep4")
    scene_a, scene_b = (r.messages[0] for r in client.requests)
    assert scene_a == scene_b == {"role": "system", "content": router.system_prompt("scene")}
    assert client.requests[0].messages[1] != client.requests[1].messages[1]
    for value in ("tech_", "c_ep", "테오", "귀환", "<!--"):
        assert value not in scene_a["content"], value


@pytest.mark.parametrize("version", [1, 3, 4])
def test_scene_prompt_lists_every_tag(version: int) -> None:
    """The prompt's two lists are the fixed tag lists (§9), in order; glosses in brackets."""
    text = (PROMPTS_DIR / "scene" / f"v{version}.md").read_text(encoding="utf-8")
    for heading, file in (
        ("효과 목록 (effects)", "technique-effect.json"),
        ("상황 목록 (situations)", "technique-situation.json"),
    ):
        line = text.split(f"\n{heading}\n", 1)[1].split("\n", 1)[0]
        listed = [re.sub(r"\(.*?\)", "", tag) for tag in line.split(", ")]
        assert listed == json.loads((SCHEMAS / file).read_text(encoding="utf-8"))["enum"]


def test_scene_checklist_leads_to_real_tags() -> None:
    text = (PROMPTS_DIR / "scene" / "v1.md").read_text(encoding="utf-8")
    tags = {
        tag
        for file in ("technique-effect.json", "technique-situation.json")
        for tag in json.loads((SCHEMAS / file).read_text(encoding="utf-8"))["enum"]
    }
    arrows = [line.split(" → ", 1)[1] for line in text.splitlines() if " → " in line]
    assert len(arrows) >= 10
    for line in arrows:
        named = re.sub(r"\(.*?\)", "", line).split(", ")
        assert all(tag.strip() in tags for tag in named), line
    # Within brackets too, every tag word is real.
    assert "시간경과" in text.split("과거사 (", 1)[1].split(")", 1)[0]


def test_scene_prompt_asks_every_device_in_order() -> None:
    """v5 explains each answer (main, sub, none: the schema's values) and asks each device (the
    model never sees the schema), in the device list's order, with the questions first written
    for the cards (training/eval/step2/devices/vocab.json)."""
    body = (PROMPTS_DIR / "scene" / "v5.md").read_text(encoding="utf-8").split("-->", 1)[1]
    lines = re.findall(r"^  - ([a-z_]+): (.+)$", body, re.MULTILINE)
    roles = list(get_args(get_args(DeviceRole.__value__)[0]))
    assert [k for k, _ in lines[: len(roles)]] == roles == ["main", "sub", "none"]
    asked = lines[len(roles) :]
    vocab_file = SCHEMAS.parents[1] / "training" / "eval" / "step2" / "devices" / "vocab.json"
    vocab = json.loads(vocab_file.read_text(encoding="utf-8"))
    assert asked == [(v["key"], v["question"]) for v in vocab]
    assert [k for k, _ in asked] == list(SceneDevices.model_fields)
    # Field order of the output too: the devices are answered after the core, before the tags.
    items = re.findall(r"^- ([a-z_]+): ", body.split("\n항목\n", 1)[1], re.MULTILINE)
    expected = ["scene", "source", "summary", "core", "devices", "effects", "situations"]
    assert items[:7] == expected
    assert list(OutputScene.model_fields) == expected


def assert_plain(schema: dict[str, Any]) -> None:
    """Plain JSON Schema llama.cpp turns into a grammar: JSON-serializable, every $ref local
    and resolvable, enums of strings."""
    json.dumps(schema)

    def walk(node: object) -> None:
        if isinstance(node, dict):
            ref = node.get("$ref")
            if ref is not None:
                assert isinstance(ref, str) and ref.startswith("#/$defs/")
                assert ref.removeprefix("#/$defs/") in schema["$defs"]
            if "enum" in node:
                assert node["enum"] and all(isinstance(v, str) for v in node["enum"])
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(schema)
