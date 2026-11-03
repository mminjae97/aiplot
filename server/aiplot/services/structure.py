"""Story structure stage counts (§7): 5-stage 발단·전개·위기·절정·결말 mapped onto 기승전결."""

from typing import Any

# Each type's stage names in story order (§15: exactly 기승전결 or 발단…결말).
STAGE_NAMES: dict[int, tuple[str, ...]] = {
    4: ("기", "승", "전", "결"),
    5: ("발단", "전개", "위기", "절정", "결말"),
}

# Each 4-stage name and the 5-stage stages it takes, in story order.
FIVE_TO_FOUR: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("기", ("발단",)),
    ("승", ("전개", "위기")),
    ("전", ("절정",)),
    ("결", ("결말",)),
)


def name_by_position(structure: dict[str, Any]) -> None:
    """Stages are in story order, so each one is named by its position in the type's
    sequence: the model may repeat a name (발단, 발단, 위기…). Summaries and tensions stay. A
    stage count that does not fit the type is left for validation to refuse."""
    names = STAGE_NAMES.get(structure.get("type") or 0)
    stages = structure.get("stages")
    if names is None or not isinstance(stages, list) or len(stages) != len(names):
        return
    for stage, name in zip(stages, names, strict=True):
        if isinstance(stage, dict):
            stage["name"] = name


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
