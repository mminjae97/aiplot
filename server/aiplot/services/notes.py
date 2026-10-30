"""Source notes as sentences (§15) and the `source` role's sentence edits (§13).

One split rule serves evidence indexes, highlights, changed sentences and source edits: a
sentence ends after a run of . ? ! … followed by whitespace or the end, never inside quotes,
and at every newline. A quote mark only opens a quote when its closer follows on the same line,
so apostrophes and stray marks never swallow the rest of a line. Edits keep the user's layout:
untouched sentences and the whitespace between them stay byte-identical.
"""

from collections import Counter
from dataclasses import dataclass

from aiplot.generated.roles.source_output import SourceOutput

TERMINATORS = frozenset(".?!…")
# Symmetric quotes close with the same mark; paired ones nest.
TOGGLE_QUOTES = frozenset("\"'")
OPEN_QUOTES = {"“": "”", "‘": "’", "「": "」", "『": "』"}  # noqa: RUF001
CLOSING = frozenset("\"')]" + "".join(OPEN_QUOTES.values()))
# A sentence that ends like this is a plain statement (source prompt: "~다" 평서문).
STATEMENT_END = frozenset(".!…")


class EmptyNotesError(ValueError):
    """The edits would empty notes that were not empty (§13: rejected)."""


def split_spans(text: str) -> list[tuple[int, int]]:
    """Start/end offsets of each sentence, whitespace trimmed, empty pieces dropped."""
    spans: list[tuple[int, int]] = []
    start = 0
    closers: list[str] = []
    line_end = text.find("\n")
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
            closers.clear()
            line_end = text.find("\n", i + 1)
        elif closers and ch == closers[-1]:
            closers.pop()
        elif ch in TOGGLE_QUOTES or ch in OPEN_QUOTES:
            closer = ch if ch in TOGGLE_QUOTES else OPEN_QUOTES[ch]
            if text.find(closer, i + 1, len(text) if line_end < 0 else line_end) >= 0:
                closers.append(closer)
        elif ch in TERMINATORS and not closers:
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
    while body and body[-1] in STATEMENT_END:
        body = body[:-1]
    return body.endswith("다")


def with_period(text: str) -> str:
    """A model-written sentence missing its final mark gets a period, so it ends itself."""
    text = text.strip()
    if text and text[-1] not in TERMINATORS:
        bare = text.rstrip("".join(CLOSING))
        if not bare or bare[-1] not in TERMINATORS:
            return text + "."
    return text


def wider_gap(kept: str, other: str) -> str:
    """Of the gaps around a deleted sentence, keep the one that breaks more lines."""
    return kept if kept.count("\n") >= other.count("\n") else other


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
            text = edit.text.strip() if edit.text is not None else ""
            replaced[edit.index] = text or None
    added = [with_period(line) for line in output.added if line.strip()]
    if not replaced and not added:
        sentences = split_sentences(notes)
        return RevisedNotes(notes=notes, sentences=sentences, changed=[], casual=[])

    newline = "\r\n" if "\r\n" in notes else "\n"
    kept = Counter(notes[a:b] for n, (a, b) in enumerate(spans) if n not in replaced)

    def build(isolate: bool) -> str:
        """isolate puts every replacement on its own line: a newline resets quote state, so
        a replacement can never merge with its neighbours."""
        parts: list[str] = []
        cursor = 0
        pending: str | None = None  # gap left by a deleted sentence
        after_replacement = False
        for index, (start, end) in enumerate(spans):
            gap = notes[cursor:start]
            cursor = end
            if pending is not None:
                # Nothing kept before it: the notes' own leading whitespace stays.
                gap, pending = (wider_gap(pending, gap) if parts else pending), None
            if index in replaced and replaced[index] is None:
                pending = gap
                continue
            is_replacement = index in replaced
            if isolate and parts and (is_replacement or after_replacement) and "\n" not in gap:
                gap = newline
            text = with_period(replaced[index] or "") if is_replacement else notes[start:end]
            parts.append(gap + text)
            after_replacement = is_replacement
        revised = "".join(parts)
        if not added:
            # A deleted last sentence takes its gap along; trailing whitespace stays.
            return revised + notes[cursor:]
        return newline.join([revised.rstrip(), *added]) if revised.strip() else newline.join(added)

    revised = build(isolate=False)
    if kept - Counter(split_sentences(revised)):
        revised = build(isolate=True)
    if spans and not revised.strip():
        raise EmptyNotesError("edits would empty the notes")

    before = Counter(split_sentences(notes))
    sentences = split_sentences(revised)
    changed = []
    for n, sentence in enumerate(sentences):
        if before[sentence] > 0:
            before[sentence] -= 1
        else:
            changed.append(n)
    casual = [n for n in changed if not is_declarative(sentences[n])]
    return RevisedNotes(notes=revised, sentences=sentences, changed=changed, casual=casual)
