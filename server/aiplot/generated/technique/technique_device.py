# GENERATED from schemas/ by `npm run codegen` in schemas/. Do not edit.

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field

type TechniqueDevice = Annotated[
    Literal[
        "knowledge_gap",
        "hidden_secret",
        "mystery",
        "reveal",
        "reversal",
        "plant",
        "payoff",
        "foretold",
        "deadline",
        "dilemma",
        "eerie_threat",
        "action",
        "held_moment",
        "past_told",
        "embedded",
        "time_skip",
        "revisit",
        "repetition",
        "unspoken",
        "verbal_clash",
        "misunderstanding",
        "overhear",
        "crowd_voice",
        "first_appearance",
        "realization",
        "confession",
        "delayed_outcome",
        "relationship_shift",
        "humor",
        "satire",
        "new_place",
        "world_rules",
        "simultaneous",
        "ordinary_life",
        "aftermath",
        "contrast",
        "loss",
        "meaningful_object",
        "differing_views",
        "threshold",
        "release",
    ],
    Field(
        description="Fixed scene devices (§9): what a scene does with information, time, talk or people, observable in its summary. A scene answers each yes or no; a technique lists the devices it is for. Drawn from the cards' text alone, blind to the eval cases (training/eval/step2/devices).",
        title="TechniqueDevice",
    ),
]
