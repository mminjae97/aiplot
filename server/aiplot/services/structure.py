"""Story structure stage counts (§7): 5-stage 발단·전개·위기·절정·결말 mapped onto 기승전결."""

from typing import Any

# Each 4-stage name and the 5-stage stages it takes, in story order.
FIVE_TO_FOUR: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("기", ("발단",)),
    ("승", ("전개", "위기")),
    ("전", ("절정",)),
    ("결", ("결말",)),
)


def five_to_four(structure: dict[str, Any]) -> dict[str, Any]:
    """The 4-stage structure of a 5-stage one, in code (no model call): 승 joins 전개 and 위기
    (their summaries in order, empty ones skipped; the higher tension), the others carry over."""
    by_name = {stage["name"]: stage for stage in structure["stages"]}
    stages = []
    for name, sources in FIVE_TO_FOUR:
        merged = [by_name[source] for source in sources if source in by_name]
        summaries = [s["summary"].strip() for s in merged if (s["summary"] or "").strip()]
        tensions = [s["tension"] for s in merged if s["tension"] is not None]
        stages.append(
            {
                "name": name,
                "summary": " ".join(summaries) if summaries else None,
                "tension": max(tensions) if tensions else None,
            }
        )
    return {"type": 4, "stages": stages}
