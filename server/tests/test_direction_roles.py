"""The scene and pick roles (§9, §13): context, narrowed schemas, cleaning and retries."""

import json
import re
import sqlite3
from collections.abc import AsyncGenerator, Iterator
from pathlib import Path
from typing import Any

import pytest

from aiplot.db.connection import connect
from aiplot.db.migrate import init_db
from aiplot.generated.roles.pick_output import PickOutput
from aiplot.generated.roles.scene_output import SceneChecks, SceneOutput
from aiplot.llm.client import ChatRequest, Delta, LlmError, Message, Usage
from aiplot.llm.config import PROMPTS_DIR, load_llm_config
from aiplot.llm.fake import FakeClient
from aiplot.llm.router import Router
from aiplot.services import cards, direction, direction_context, techniques
from aiplot.services.direction import EpisodeNotReadyError, UnknownStageError
from aiplot.services.direction_context import Scene
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
NO_CHECKS = {key: False for key in SceneChecks.model_fields}
SUSPENSE = Scene(
    scene=3,
    source="위기",
    summary="편지를 쓴 사람이 테오를 지켜보지만 테오는 모른다.",
    checks=SceneChecks.model_validate(NO_CHECKS),
    effects=["서스펜스", "긴장"],
    situations=["비밀", "위기"],
)


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
        "checks": NO_CHECKS,
        "effects": ["긴장"],
        "situations": ["위기"],
        **changes,
    }


def picks_json(*combinations: list[str]) -> str:
    return json.dumps(
        {
            "picks": [
                {"rank": rank, "techniques": ids, "reason": "이 장면에 맞아요."}
                for rank, ids in enumerate(combinations, start=1)
            ]
        },
        ensure_ascii=False,
    )


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
    assert (result.meta.role, result.meta.prompt_version) == ("scene", 3)
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
        with pytest.raises(EpisodeNotReadyError):
            await direction.recommend(router, conn, card_id, SUSPENSE)
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
    with pytest.raises(EpisodeNotReadyError):
        await direction.recommend(router, conn, "c_ep1", SUSPENSE)
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


# pick -------------------------------------------------------------------------------------


async def test_pick_sees_the_scene_and_its_narrowed_candidates(
    conn: sqlite3.Connection, tmp_path: Path
) -> None:
    client = FakeClient()
    result = await direction.recommend(make_router(client, tmp_path), conn, "c_ep1", SUSPENSE)
    narrowed = direction.candidates(conn, SUSPENSE.effects, SUSPENSE.situations)
    assert [c.id for c in result.candidates] == [c.id for c in narrowed]
    assert len(narrowed) == direction.CANDIDATE_LIMIT

    text = user_turn(client)
    assert block(text, "원문").splitlines() == [
        "제목: 1화",
        "주제: 귀환",
        "줄거리: 테오가 항구에 돌아와 옛 편지의 주인을 찾는다.",
        f"이 장면의 단계: 위기 (긴장도 4): {SUMMARIES['위기']}",
    ]
    assert block(text, "지시").splitlines() == [
        f"장면: {SUSPENSE.summary}",
        "원하는 효과: 서스펜스, 긴장",
        "상황: 비밀, 위기",
        direction_context.REASON_STYLE,
    ]
    entries = block(text, "참고 카드").split("\n\n")
    assert [e.splitlines()[0] for e in entries] == [f"{c.id} {c.name}" for c in narrowed]
    for entry, card in zip(entries, narrowed, strict=True):
        assert entry.splitlines()[1:5] == [
            f"정의: {card.description}",
            f"쓸 때: {' / '.join(card.use_when)}",
            f"피할 때: {' / '.join(card.avoid_when)}",
            f"전제: {card.requires}",
        ]
    for card in CATALOG:
        assert card.example not in text, card.id
    # tech_inf_001 conflicts with cards outside this list only: no conflict is shown.
    assert BY_ID["tech_inf_001"].conflicts_with
    assert "충돌" not in text
    for other in BY_ID["tech_inf_001"].conflicts_with:
        assert other not in text

    schema = client.requests[0].json_schema
    assert schema == direction.pick_schema([c.id for c in narrowed])
    assert [p.techniques for p in result.picks] == [
        ["tech_inf_001", "tech_tim_024"],
        ["tech_cha_022"],
    ]
    assert (result.meta.role, result.meta.prompt_version) == ("pick", 2)


