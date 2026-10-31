"""What the drawer's roles see (§8, §13): tagged context blocks `<원문> <참고 카드> <지시> <대화>`.

The texts here are model input, not UI text: they follow the role prompts in prompts/.
"""

import sqlite3
from typing import Any

from aiplot.db import cards as cards_db
from aiplot.generated.roles.card_output import CardOutput
from aiplot.llm.client import Message
from aiplot.services.notes import numbered

KIND = {
    "world": "세계관",
    "character": "캐릭터",
    "region": "지역",
    "main_story": "메인 스토리",
    "part": "부",
    "episode": "에피소드",
}

CATEGORY = {
    "rule": "규칙·능력",
    "faction": "세력·조직",
    "history": "역사·사건",
    "culture": "문화·용어",
    "other": "기타",
}

# Required fields (§15) as chat asks about them; a world card's category is never asked (§8).
REQUIRED: dict[str, list[tuple[str, str]]] = {
    "world": [("name", "이름"), ("summary", "요약")],
    "character": [
        ("name", "이름"),
        ("theme", "주제"),
        ("personality.traits", "성격 특성"),
        ("speech.description", "말투"),
        ("speech.examples", "대사 예시 3~5개"),
        ("appearance.summary", "외모"),
    ],
    "region": [
        ("name", "이름"),
        ("appearance", "겉모습"),
        ("environment.natural", "자연환경"),
        ("environment.social", "사회와 문화"),
    ],
    "main_story": [
        ("theme", "주제"),
        ("premise", "전제"),
        ("ending", "결말"),
        ("milestones", "주요 사건"),
    ],
    "part": [("title", "제목"), ("theme", "주제"), ("start", "시작 상황"), ("end", "끝 상황")],
    "episode": [
        ("theme", "주제"),
        ("synopsis", "줄거리"),
        ("characters", "등장인물"),
        ("locations.main", "주 무대"),
        ("structure", "구조 단계 요약"),
    ],
}

# The last turns chat sees (§8 "last few turns").
CHAT_TURNS = 6


def block(tag: str, body: str) -> str:
    return f"<{tag}>\n{body}\n</{tag}>"


def lookup(value: Any, path: str) -> Any:
    for key in path.split("."):
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value


def filled(card_type: str, path: str, card: dict[str, Any]) -> bool:
    value = card.get("name") if path == "name" else lookup(card.get("data"), path)
    if path == "speech.examples":
        return isinstance(value, list) and 3 <= len(value) <= 5
    if path == "structure":
        stages = value.get("stages") if isinstance(value, dict) else None
        if not isinstance(stages, list) or not stages:
            return False
        return all(
            isinstance(s, dict) and isinstance(s.get("summary"), str) and s["summary"].strip() != ""
            for s in stages
        )
    if isinstance(value, str):
        return value.strip() != ""
    if isinstance(value, list):
        return len(value) > 0
    return value is not None


def missing(card_type: str, generated: CardOutput | None) -> list[str]:
    """Required items not decided yet; before the first generation, all of them."""
    card = generated.model_dump(mode="json") if generated is not None else {"data": {}}
    return [label for path, label in REQUIRED[card_type] if not filled(card_type, path, card)]


def ref_line(row: cards_db.CardRow, milestones: list[tuple[str, str]]) -> str:
    """One card as the roles see it: id, kind, name and what it is about."""
    data = row.data
    about: str | None
    match row.type:
        case "world":
            category = CATEGORY.get(data.get("category") or "", "")
            about = " · ".join(x for x in (category, data.get("summary")) if x)
        case "character":
            about = data.get("theme")
        case "region":
            about = data.get("appearance")
        case "main_story":
            about = data.get("theme")
        case "part":
            about = " · ".join(x for x in (data.get("title"), data.get("theme")) if x)
        case _:
            about = data.get("theme")
    line = f"{row.id} {KIND[row.type]} {row.name or '(이름 없음)'}"
    if about:
        line += f": {about}"
    for item_id, text in milestones:
        line += f"\n  - {item_id}: {text}"
    return line


def ref_lines(conn: sqlite3.Connection, rows: list[cards_db.CardRow]) -> str:
    lines = []
    for row in rows:
        items: list[tuple[str, str]] = []
        if row.type == "main_story":
            items = [(m.id, m.text) for m in cards_db.milestones_of_work(conn, row.work_id)]
        elif row.type == "episode":
            plants = row.data.get("foreshadowing", {}).get("plants", [])
            items = [(p["id"], p["text"]) for p in plants if isinstance(p, dict)]
        lines.append(ref_line(row, items))
    return "\n".join(lines)


def mentioned(conn: sqlite3.Connection, work_id: str, ids: list[str]) -> list[cards_db.CardRow]:
    """The @ cards that are cards of this work, once each."""
    rows = []
    for card_id in dict.fromkeys(ids):
        row = cards_db.get(conn, card_id)
        if row is not None and row.work_id == work_id:
            rows.append(row)
    return rows


def chat_turns(
    notes: str,
    refs: str,
    card_type: str,
    missing_items: list[str],
    turns: list[tuple[str, str]],
) -> list[Message]:
    """Context blocks first, then the last turns. The blocks lead the first user message; when
    the window starts with the AI (its opening question), they stand alone before it, so the
    question the user answers is never dropped."""
    todo = ", ".join(missing_items) if missing_items else "없음"
    context = "\n".join(
        [
            block("원문", notes),
            block("참고 카드", refs),
            block("지시", f"카드 종류: {KIND[card_type]}. 정해지지 않은 항목: {todo}"),
        ]
    )
    recent = turns[-CHAT_TURNS:]
    if not recent or recent[0][0] != "user":
        messages: list[Message] = [{"role": "user", "content": context}]
    else:
        messages = [{"role": "user", "content": f"{context}\n\n{recent[0][1]}"}]
        recent = recent[1:]
    for role, text in recent:
        messages.append({"role": "user" if role == "user" else "assistant", "content": text})
    return messages


def source_turns(
    notes: str, names: str, card_type: str, user_text: str, reply: str
) -> list[Message]:
    """The source role sees the numbered notes, the work's card names and the last turn
    (lines 사용자:/AI:, never a word a story could use, §13)."""
    return [
        {
            "role": "user",
            "content": "\n".join(
                [
                    block("원문", numbered(notes)),
                    block("참고 카드", names),
                    block("지시", f"카드 종류: {KIND[card_type]}"),
                    block("대화", f"사용자: {user_text}\nAI: {reply}"),
                ]
            ),
        }
    ]


def name_lines(rows: list[cards_db.CardRow], self_id: str | None) -> str:
    """Every other card of the work by id, kind and name: for similar-name checks."""
    return "\n".join(
        f"{row.id} {KIND[row.type]} {row.name}" for row in rows if row.id != self_id and row.name
    )
