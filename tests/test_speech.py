import array
import math
import os
import tempfile
import unittest

from fastapi.testclient import TestClient

from server.main import create_app
from server.speech import (
    adapt_audience,
    choose_next_practice,
    features_from_whisper_json,
    measure_speech,
    render_api,
    transcribe_pcm,
)
from server.speech import _parse_judgement


def pcm_with_gap(sample_rate=16000):
    tone = array.array("h")
    gap = array.array("h")
    for index in range(sample_rate):
        tone.append(int(9000 * math.sin(2 * math.pi * 180 * index / sample_rate)))
    for _ in range(int(sample_rate * 0.9)):
        gap.append(0)
    return (tone + gap + tone).tobytes()


class SpeechRules(unittest.TestCase):
    def test_empty_transcript_is_not_scored(self):
        self.assertIsNone(measure_speech("  ", []))

    def test_fast_speech_asks_for_the_last_point(self):
        action = adapt_audience(
            {"pace": 210, "pauses": 0, "repeated": 0, "clarity": 0.9}, 2, 0
        )
        self.assertEqual(action["line"], "ممكن تعيد النقطة الأخيرة؟")

    def test_a_steady_level_lets_every_listener_speak(self):
        features = {"pace": 140, "pauses": 0, "repeated": 0, "clarity": 0.9}
        roles = [adapt_audience(features, 1, turn)["role"] for turn in range(4)]
        self.assertEqual(roles, ["interested", "uninterested", "curious", "skeptical"])
        later = [adapt_audience(features, 2, turn)["role"] for turn in range(6)]
        self.assertIn("interrupter", later)
        self.assertIn("supportive", later)

    def test_many_pauses_ask_the_user_to_continue(self):
        action = adapt_audience(
            {"pace": 130, "pauses": 4, "repeated": 0, "clarity": 0.8}, 1, 0
        )
        self.assertEqual(action["role"], "curious")
        self.assertIn("كمّل", action["line"])

    def test_next_practice_follows_the_weak_skill(self):
        pace = choose_next_practice(
            {"pace": 0.2, "pauses": 0.8, "clarity": 0.8, "organization": 0.8, "interruptions": 0.8, "confidence": 0.7},
            0.5,
        )
        clarity = choose_next_practice(
            {"pace": 0.9, "pauses": 0.9, "clarity": 0.2, "organization": 0.8, "interruptions": 0.8, "confidence": 0.6},
            None,
        )
        interruptions = choose_next_practice(
            {"pace": 0.9, "pauses": 0.9, "clarity": 0.9, "organization": 0.9, "interruptions": 0.1, "confidence": 0.55},
            0.4,
        )
        self.assertEqual(pace["next_level"], 1)
        self.assertEqual(clarity["next_level"], 2)
        self.assertEqual(interruptions["next_level"], 3)
        self.assertEqual(pace["change"], 20)

    def test_render_comment_follows_the_words_just_said(self):
        os.environ["RENDER"] = "true"
        os.environ["GROQ_API_KEY"] = "test-key"
        import server.speech as speech

        def fake(prompt, first_line_only):
            self.assertIn("المشروع يوفر الوقت", prompt)
            self.assertIn("لم تصلني الفكرة", prompt)
            return "ما الوقت الذي يوفره المشروع؟"

        original = speech._ask_groq
        speech._ask_groq = fake
        try:
            action = adapt_audience(
                {"pace": 140, "pauses": 0, "repeated": 0, "clarity": 0.9},
                1,
                1,
                "المشروع يوفر الوقت",
                ["لم تصلني الفكرة. أين النتيجة؟"],
            )
        finally:
            speech._ask_groq = original
            os.environ.pop("RENDER", None)
            os.environ.pop("GROQ_API_KEY", None)
        self.assertEqual(action["role"], "uninterested")
        self.assertEqual(action["line"], "ما الوقت الذي يوفره المشروع؟")

    def test_a_missing_transcript_keeps_the_fixed_line(self):
        os.environ["RENDER"] = "true"
        os.environ["GROQ_API_KEY"] = "test-key"
        import server.speech as speech

        def fail(prompt, first_line_only):
            raise AssertionError(prompt)

        original = speech._ask_groq
        speech._ask_groq = fail
        try:
            action = adapt_audience(
                {"pace": 56, "pauses": 2, "repeated": 0, "clarity": 0.47},
                1,
                0,
                "",
                [],
            )
        finally:
            speech._ask_groq = original
            os.environ.pop("RENDER", None)
            os.environ.pop("GROQ_API_KEY", None)
        self.assertEqual(action["role"], "skeptical")
        self.assertEqual(action["line"], "وضّح هذه النقطة بمثال واحد.")

    def test_whisper_words_keep_a_real_pause(self):
        features = features_from_whisper_json(
            {
                "text": "هذه فكرة واضحة",
                "words": [
                    {"word": "هذه", "start": 0.0, "end": 0.3},
                    {"word": "فكرة", "start": 0.4, "end": 0.7},
                    {"word": "واضحة", "start": 1.5, "end": 1.9},
                ],
            },
            "whisper-large-v3",
        )
        self.assertEqual(features["words"], 3)
        self.assertEqual(features["pauses"], 1)
        self.assertEqual(features["source"], "whisper-large-v3")
        self.assertIn("فكرة", features["transcript"])

    def test_the_project_computer_does_not_call_the_api(self):
        os.environ.pop("RENDER", None)
        os.environ["GROQ_API_KEY"] = "test-key"
        try:
            self.assertFalse(render_api())
            self.assertIsNone(transcribe_pcm(b"\x01\x00" * 8000, 16000))
        finally:
            os.environ.pop("GROQ_API_KEY", None)

    def test_render_sends_the_chunk_to_whisper_large(self):
        os.environ["RENDER"] = "true"
        os.environ["GROQ_API_KEY"] = "test-key"
        calls = {}

        class Response:
            status_code = 200

            def json(self):
                return {
                    "text": "فكرة",
                    "words": [{"word": "فكرة", "start": 0.0, "end": 0.4}],
                }

        def fake_post(url, **kwargs):
            calls["url"] = url
            calls["model"] = dict(kwargs["data"])["model"]
            return Response()

        import httpx

        original = httpx.post
        httpx.post = fake_post
        try:
            features = transcribe_pcm(b"\x01\x00" * 8000, 16000)
        finally:
            httpx.post = original
            os.environ.pop("RENDER", None)
            os.environ.pop("GROQ_API_KEY", None)
        self.assertEqual(features["source"], "whisper-large-v3")
        self.assertIn("audio/transcriptions", calls["url"])
        self.assertEqual(calls["model"], "whisper-large-v3")

    def test_judgement_reads_the_score_and_the_sentence(self):
        parsed = _parse_judgement("0.4\nرتّب الفكرة ثم المثال.")
        self.assertEqual(parsed["organization"], 0.4)
        self.assertIn("رتّب", parsed["feedback"])

    def test_a_silent_turn_is_not_scored_and_a_loud_turn_is(self):
        tmp = tempfile.NamedTemporaryFile(suffix=".sqlite")
        client = TestClient(create_app(tmp.name))
        token = client.post(
            "/api/register", json={"username": "Ohud", "password": "practice1"}
        ).json()["token"]
        headers = {"Authorization": "Bearer %s" % token}
        client.put(
            "/api/profile",
            headers=headers,
            json={
                "gender": "female",
                "age_group": "18_plus",
                "avatar": {"skin": "medium", "hair": "long", "outfit": "navy"},
                "mode": "normal",
            },
        )
        opened = client.post("/api/sessions", headers=headers, json={"level": 2})
        self.assertEqual(opened.status_code, 200, opened.text)
        session_id = opened.json()["session_id"]
        silent = client.post(
            "/api/sessions/%s/turn" % session_id,
            headers=dict(headers, **{"X-Sample-Rate": "16000"}),
            content=b"\x00\x00" * 16000,
        )
        self.assertTrue(silent.json()["empty"])
        spoken = client.post(
            "/api/sessions/%s/turn" % session_id,
            headers=dict(headers, **{"X-Sample-Rate": "16000"}),
            content=pcm_with_gap(),
        )
        self.assertFalse(spoken.json()["empty"])
        self.assertGreaterEqual(spoken.json()["pauses"], 1)
        finished = client.post("/api/sessions/%s/finish" % session_id, headers=headers)
        self.assertEqual(finished.json()["turns"], 1)
        self.assertIsNone(finished.json()["report"])
        tmp.close()
        os.environ.pop("SIM_DB", None)


if __name__ == "__main__":
    unittest.main()
