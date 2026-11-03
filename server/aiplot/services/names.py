"""Similar names (§8, §13): a name the user wrote that is one or two letters off a card's name
(레오/래오, 회색 습지/회색 늪지) is asked about as possibly the same entity.

Found in code, not by the model: Hangul syllables are compared letter by letter (initial,
vowel, final), so a changed vowel or final counts as one difference. Unit 15 measured the
source role finding 7 of 12 such pairs, with 2 wrong ones.
"""

import re
from dataclasses import dataclass

HANGUL_FIRST = 0xAC00
HANGUL_LAST = 0xD7A3

# Particles and endings that follow a name in a sentence ("래오가", "에바 천이랑"). Vocative
# 아/야 are left out: too many names end in them.
PARTICLES = sorted(
    [
        "에게서", "한테서", "으로부터", "이랑", "에서", "에게", "한테", "께서", "으로", "이나",
        "이며", "이고", "이다", "이자", "처럼", "까지", "부터", "보다", "하고", "님", "은", "는",
        "이", "가", "을", "를", "의", "에", "와", "과", "도", "만", "로", "랑",
    ],
    key=len,
    reverse=True,
)  # fmt: skip
WORD = re.compile(r"[\w가-힣]+")


@dataclass(frozen=True)
class Similar:
    mentioned: str
    similar_to: str
    card_id: str


def letters(text: str) -> list[str]:
    """Each Hangul syllable as its initial, vowel and final (final may be empty); anything
    else as itself. Spaces are dropped."""
    out: list[str] = []
    for char in text:
        code = ord(char)
        if HANGUL_FIRST <= code <= HANGUL_LAST:
            index = code - HANGUL_FIRST
            out += [f"L{index // 588}", f"V{(index % 588) // 28}", f"T{index % 28}"]
        elif not char.isspace():
            out.append(char)
    return out


def distance(a: list[str], b: list[str]) -> int:
    """Edit distance (insert, delete, change one letter)."""
    previous = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        current = [i]
        for j, y in enumerate(b, 1):
            current.append(min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + (x != y)))
        previous = current
    return previous[-1]


def stems(word: str) -> list[str]:
    """The word, and the word without a particle after it (keeping at least one syllable)."""
    out = [word]
    for particle in PARTICLES:
        if word.endswith(particle) and len(word) > len(particle):
            out.append(word[: -len(particle)])
            break
    return out


def syllables(text: str) -> int:
    return sum(1 for char in text if not char.isspace())


def allowed(name: str) -> int:
    """How many letters may differ: one up to three syllables (래오/레오, 윤체아/윤채아), two
    from four on (회색 늪지/회색 습지). Two in a three-syllable name catches different words
    with a shared start (청운문, a sect, against 청운산, a mountain)."""
    return 2 if syllables(name) >= 4 else 1


def similar_names(text: str, cards: list[tuple[str, str]]) -> list[Similar]:
    """Names in `text` close to a card's name but not the same: one pair per mentioned name,
    with the closest card. A name that is part of a card's name (무현 for 연무현), or the
    whole of one, is that card, not a look-alike."""
    words = WORD.findall(text)
    candidates: list[str] = []
    for i, word in enumerate(words):
        candidates += stems(word)
        if i + 1 < len(words):
            candidates += [f"{word} {stem}" for stem in stems(words[i + 1])]
    known = {name for _, name in cards}
    found: dict[str, Similar] = {}
    best: dict[str, int] = {}
    for candidate in dict.fromkeys(candidates):
        if candidate in known or any(candidate in name or name in candidate for name in known):
            continue
        mine = letters(candidate)
        for card_id, name in cards:
            if abs(syllables(name) - syllables(candidate)) > 1:
                continue
            gap = distance(mine, letters(name))
            if 0 < gap <= allowed(name) and gap < best.get(candidate, gap + 1):
                best[candidate] = gap
                found[candidate] = Similar(candidate, name, card_id)
    # A two-word candidate that covers a one-word one ("에바 천" over "천") wins.
    pairs = list(found.values())
    return [
        p
        for p in pairs
        if not any(
            q is not p and p.mentioned in q.mentioned and q.card_id == p.card_id for q in pairs
        )
    ]