async def test_pick_marks_conflicts_among_the_candidates(
    conn: sqlite3.Connection, tmp_path: Path
) -> None:
    reveal = SUSPENSE.model_copy(
        update={"effects": ["서스펜스", "놀람"], "situations": ["비밀", "진실폭로"]}
    )
    client = Scripted()
    client.say("pick", picks_json(["tech_inf_001"]))
    await direction.recommend(make_router(client, tmp_path), conn, "c_ep1", reveal)
    entries = {
        e.splitlines()[0].split()[0]: e for e in block(user_turn(client), "참고 카드").split("\n\n")
    }
    assert {"tech_inf_001", "tech_inf_003", "tech_inf_013"} <= set(entries)
    clash = [line for line in entries["tech_inf_001"].splitlines() if line.startswith("충돌: ")]
    assert len(clash) == 1
    assert "tech_inf_003 놀람형 은폐" in clash[0]
    assert "tech_inf_013 레드 헤링" in clash[0]


async def test_pick_schema_limits_ids_to_the_candidates() -> None:
    schema = direction.pick_schema(["tech_inf_001", "tech_tim_024"])
    assert schema["$defs"]["TechniqueId"] == {
        "type": "string",
        "enum": ["tech_inf_001", "tech_tim_024"],
    }
    items = schema["$defs"]["OutputPick"]["properties"]["techniques"]["items"]
    assert items == {"$ref": "#/$defs/TechniqueId"}
    assert_plain(schema)
    assert "enum" not in PickOutput.model_json_schema()["$defs"]["TechniqueId"]


async def test_pick_output_is_cleaned(conn: sqlite3.Connection, tmp_path: Path) -> None:
    reveal = SUSPENSE.model_copy(
        update={"effects": ["서스펜스", "놀람"], "situations": ["비밀", "진실폭로"]}
    )
    client = Scripted()
    client.say(
        "pick",
        picks_json(
            ["tech_inf_001", "tech_inf_003"],  # a conflicting pair
            ["tech_inf_003", "tech_inf_003", "tech_ser_019"],  # a serial card: no candidate
            ["tech_inf_013"],
        ),
    )
    result = await direction.recommend(make_router(client, tmp_path), conn, "c_ep1", reveal)
    assert [(p.rank, p.techniques) for p in result.picks] == [
        (1, ["tech_inf_003"]),
        (2, ["tech_inf_013"]),
    ]


async def test_pick_regenerates_once_when_nothing_survives(
    conn: sqlite3.Connection, tmp_path: Path
) -> None:
    reveal = SUSPENSE.model_copy(
        update={"effects": ["서스펜스", "놀람"], "situations": ["비밀", "진실폭로"]}
    )
    clash = picks_json(["tech_inf_001", "tech_inf_003"])
    client = Scripted()
    client.say("pick", clash, picks_json(["tech_inf_013"]))
    result = await direction.recommend(make_router(client, tmp_path), conn, "c_ep1", reveal)
    assert [p.techniques for p in result.picks] == [["tech_inf_013"]]
    assert len(client.requests) == 2

    client = Scripted()
    client.say("pick", clash)
    with pytest.raises(LlmError) as exc_info:
        await direction.recommend(make_router(client, tmp_path), conn, "c_ep1", reveal)
    assert exc_info.value.code == "LLM_INVALID_OUTPUT"
    assert len(client.requests) == 2


async def test_pick_refuses_a_scene_from_another_stage(
    conn: sqlite3.Connection, tmp_path: Path
) -> None:
    client = FakeClient()
    with pytest.raises(UnknownStageError):
        await direction.recommend(
            make_router(client, tmp_path),
            conn,
            "c_ep1",
            SUSPENSE.model_copy(update={"source": "승"}),
        )
    assert client.requests == []


