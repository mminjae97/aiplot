"""Sentence split (§15) and source edits (§13) on Korean notes."""

from collections.abc import Sequence

import pytest

from aiplot.generated.roles.source_output import SourceEdit, SourceOutput
from aiplot.services.notes import (
    EmptyNotesError,
    apply_edits,
    is_declarative,
    numbered,
    split_sentences,
)


@pytest.mark.parametrize(
    ("text", "sentences"),
    [
        ("테오는 북부 항구 출신이다. 말수가 적다.", ["테오는 북부 항구 출신이다.", "말수가 적다."]),
        ("누구지? 설마! 아니야…", ["누구지?", "설마!", "아니야…"]),
        ("그럴 리가?! 정말이다...", ["그럴 리가?!", "정말이다..."]),
        ("거리는 3.5리다. 금화 1.000개다.", ["거리는 3.5리다.", "금화 1.000개다."]),
        (
            '테오는 "됐어. 따라와."라고 자주 말한다.',
            ['테오는 "됐어. 따라와."라고 자주 말한다.'],
        ),
        (
            "미라는 “정말? 가자!” 하고 웃는다. 테오는 따른다.",
            ["미라는 “정말? 가자!” 하고 웃는다.", "테오는 따른다."],
        ),
        (
            "마법이 가장 강한 시각을 '물때. 밀물'이라 부른다.",
            ["마법이 가장 강한 시각을 '물때. 밀물'이라 부른다."],
        ),
        ("「가자. 어서.」라고 외친다.", ["「가자. 어서.」라고 외친다."]),
        ("첫 줄 마침표 없음\n둘째 줄이다.", ["첫 줄 마침표 없음", "둘째 줄이다."]),
        (
            '닫히지 않은 "따옴표. 여기\n다음 줄이다. 끝이다.',
            ['닫히지 않은 "따옴표. 여기', "다음 줄이다.", "끝이다."],
        ),
        ("  앞 공백이다.  \n\n\n  뒤 공백이다.  ", ["앞 공백이다.", "뒤 공백이다."]),
        ("주소는 www.aiplot.kr이다.", ["주소는 www.aiplot.kr이다."]),
        ("", []),
        (" \n \n", []),
    ],
)
def test_split_sentences(text: str, sentences: list[str]) -> None:
    assert split_sentences(text) == sentences


def test_numbered_is_zero_based() -> None:
    assert numbered("리아는 사막 도시 출신이다. 리아는 검을 쓴다.") == (
        "[0] 리아는 사막 도시 출신이다.\n[1] 리아는 검을 쓴다."
    )


def output(edits: Sequence[tuple[int, str | None]] = (), added: Sequence[str] = ()) -> SourceOutput:
    return SourceOutput(
        edits=[SourceEdit(index=i, text=t) for i, t in edits],
        added=list(added),
        questions=[],
        similar_names=[],
    )


NOTES = "리아는 사막 도시 출신이다. 리아는 검을 쓴다.\n리아는 말이 빠르다."


def test_untouched_sentences_and_layout_stay() -> None:
    revised = apply_edits(NOTES, output([(1, "리아는 활을 쓴다.")], ["리아에게는 동생이 있다."]))
    assert revised.notes == (
        "리아는 사막 도시 출신이다. 리아는 활을 쓴다.\n리아는 말이 빠르다.\n리아에게는 동생이 있다."
    )
    assert revised.changed == [1, 3]
    assert revised.casual == []


def test_delete_keeps_neighbours() -> None:
    assert (
        apply_edits(NOTES, output([(1, None)])).notes
        == "리아는 사막 도시 출신이다.\n리아는 말이 빠르다."
    )
    assert apply_edits(NOTES, output([(0, None)])).notes == "리아는 검을 쓴다.\n리아는 말이 빠르다."
    assert (
        apply_edits(NOTES, output([(2, None)])).notes
        == "리아는 사막 도시 출신이다. 리아는 검을 쓴다."
    )


def test_model_mistakes_are_dropped() -> None:
    revised = apply_edits(
        NOTES,
        output(
            [
                (9, "없는 문장이다."),
                (0, "리아는 항구 출신이다."),
                (0, None),
                (2, "리아는 말이 빠르다."),
            ]
        ),
    )
    # Out of range ignored, first edit for index 0 wins, an unchanged rewrite is not a change.
    assert revised.notes == "리아는 항구 출신이다. 리아는 검을 쓴다.\n리아는 말이 빠르다."
    assert revised.changed == [0]


def test_rewrite_into_two_sentences_is_split() -> None:
    revised = apply_edits(NOTES, output([(1, "리아는 활을 쓴다. 화살은 직접 만든다.")]))
    assert revised.sentences[1:3] == ["리아는 활을 쓴다.", "화살은 직접 만든다."]
    assert revised.changed == [1, 2]


def test_empty_notes_start_from_added() -> None:
    revised = apply_edits("", output(added=["리아는 사막 도시 출신이다.", "  "]))
    assert revised.notes == "리아는 사막 도시 출신이다."
    assert revised.changed == [0]


def test_emptying_notes_is_rejected() -> None:
    with pytest.raises(EmptyNotesError):
        apply_edits(NOTES, output([(0, None), (1, None), (2, None)]))
    assert apply_edits("", output()).notes == ""


def test_casual_changes_are_flagged() -> None:
    revised = apply_edits(
        NOTES,
        output([(1, "리아는 활을 써.")], ["등대지기 길드가 이 마법을 관리해.", "리아는 웃는다."]),
    )
    assert revised.casual == [1, 3]


@pytest.mark.parametrize(
    ("sentence", "declarative"),
    [
        ("조수 마법은 바닷물이 닿는 곳에서만 쓸 수 있다.", True),
        ('테오는 "됐어. 따라와."라고 자주 말한다.', True),
        ("리아에게는 동생이 한 명 있다", True),
        ("마법을 '물때'라고 부른다.'", True),
        ("시전자가 바다에 끌려 들어간대.", False),
        ("등대지기 길드가 이 마법을 관리해.", False),
        ("이 마법은 누가 관리하나요?", False),
        ('테오는 "됐어."', False),
    ],
)
def test_is_declarative(sentence: str, declarative: bool) -> None:
    assert is_declarative(sentence) is declarative
