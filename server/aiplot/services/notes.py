"""Source notes as sentences (§15) and the `source` role's sentence edits (§13).

One split rule serves evidence indexes, highlights, changed sentences and source edits: a
sentence ends after a run of . ? ! … followed by whitespace or the end, never inside quotes,
and at every newline. Edits keep the user's layout: untouched sentences and the whitespace
between them stay byte-identical.
"""

from dataclasses import dataclass

from aiplot.generated.roles.source_output import SourceOutput

TERMINATORS = frozenset(".?!…")
# Symmetric quotes toggle; paired ones nest by depth. Both reset at a newline.
TOGGLE_QUOTES = frozenset("\"'")
OPEN_QUOTES = {"“": "”", "‘": "’", "「": "」", "『": "』"}  # noqa: RUF001
CLOSING = frozenset("\"')]" + "".join(OPEN_QUOTES.values()))


class EmptyNotesError(ValueError):
    """The edits would empty notes that were not empty (§13: rejected)."""


def split_spans(text: str) -> list[tuple[int, int]]:
    """Start/end offsets of each sentence, whitespace trimmed, empty pieces dropped."""
    spans: list[tuple[int, int]] = []
    start = 0
    toggled: set[str] = set()
    closers: list[str] = []
    i = 0

    def emit(end: int) -> None:
        piece = text[start:end]
        lead = len(piece) - len(piece.lstrip())
        trimmed = piece.strip()
        if trimmed:
            spans.append((start + lead, start + lead + len(trimmed)))

    while i < len(text):
        ch = text[i]
        if ch == "\n":
            emit(i)
            start = i + 1
            toggled.clear()
            closers.clear()
        elif ch in TOGGLE_QUOTES:
            toggled.symmetric_difference_update({ch})
        elif ch in OPEN_QUOTES:
            closers.append(OPEN_QUOTES[ch])
        elif closers and ch == closers[-1]:
            closers.pop()
        elif ch in TERMINATORS and not toggled and not closers:
            end = i
            while end < len(text) and text[end] in TERMINATORS:
                end += 1
            if end == len(text) or text[end].isspace():
                emit(end)
                start = end
            i = end
            continue
        i += 1
    emit(len(text))
    return spans


def split_sentences(text: str) -> list[str]:
    return [text[a:b] for a, b in split_spans(text)]


def numbered(text: str) -> str:
    """Notes as the model sees them: one `[n] sentence` per line, 0-based."""
    return "\n".join(f"[{n}] {s}" for n, s in enumerate(split_sentences(text)))


def is_declarative(sentence: str) -> bool:
    """Notes are plain statements ending in 다 (source prompt); catches copied casual speech."""
    body = sentence.rstrip()
    while body and body[-1] in CLOSING:
        body = body[:-1]
    body = body.rstrip(".")
    return body.endswith("다")


@dataclass(frozen=True)
class RevisedNotes:
    notes: str
    sentences: list[str]
    # Indexes into sentences that are new or rewritten (highlighted in the drawer, §8).
    changed: list[int]
    # Indexes of changed sentences that are not plain 다 statements.
    casual: list[int]


def apply_edits(notes: str, output: SourceOutput) -> RevisedNotes:
    spans = split_spans(notes)
    replaced: dict[int, str | None] = {}
    for edit in output.edits:
        # Out-of-range and repeated indexes are model mistakes; the first edit wins.
        if edit.index < len(spans) and edit.index not in replaced:
            replaced[edit.index] = edit.text
    parts: list[str] = []
    cursor = 0
    for index, (start, end) in enumerate(spans):
        gap = notes[cursor:start]
        cursor = end
        if index not in replaced:
            parts.append(gap + notes[start:end])
        elif (text := replaced[index]) is not None:
            parts.append(gap + text.strip())
    parts.append(notes[cursor:])
    revised = "".join(parts).strip()
    added = [line.strip() for line in output.added if line.strip()]
    if added:
        revised = "\n".join([revised, *added]) if revised else "\n".join(added)
    if spans and not revised:
        raise EmptyNotesError("edits would empty the notes")
    before = set(split_sentences(notes))
    sentences = split_sentences(revised)
    changed = [n for n, s in enumerate(sentences) if s not in before]
    casual = [n for n in changed if not is_declarative(sentences[n])]
    return RevisedNotes(notes=revised, sentences=sentences, changed=changed, casual=casual)
