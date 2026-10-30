"""Step 1 unit 5: real-model measurements through the server's own router and client.

Start llama-server by hand with the profile's GGUF and flags, then run for example:
    uv run python eval/unit5/measure.py --url http://127.0.0.1:8796 \
        --profile qwen3-8b-uncensor-q4km --out eval/results/unit5-q4km.json

--cases ID... runs only those card cases (no refusals or writing).

Measures the chat template thinking toggle, chat/source/card on cases.json (time, token usage,
finish reason, schema validity), refusals on typical web novel scenes, and Korean prose beats
written with the style framework (for the blind comparison). Results hold raw model output and
stay out of git (eval/.gitignore).
"""

import argparse
import asyncio
import json
import re
import time
from contextlib import aclosing
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx2 as httpx
from aiplot.generated.roles.card_output import (
    CharacterCardOutput,
    EpisodeCardOutput,
    MainStoryCardOutput,
    PartCardOutput,
    RegionCardOutput,
    WorldCardOutput,
)
from aiplot.generated.roles.source_output import SourceOutput
from aiplot.llm.client import ChatRequest, LlamaClient, LlmError, Message, Usage
from aiplot.llm.config import SERVER_DIR, LlmConfig, Sampling, load_llm_config
from aiplot.llm.router import Router
from aiplot.services.notes import EmptyNotesError, apply_edits, numbered
from pydantic import BaseModel

HERE = Path(__file__).parent
STYLE_FILE = SERVER_DIR / "data" / "style" / "webnovel-style-v1.md"
# Room to see natural reply lengths: card system prompt + notes + this stays under ctx 8192.
MEASURE_MAX_TOKENS = 6000
WRITE_MAX_TOKENS = 1500
# Step 7 sets the write role; same settings for every profile keeps the comparison fair.
WRITE_SAMPLING = Sampling(temperature=0.8, top_p=0.8, top_k=20, min_p=0.0)
CARD_OUTPUTS: dict[str, type[BaseModel]] = {
    "world": WorldCardOutput,
    "character": CharacterCardOutput,
    "region": RegionCardOutput,
    "main_story": MainStoryCardOutput,
    "part": PartCardOutput,
    "episode": EpisodeCardOutput,
}
TYPE_NAMES = {
    "world": "세계관",
    "character": "캐릭터",
    "region": "지역",
    "main_story": "메인 스토리",
    "part": "부",
    "episode": "에피소드",
}
REFUSAL_MARKERS = (
    "죄송",
    "도와드릴 수 없",
    "할 수 없습니다",
    "작성할 수 없",
    "제공할 수 없",
    "적절하지 않",
    "I can't",
    "I cannot",
    "I'm sorry",
)


def measure_config(profile: str) -> LlmConfig:
    config = load_llm_config()
    roles = {
        role: rc.model_copy(update={"profile": profile, "max_tokens": MEASURE_MAX_TOKENS})
        for role, rc in config.roles.items()
    }
    return LlmConfig(profiles=config.profiles, roles=roles)


def block(tag: str, body: str) -> str:
    return f"<{tag}>\n{body}\n</{tag}>"


def style_system_prompt(path: Path = STYLE_FILE, beat: dict[str, Any] | None = None) -> str:
    """Style framework as step 7 will send it (§10): every-beat sections first (the cached
    prefix), then the by_mode / by_focus subsections matching the beat; empty ones omitted."""
    text = path.read_text(encoding="utf-8")
    text = re.sub(r"^---.*?---\n", "", text, flags=re.DOTALL)
    text = re.sub(r"<!--.*?-->\n?", "", text, flags=re.DOTALL)
    sections = dict(re.findall(r"^## (\w+)\n(.*?)(?=^## |\Z)", text, flags=re.DOTALL | re.M))
    banned = [
        line[2:].strip()
        for line in sections["banned"].splitlines()
        if line.startswith("- ") and not line[2:].startswith("/")
    ]
    parts = [sections[name].strip() for name in ("role", "summary", "rules", "dialogue", "format")]
    parts.append("금지 표현: " + ", ".join(f'"{b}"' for b in banned))
    if beat is not None:
        for section, key in (("by_mode", beat.get("mode")), ("by_focus", beat.get("focus"))):
            subsections = dict(
                re.findall(r"^### (\S+)\n(.*?)(?=^### |\Z)", sections.get(section, ""), re.S | re.M)
            )
            if key is not None and subsections.get(key, "").strip():
                parts.append(subsections[key].strip())
    return "\n\n".join(p for p in parts if p)


def usage_dict(usage: Usage | None) -> dict[str, int] | None:
    return asdict(usage) if usage is not None else None


