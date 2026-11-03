"""Similar names (§13): found in code, letter by letter."""

from aiplot.services.names import distance, letters, similar_names

CARDS = [
    ("c_leo", "레오"),
    ("c_swamp", "회색 습지"),
    ("c_yoon", "윤채아"),
    ("c_eva", "에바 첸"),
    ("c_mu", "연무현"),
    ("c_mountain", "청운산"),
]


def pairs(text: str) -> list[tuple[str, str]]:
    return [(p.mentioned, p.card_id) for p in similar_names(text, CARDS)]


def test_a_changed_vowel_or_final_is_one_letter() -> None:
    assert distance(letters("래오"), letters("레오")) == 1
    assert distance(letters("오지혁"), letters("오진혁")) == 1
    assert distance(letters("늪지"), letters("습지")) == 2


def test_names_a_letter_off_are_found_with_their_particles() -> None:
    assert pairs("래오가 문 앞을 막아섰어.") == [("래오", "c_leo")]
    assert pairs("윤체아는 웃었어.") == [("윤체아", "c_yoon")]
    # Two words, and two letters off in a name of four syllables.
    assert pairs("회색 늪지 사람들이 반겼어.") == [("회색 늪지", "c_swamp")]
    assert pairs("에바 천이 회의를 열었어.") == [("에바 천", "c_eva")]


def test_the_same_name_or_part_of_it_is_not_a_look_alike() -> None:
    assert pairs("레오와 무현이 만났어.") == []


def test_different_words_are_not_flagged() -> None:
    # 청운문 (a sect) is two letters off 청운산 (a mountain): too many for three syllables.
    assert pairs("청운문의 막내 제자가 떠났어.") == []
    assert pairs("노점상 리안에게 길을 물었어.") == []
