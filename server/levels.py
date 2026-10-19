"""The three speaking situations from Table 3.3.

Age changes the task card. The room stays the same.
"""

LEVELS = {
    "under_18": [
        {
            "level": 1,
            "room": "Small calm group",
            "task": "A short class talk",
            "pressure": "A small calm group. No questions.",
        },
        {
            "level": 2,
            "room": "More listeners, up to two questions",
            "task": "Explain a school project",
            "pressure": "More listeners, and up to two questions.",
        },
        {
            "level": 3,
            "room": "Interruptions and one harder question",
            "task": "Present to the class",
            "pressure": "Interruptions, and one harder question.",
        },
    ],
    "18_plus": [
        {
            "level": 1,
            "room": "Small calm group",
            "task": "A short presentation",
            "pressure": "A small calm group. No questions.",
        },
        {
            "level": 2,
            "room": "More listeners, up to two questions",
            "task": "Graduation-project discussion",
            "pressure": "More listeners, and up to two questions.",
        },
        {
            "level": 3,
            "room": "Interruptions and one harder question",
            "task": "Job interview",
            "pressure": "Interruptions, and one harder question.",
        },
    ],
}


def levels_for(age_group: str):
    try:
        return LEVELS[age_group]
    except KeyError as exc:
        raise ValueError("Age group is not set") from exc