async def run_stream(client: LlamaClient, request: ChatRequest) -> dict[str, Any]:
    started = time.perf_counter()
    first: float | None = None
    content: list[str] = []
    reasoning: list[str] = []
    finish = None
    usage = None
    async with aclosing(client.stream(request)) as deltas:
        async for delta in deltas:
            if delta.kind == "content":
                first = first or time.perf_counter() - started
                content.append(delta.text)
            elif delta.kind == "reasoning":
                reasoning.append(delta.text)
            else:
                finish, usage = delta.text, delta.usage
    text = "".join(content)
    return {
        "text": text,
        "chars": len(text),
        "reasoning_chars": len("".join(reasoning)),
        "first_content_s": round(first, 2) if first is not None else None,
        "total_s": round(time.perf_counter() - started, 2),
        "finish": finish,
        "usage": usage_dict(usage),
    }


async def run_json(
    router: Router, role: str, turns: list[Message], output: type[BaseModel]
) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        result = await router.complete_json(role, turns, output)  # type: ignore[arg-type]
    except LlmError as exc:
        return {"error": exc.code, "message": str(exc)[:500], "total_s": elapsed(started)}
    return {
        "value": result.value.model_dump(mode="json"),
        "reasoning_chars": len(result.reasoning),
        "usage": usage_dict(result.usage),
        "total_s": elapsed(started),
    }


async def run_source(
    router: Router, turns: list[Message], notes: str
) -> tuple[dict[str, Any], str]:
    """source as the drafts flow runs it (§13): apply the edits; casual sentences or emptied
    notes get one more generation, then the second result is kept (emptied twice = invalid,
    notes unchanged). An LLM error (after the router's own JSON retry) ends the call.
    total_s and usage cover every generation the user waits through."""
    attempts: list[dict[str, Any]] = []
    revised = notes
    for _ in range(2):
        result = await run_json(router, "source", turns, SourceOutput)
        attempts.append(result)
        if "value" not in result:
            break
        try:
            applied = apply_edits(notes, SourceOutput.model_validate(result["value"]))
        except EmptyNotesError:
            result["emptied"] = True
            continue
        revised = applied.notes
        result.update(changed=applied.changed, casual=applied.casual)
        if not applied.casual:
            break
    # Casual then emptied keeps the casual result; only emptied twice is invalid.
    usable = [a for a in attempts if "value" in a and not a.get("emptied")]
    last = usable[-1] if usable else attempts[-1]
    if all(a.get("emptied") for a in attempts):
        last = {**last, "error": "LLM_INVALID_OUTPUT", "message": "notes emptied twice"}
        last.pop("value", None)
    usages = [a["usage"] for a in attempts if a.get("usage")]
    usage = {key: sum(u[key] for u in usages) for key in usages[0]} if usages else last.get("usage")
    total_s = round(sum(a.get("total_s") or 0 for a in attempts), 2)
    combined = {**last, "attempts": len(attempts), "notes": revised}
    return {**combined, "usage": usage, "total_s": total_s}, revised


def elapsed(started: float) -> float:
    return round(time.perf_counter() - started, 2)


async def check_template(http: httpx.AsyncClient, router: Router, client: LlamaClient) -> Any:
    props = (await http.get("/props")).json()
    template = props.get("chat_template", "")
    turns: list[Message] = [{"role": "user", "content": "한 문장으로 인사해 줘."}]
    results = {}
    for thinking in (False, True):
        request = router.request("chat", turns)
        request = ChatRequest(**{**request.__dict__, "thinking": thinking, "max_tokens": 1024})
        results[f"thinking_{'on' if thinking else 'off'}"] = await run_stream(client, request)
    return {
        "model_path": props.get("model_path"),
        "build_info": props.get("build_info"),
        "template_mentions_enable_thinking": "enable_thinking" in template,
        **results,
    }


async def run_card_case(
    router: Router, client: LlamaClient, case: dict[str, Any]
) -> dict[str, Any]:
    refs = "\n".join(case["refs"])
    kind = TYPE_NAMES[case["type"]]
    context = "\n".join(
        [
            block("원문", case["notes"]),
            block("참고 카드", refs),
            block("지시", f"카드 종류: {kind}. 정해지지 않은 항목: {case['missing']}"),
        ]
    )
    chat_turns: list[Message] = [{"role": "user", "content": f"{context}\n\n{case['chat_user']}"}]
    chat = await run_stream(client, router.request("chat", chat_turns))
    source_turns: list[Message] = [
        {
            "role": "user",
            "content": "\n".join(
                [
                    block("원문", numbered(case["notes"])),
                    block("참고 카드", refs),
                    block("지시", f"카드 종류: {kind}"),
                    block("대화", f"사용자: {case['chat_user']}\nAI: {chat['text']}"),
                ]
            ),
        }
    ]
    source, notes = await run_source(router, source_turns, case["notes"])
    card_turns: list[Message] = [
        {
            "role": "user",
            "content": "\n".join(
                [
                    block("원문", numbered(notes)),
                    block("참고 카드", refs),
                    block("지시", f"카드 종류: {case['type']}"),
                ]
            ),
        }
    ]
    card = await run_json(router, "card", card_turns, CARD_OUTPUTS[case["type"]])
    return {"id": case["id"], "type": case["type"], "chat": chat, "source": source, "card": card}


