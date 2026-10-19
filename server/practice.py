"""One speaking level: start, take a turn, finish, and write the report."""

from server.db import connect
from server.levels import levels_for
from server.speech import (
    adapt_audience,
    choose_next_practice,
    features_from_pcm,
    measure_speech,
)


def _level_card(user, level):
    cards = levels_for(user["age_group"])
    for card in cards:
        if card["level"] == level:
            return card
    return None


def start_session(path, user, level):
    if not user["complete"]:
        return None, "Finish the setup before entering a level."
    card = _level_card(user, level)
    if card is None:
        return None, "That level is not in this account."
    with connect(path) as conn:
        cur = conn.execute(
            """
            INSERT INTO sessions (account_id, level, mode)
            VALUES (?, ?, ?)
            """,
            (user["id"], level, user["mode"]),
        )
        session_id = cur.lastrowid
    return {
        "session_id": session_id,
        "level": card,
        "mode": user["mode"],
        "avatar": user["avatar"],
    }, None


def _owned(conn, session_id, account_id):
    return conn.execute(
        "SELECT * FROM sessions WHERE id = ? AND account_id = ?",
        (session_id, account_id),
    ).fetchone()


def take_turn(path, user, session_id, pcm, sample_rate):
    with connect(path) as conn:
        session = _owned(conn, session_id, user["id"])
        if session is None:
            return None, "This session is not open."
        if session["finished_at"]:
            return None, "This level is already finished."
        asked = conn.execute(
            "SELECT COUNT(*) AS n FROM turns WHERE session_id = ? AND scored = 1",
            (session_id,),
        ).fetchone()["n"]
    features = features_from_pcm(pcm, sample_rate)
    whisper = _try_whisper(pcm, sample_rate)
    if whisper is not None:
        features = whisper
    if features is None:
        return {
            "empty": True,
            "line": "لم يُلتقط كلام. تحدّث مرة أخرى. هذه اللقطة لا تُحسب.",
            "role": None,
        }, None
    action = adapt_audience(features, session["level"], asked)
    with connect(path) as conn:
        conn.execute(
            """
            INSERT INTO turns (
                session_id, transcript, pace, pauses, repeated, clarity,
                stress, confidence, scored, role, line
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
            """,
            (
                session_id,
                "",
                features["pace"],
                features["pauses"],
                features["repeated"],
                features["clarity"],
                action["stress"],
                action["confidence"],
                action["role"],
                action["line"],
            ),
        )
    action["empty"] = False
    action["pace"] = features["pace"]
    action["pauses"] = features["pauses"]
    action["clarity"] = features["clarity"]
    action["source"] = features["source"]
    return action, None


def _try_whisper(pcm, sample_rate):
    try:
        from faster_whisper import WhisperModel
    except Exception:
        return None
    # The model is optional. A missing install must not break the room.
    try:
        import io
        import wave

        model = getattr(_try_whisper, "model", None)
        if model is None:
            model = WhisperModel("medium", device="cpu", compute_type="int8")
            _try_whisper.model = model
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as handle:
            handle.setnchannels(1)
            handle.setsampwidth(2)
            handle.setframerate(sample_rate)
            handle.writeframes(pcm)
        buffer.seek(0)
        segments, _info = model.transcribe(buffer, word_timestamps=True)
        words = []
        timings = []
        for segment in segments:
            for word in segment.words or []:
                text = word.word.strip()
                if not text:
                    continue
                words.append(text)
                timings.append({"start": word.start, "end": word.end})
        return measure_speech(" ".join(words), timings)
    except Exception:
        return None


def _skill_scores(rows):
    if not rows:
        return {
            "pace": 0.0,
            "pauses": 0.0,
            "clarity": 0.0,
            "organization": 0.0,
            "interruptions": 0.0,
            "confidence": 0.0,
        }
    pace_values = []
    for row in rows:
        gap = min(abs((row["pace"] or 0) - 140.0) / 140.0, 1.0)
        pace_values.append(1.0 - gap)
    pauses = [max(0.0, 1.0 - min((row["pauses"] or 0) / 6.0, 1.0)) for row in rows]
    clarity = [row["clarity"] or 0 for row in rows]
    organization = [
        max(0.0, (row["clarity"] or 0) - min((row["repeated"] or 0) / 5.0, 0.5))
        for row in rows
    ]
    interruptions = []
    for row in rows:
        if row["role"] in ("interrupter", "skeptical"):
            interruptions.append(row["confidence"] or 0)
    if not interruptions:
        interruptions = [row["confidence"] or 0 for row in rows]
    confidence = [row["confidence"] or 0 for row in rows]

    def avg(values):
        return sum(values) / float(len(values))

    return {
        "pace": avg(pace_values),
        "pauses": avg(pauses),
        "clarity": avg(clarity),
        "organization": avg(organization),
        "interruptions": avg(interruptions),
        "confidence": avg(confidence),
    }


def finish_session(path, user, session_id):
    with connect(path) as conn:
        session = _owned(conn, session_id, user["id"])
        if session is None:
            return None, "This session is not open."
        rows = conn.execute(
            "SELECT * FROM turns WHERE session_id = ? AND scored = 1",
            (session_id,),
        ).fetchall()
        scores = _skill_scores(rows)
        previous = conn.execute(
            """
            SELECT confidence FROM sessions
            WHERE account_id = ? AND finished_at IS NOT NULL AND id != ?
            ORDER BY id DESC LIMIT 1
            """,
            (user["id"], session_id),
        ).fetchone()
        report = None
        weak = None
        next_level = None
        if session["level"] == 3 and rows:
            previous_confidence = previous["confidence"] if previous else None
            report = choose_next_practice(scores, previous_confidence)
            weak = report["weak"]
            next_level = report["next_level"]
        conn.execute(
            """
            UPDATE sessions
            SET pace = ?, pauses = ?, clarity = ?, organization = ?,
                confidence = ?, stress = ?, weak_skill = ?, next_level = ?,
                finished_at = datetime('now')
            WHERE id = ?
            """,
            (
                scores["pace"],
                scores["pauses"],
                scores["clarity"],
                scores["organization"],
                scores["confidence"],
                1 - scores["confidence"],
                weak,
                next_level,
                session_id,
            ),
        )
    card = _level_card(user, session["level"])
    return {
        "level": session["level"],
        "task": card["task"] if card else "",
        "turns": len(rows),
        "confidence": round(scores["confidence"] * 100),
        "pace": round(scores["pace"] * 100),
        "pauses": round(scores["pauses"] * 100),
        "clarity": round(scores["clarity"] * 100),
        "organization": round(scores["organization"] * 100),
        "report": report,
    }, None