async def test_pick_without_candidates_is_refused_before_any_call(
    conn: sqlite3.Connection, tmp_path: Path
) -> None:
    # A catalog where no direction candidate shares the scene's tags.
    others = [
        card.model_copy(update={"pairs_with": [], "conflicts_with": []})
        for card in CATALOG
        if not direction.is_candidate(card)
    ]
    techniques.sync(conn, others)
    client = FakeClient()
    with pytest.raises(direction.NoCandidatesError):
        await direction.recommend(make_router(client, tmp_path), conn, "c_ep1", SUSPENSE)
    assert client.requests == []


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

    reveal = SUSPENSE.model_copy(
        update={"effects": ["서스펜스", "놀람"], "situations": ["비밀", "진실폭로"]}
    )
    client = Metered()
    # Invalid JSON (the router retries), a conflicting pair (nothing kept), then a good one.
    client.say(
        "pick",
        "{not json",
        picks_json(["tech_inf_001", "tech_inf_003"]),
        picks_json(["tech_inf_013"]),
    )
    picked = await direction.recommend(make_router(client, tmp_path), conn, "c_ep1", reveal)
    assert [p.techniques for p in picked.picks] == [["tech_inf_013"]]
    assert picked.generations == len(client.requests) == 3
    assert picked.usage == Usage(prompt_tokens=100, cached_tokens=0, completion_tokens=30)


# prompts ----------------------------------------------------------------------------------


async def test_system_prompts_hold_no_per_call_values(
    conn: sqlite3.Connection, tmp_path: Path
) -> None:
    client = FakeClient()
    router = make_router(client, tmp_path)
    save(conn, ep("c_ep4", "4화", theme="다른 주제", structure=stages()))
    await direction.split_scenes(router, conn, "c_ep1")
    await direction.split_scenes(router, conn, "c_ep4")
    await direction.recommend(router, conn, "c_ep1", SUSPENSE)
    # Other candidates; the fixture's tech_cha_022 is among them too.
    other = SUSPENSE.model_copy(update={"effects": ["여운"], "situations": ["이별"]})
    await direction.recommend(router, conn, "c_ep4", other)
    scene_a, scene_b, pick_a, pick_b = (r.messages[0] for r in client.requests)
    assert scene_a == scene_b == {"role": "system", "content": router.system_prompt("scene")}
    assert pick_a == pick_b == {"role": "system", "content": router.system_prompt("pick")}
    assert client.requests[2].messages[1] != client.requests[3].messages[1]
    for prompt in (scene_a["content"], pick_a["content"]):
        for value in ("tech_", "c_ep", "테오", "귀환", "<!--"):
            assert value not in prompt, value


@pytest.mark.parametrize("version", [1, 3])
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


def test_scene_prompt_asks_every_check_in_order() -> None:
    """v3 explains each checks field (the model never sees the schema), in the schema's order."""
    body = (PROMPTS_DIR / "scene" / "v3.md").read_text(encoding="utf-8").split("-->", 1)[1]
    asked = re.findall(r"^  - ([a-z_]+): ", body, re.MULTILINE)
    assert asked == list(SceneChecks.model_fields)
    # Field order of the output too: the checks are answered after the summary, before the tags.
    items = re.findall(r"^- ([a-z_]+): ", body.split("\n항목\n", 1)[1], re.MULTILINE)
    assert items[:6] == ["scene", "source", "summary", "checks", "effects", "situations"]


def test_pick_prompt_asks_for_haeyo_reasons() -> None:
    text = (PROMPTS_DIR / "pick" / "v1.md").read_text(encoding="utf-8")
    body = text.split("-->", 1)[1]
    for ending in ('"~해요"', '"~어요"', '"~이에요"'):
        assert ending in body
    # Said once with the field and once more at the very end, in 해요체 itself.
    assert body.strip().splitlines()[-1].endswith('"요"로 끝내요.')
    reason = body.split("- reason:", 1)[1].split("\n\n", 1)[0]
    for line in reason.splitlines():
        assert line.rstrip().endswith(("요.", '요."')), line
    # The pick turn ends with the same 해요체 line on every call.
    assert direction_context.REASON_STYLE.endswith("않아요.")
    assert "따옴표" in direction_context.REASON_STYLE


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