async def run_refusal(
    router: Router, client: LlamaClient, write_system: str, case: dict[str, Any]
) -> dict[str, Any]:
    if case["role"] == "chat":
        kind = block("지시", "카드 종류: 메인 스토리")
        turns: list[Message] = [{"role": "user", "content": f"{kind}\n\n{case['prompt']}"}]
        result = await run_stream(client, router.request("chat", turns))
    else:
        result = await run_stream(client, write_request(router, write_system, case["prompt"]))
    refused = any(marker in result["text"] for marker in REFUSAL_MARKERS)
    return {"id": case["id"], "role": case["role"], "refused_guess": refused, **result}


def write_request(
    router: Router, system: str, instruction: str, sampling: Sampling = WRITE_SAMPLING
) -> ChatRequest:
    base = router.request("chat", [])
    return ChatRequest(
        role="write",
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": block("지시", instruction)},
        ],
        thinking=False,
        thinking_kwarg=base.thinking_kwarg,
        sampling=sampling,
        max_tokens=WRITE_MAX_TOKENS,
    )


def beat_instruction(beat: dict[str, Any]) -> str:
    return "\n".join(
        [
            f"장르: {beat['genre']}",
            f"장면 종류: {beat['scene']}",
            f"시점: {beat['pov']}",
            f"서술 방식: {beat['mode']}",
            f"긴장도: {beat['tension']} / 5",
            f"분량: 공백 포함 {beat['target_chars']}자 안팎",
            f"내용: {beat['instruction']}",
        ]
    )


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--profile", required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--repeat", type=int, default=2)
    parser.add_argument(
        "--cases", nargs="+", metavar="ID", help="only these card cases; skips refusals and writing"
    )
    args = parser.parse_args()

    cases = json.loads((HERE / "cases.json").read_text(encoding="utf-8"))
    if args.cases:
        unknown = set(args.cases) - {case["id"] for case in cases["cards"]}
        if unknown:
            raise SystemExit(f"unknown card cases: {sorted(unknown)}")
        cases = {
            "cards": [case for case in cases["cards"] if case["id"] in args.cases],
            "refusals": [],
            "writing": [],
        }
    config = measure_config(args.profile)
    client = LlamaClient(args.url)
    router = Router(config, client, lora_dir=HERE / "no-lora")
    write_system = style_system_prompt()
    results: dict[str, Any] = {
        "profile": args.profile,
        "gguf": config.profiles[args.profile].gguf.file,
        "started_at": datetime.now(UTC).isoformat(),
        "measure_max_tokens": MEASURE_MAX_TOKENS,
    }
    async with httpx.AsyncClient(base_url=args.url, timeout=30) as http:
        results["template"] = await check_template(http, router, client)
        model_path = str(results["template"]["model_path"] or "")
        if not model_path.endswith(results["gguf"]):
            raise SystemExit(f"llama-server runs {model_path}, not {results['gguf']}")
        results["system_prompt_tokens"] = {
            role: len((await http.post("/tokenize", json={"content": text})).json()["tokens"])
            for role, text in [
                *((r, router.system_prompt(r)) for r in ("chat", "source", "card")),
                ("write", write_system),
            ]
        }
    results["cards"] = []
    for repeat in range(args.repeat):
        for case in cases["cards"]:
            print(f"card {case['id']} #{repeat + 1}", flush=True)
            results["cards"].append({"repeat": repeat, **await run_card_case(router, client, case)})
    results["refusals"] = []
    for case in cases["refusals"]:
        print(f"refusal {case['id']}", flush=True)
        results["refusals"].append(await run_refusal(router, client, write_system, case))
    results["writing"] = []
    for beat in cases["writing"]:
        print(f"writing {beat['id']}", flush=True)
        request = write_request(router, write_system, beat_instruction(beat))
        results["writing"].append({"id": beat["id"], **await run_stream(client, request)})
    await client.aclose()
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"wrote {args.out}")


if __name__ == "__main__":
    asyncio.run(main())
