"""The three speaking situations from Table 3.3.

Age changes the task card. The hall then follows that task.
"""

LEVELS = {
    "under_18": [
        {
            "level": 1,
            "room": "Small calm group",
            "task": "A short class talk",
            "pressure": "One encouraging voice. The class only listens.",
        },
        {
            "level": 2,
            "room": "More listeners, up to two questions",
            "task": "Explain a school project",
            "pressure": "One person asks about the project. The others listen.",
        },
        {
            "level": 3,
            "room": "Interruptions and one harder question",
            "task": "Present to the class",
            "pressure": "The class listens, and the replies stay encouraging.",
        },
    ],
    "18_plus": [
        {
            "level": 1,
            "room": "Small calm group",
            "task": "A short presentation",
            "pressure": "One simple voice, and listeners behind.",
        },
        {
            "level": 2,
            "room": "More listeners, up to two questions",
            "task": "Graduation-project discussion",
            "pressure": "The committee questions the idea. No extra audience.",
        },
        {
            "level": 3,
            "room": "Interruptions and one harder question",
            "task": "Job interview",
            "pressure": "A smaller interview room, and an unexpected question.",
        },
    ],
}


def levels_for(age_group: str):
    try:
        return LEVELS[age_group]
    except KeyError as exc:
        raise ValueError("Age group is not set") from exc
