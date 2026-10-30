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
        # A mark only opens a quote when it closes on the same line.
        (
            '닫히지 않은 "따옴표다. 여기다\n다음 줄이다. 끝이다.',
            ['닫히지 않은 "따옴표다.', "여기다", "다음 줄이다.", "끝이다."],
        ),
        ("그는 '90년대에 태어났다. 테오는 강하다.", ["그는 '90년대에 태어났다.", "테오는 강하다."]),
        ("테오's 검이다. 테오는 강하다.", ["테오's 검이다.", "테오는 강하다."]),
        ("테오's 검이다. 미라's 활이다.", ["테오's 검이다.", "미라's 활이다."]),
        # A quote inside a quote must close before the enclosing one.
        (
            "미라는 \"'90년대가 좋았지.\"라고 한다. 테오는 '물때'를 안다.",
            ['미라는 "\'90년대가 좋았지."라고 한다.', "테오는 '물때'를 안다."],
        ),
        (
            "테오는 \"It's mine.\"이라 한다. 미라는 '물때'라 부른다.",
            ['테오는 "It\'s mine."이라 한다.', "미라는 '물때'라 부른다."],
        ),
        (
            "그는 \"그건 '물때'다.\"라고 한다. 끝이다.",
            ["그는 \"그건 '물때'다.\"라고 한다.", "끝이다."],
        ),
        # Known limit (§15): two word-initial marks on one line read as a quote.
        (
            "그는 '90년대에 태어났다. 미라는 '00년대에 태어났다.",
            ["그는 '90년대에 태어났다. 미라는 '00년대에 태어났다."],
        ),
        (
            "테오는 “가자. 어서 하고 외친다. 미라는 웃는다.",
            ["테오는 “가자.", "어서 하고 외친다.", "미라는 웃는다."],
        ),
        ("줄을 넘는 '인용.\n다음 줄'이다.", ["줄을 넘는 '인용.", "다음 줄'이다."]),
        ("윈도 줄바꿈이다.\r\n둘째 줄이다.", ["윈도 줄바꿈이다.", "둘째 줄이다."]),
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
    # The wider gap around a deleted sentence stays: line and paragraph breaks survive.
    assert apply_edits("A다.\nB다. C다.", output([(1, None)])).notes == "A다.\nC다."
    assert apply_edits("A다.\n\nB다.\nC다.", output([(1, None)])).notes == "A다.\n\nC다."
    assert apply_edits("A다. B다.\n\nC다.", output([(0, None), (1, None)])).notes == "C다."
    assert apply_edits("A다.\n\nB다.\n", output([(1, None)])).notes == "A다.\n"
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


@pytest.mark.parametrize(
    ("text", "notes"),
    [
        ("리아는 활을 쓴다", "리아는 활을 쓴다. B다. C다."),
        ('테오는 "가자."라고 한다', '테오는 "가자."라고 한다. B다. C다.'),
        # A mark with no closer on its line is not a quote.
        ("리아의 별명은 '꼬마다.", "리아의 별명은 '꼬마다. B다. C다."),
        ("   ", "B다. C다."),
    ],
)
def test_replacement_never_swallows_the_next_sentence(text: str, notes: str) -> None:
    revised = apply_edits("A다. B다. C다.", output([(0, text)]))
    assert revised.notes == notes
    assert revised.sentences[-2:] == ["B다.", "C다."]
    assert revised.changed == ([0] if text.strip() else [])


@pytest.mark.parametrize(
    ("notes", "index", "text", "revised"),
    [
        # The new quote mark would pair with one in a later sentence and swallow B.
        ("A다. B다. 끝'이다.", 0, "리아는 '꼬마다.", "리아는 '꼬마다.\nB다. 끝'이다."),
        # ...or with an earlier one that used to be a stray mark.
        ("A '다. B다. C다.", 1, "B'다.", "A '다.\nB'다.\nC다."),
    ],
)
def test_replacement_is_isolated_when_quotes_would_merge(
    notes: str, index: int, text: str, revised: str
) -> None:
    result = apply_edits(notes, output([(index, text)]))
    assert result.notes == revised
    untouched = [s for n, s in enumerate(split_sentences(notes)) if n != index]
    assert all(s in result.sentences for s in untouched)


def test_untouched_notes_are_returned_as_is() -> None:
    notes = "  A다.\r\nB다.\n"
    assert apply_edits(notes, output()).notes == notes
    assert apply_edits(notes, output([(5, "없다.")])).notes == notes


def test_added_lines_follow_the_notes_line_ending() -> None:
    revised = apply_edits("A다.\r\nB다.\r\n", output(added=["C다"]))
    assert revised.notes == "A다.\r\nB다.\r\nC다."


def test_repeated_sentence_counts_as_changed() -> None:
    assert apply_edits("A다. B다.", output(added=["A다."])).changed == [2]
    # The highlight follows what the model wrote, not an untouched copy of the same text.
    assert apply_edits("A다. B다. C다.", output([(0, "C다.")])).changed == [0]
    assert apply_edits("A다. B다. C다.", output([(0, "B다.")])).changed == [0]


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
        ("테오는 떠났다…", True),
        ("그건 사실이 아니다!", True),
        ("정말 그렇다?", False),
        ("마법을 '물때'라고 부른다.'", True),
        ("시전자가 바다에 끌려 들어간대.", False),
        ("등대지기 길드가 이 마법을 관리해.", False),
        ("이 마법은 누가 관리하나요?", False),
        ('테오는 "됐어."', False),
    ],
)
def test_is_declarative(sentence: str, declarative: bool) -> None:
    assert is_declarative(sentence) is declarative
