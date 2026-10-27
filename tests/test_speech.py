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
            calls["prompt"] = dict(kwargs["data"]).get("prompt")
            return Response()

        import httpx

        original = httpx.post
        httpx.post = fake_post
        try:
            features = transcribe_pcm(pcm_with_gap(), 16000)
        finally:
            httpx.post = original
            os.environ.pop("RENDER", None)
            os.environ.pop("GROQ_API_KEY", None)
        self.assertEqual(features["source"], "whisper-large-v3")
        self.assertIn("audio/transcriptions", calls["url"])
        self.assertEqual(calls["model"], "whisper-large-v3")
        self.assertIsNone(calls["prompt"])

    def test_saudi_speech_runs_only_on_render(self):
        from server.speech import speak_line

        self.assertIsNone(speak_line("وش موضوع عرضك؟", "interested"))
        os.environ["RENDER"] = "true"
        os.environ["GROQ_API_KEY"] = "test-key"
        calls = {}

        class Response:
            status_code = 200
            content = b"RIFF"

        def fake_post(url, **kwargs):
            calls["url"] = url
            calls["json"] = kwargs["json"]
            return Response()

        import httpx

        original = httpx.post
        httpx.post = fake_post
        try:
            audio = speak_line("وش موضوع عرضك؟", "skeptical")
            silent = speak_line("  ", "skeptical")
        finally:
            httpx.post = original
            os.environ.pop("RENDER", None)
            os.environ.pop("GROQ_API_KEY", None)
        self.assertEqual(audio, b"RIFF")
        self.assertIsNone(silent)
        self.assertIn("audio/speech", calls["url"])
        self.assertEqual(calls["json"]["model"], "canopylabs/orpheus-arabic-saudi")
        self.assertEqual(calls["json"]["voice"], "abdullah")

    def test_a_repeated_judge_line_is_spoken_once(self):
        from server.speech import clear_speech_cache, speak_line

        clear_speech_cache()
        os.environ["RENDER"] = "true"
        os.environ["GROQ_API_KEY"] = "test-key"
        posts = []

        class Response:
            status_code = 200
            content = b"RIFF-once"
            headers = {}

            def json(self):
                return {}

        def fake_post(url, **kwargs):
            posts.append(kwargs["json"]["input"])
            return Response()

        import httpx

        original = httpx.post
        httpx.post = fake_post
        try:
            first = speak_line("وش موضوع عرضك؟", "interested")
            second = speak_line("وش موضوع عرضك؟", "interested")
        finally:
            httpx.post = original
            clear_speech_cache()
            os.environ.pop("RENDER", None)
            os.environ.pop("GROQ_API_KEY", None)
        self.assertEqual(first, b"RIFF-once")
        self.assertEqual(second, b"RIFF-once")
        self.assertEqual(posts, ["وش موضوع عرضك؟"])

    def test_a_short_voice_limit_is_retried(self):
        from server.speech import clear_speech_cache, speak_line

        clear_speech_cache()
        os.environ["RENDER"] = "true"
        os.environ["GROQ_API_KEY"] = "test-key"
        calls = {"n": 0}

        class Response:
            def __init__(self, status, content):
                self.status_code = status
                self.content = content
                self.headers = {"retry-after": "0"}

            def json(self):
                return {"error": {"code": "rate_limit_exceeded", "message": "try again in 0s"}}

        def fake_post(url, **kwargs):
            calls["n"] += 1
            if calls["n"] == 1:
                return Response(429, b"")
            return Response(200, b"RIFF-retry")

        import httpx

        original = httpx.post
        httpx.post = fake_post
        try:
            audio = speak_line("كمّل.", "supportive")
        finally:
            httpx.post = original
            clear_speech_cache()
            os.environ.pop("RENDER", None)
            os.environ.pop("GROQ_API_KEY", None)
        self.assertEqual(audio, b"RIFF-retry")
        self.assertEqual(calls["n"], 2)

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

    def test_collapsed_word_times_cannot_report_an_extreme_pace(self):
        features = features_from_whisper_json(
            {
                "text": "واحد اثنين ثلاثة أربعة",
                "words": [
                    {"word": "واحد", "start": 0.0, "end": 0.01},
                    {"word": "اثنين", "start": 0.02, "end": 0.03},
                    {"word": "ثلاثة", "start": 0.04, "end": 0.05},
                    {"word": "أربعة", "start": 0.06, "end": 0.07},
                ],
            },
            "whisper-large-v3",
        )
        self.assertLess(features["pace"], 250)

    def test_the_committee_opens_the_discussion_and_the_interview(self):
        from server.speech import opening_for

        discussion = opening_for("Graduation-project discussion")
        interview = opening_for("Job interview")
        self.assertEqual(discussion["line"], "وش موضوع مشروع تخرجك؟")
        self.assertEqual(interview["line"], "وش الوظيفة اللي مقدم عليها؟")
        self.assertEqual(opening_for("A short presentation")["line"], "وش موضوع عرضك؟")
        self.assertIsNone(opening_for("Unknown task"))

    def test_level_three_asks_about_the_answer_and_waits(self):
        os.environ["RENDER"] = "true"
        os.environ["GROQ_API_KEY"] = "test-key"
        import server.speech as speech

        def fake(prompt, first_line_only):
            self.assertIn("أحد أعضاء اللجنة", prompt)
            self.assertIn("وظيفة محلل", prompt)
            return "ما الخبرة الأقرب إلى التحليل؟"

        original = speech._ask_groq
        speech._ask_groq = fake
        try:
            action = adapt_audience(
                {"pace": 140, "pauses": 0, "repeated": 0, "clarity": 0.9},
                3,
                0,
                "وظيفة محلل بيانات",
                [],
            )
        finally:
            speech._ask_groq = original
            os.environ.pop("RENDER", None)
            os.environ.pop("GROQ_API_KEY", None)
        self.assertEqual(action["line"], "ما الخبرة الأقرب إلى التحليل؟")
        self.assertEqual(action["reply_seconds"], 8)

    def test_a_pinned_topic_stays_in_the_next_question(self):
        os.environ["RENDER"] = "true"
        os.environ["GROQ_API_KEY"] = "test-key"
        import server.speech as speech

        def fake(prompt, first_line_only):
            self.assertIn("الموضوع المثبت على اللوحة", prompt)
            self.assertIn("الطاقة الشمسية", prompt)
            self.assertIn("أحد أعضاء اللجنة", prompt)
            self.assertIn("نبدأ بالتجربة", prompt)
            return "ما الذي ستقيسه في التجربة؟"

        original = speech._ask_groq
        speech._ask_groq = fake
        try:
            action = adapt_audience(
                {"pace": 140, "pauses": 0, "repeated": 0, "clarity": 0.9},
                3,
                1,
                "نبدأ بالتجربة",
                [],
                topic="الطاقة الشمسية",
            )
        finally:
            speech._ask_groq = original
            os.environ.pop("RENDER", None)
            os.environ.pop("GROQ_API_KEY", None)
        self.assertEqual(action["line"], "ما الذي ستقيسه في التجربة؟")

    def test_a_level_two_turn_without_words_still_asks_a_question(self):
        os.environ["RENDER"] = "true"
        os.environ["GROQ_API_KEY"] = "test-key"
        import server.speech as speech

        def fail(prompt, first_line_only):
            raise AssertionError(prompt)

        original = speech._ask_groq
        speech._ask_groq = fail
        try:
            action = adapt_audience(
                {"pace": 140, "pauses": 0, "repeated": 0, "clarity": 0.9},
                2,
                0,
                "",
                [],
            )
        finally:
            speech._ask_groq = original
            os.environ.pop("RENDER", None)
            os.environ.pop("GROQ_API_KEY", None)
        self.assertEqual(action["line"], "وش الخطوة الجاية في الشغل؟")
        self.assertEqual(action["role"], "curious")

    def test_the_same_judge_follows_the_answer_to_their_question(self):
        os.environ["RENDER"] = "true"
        os.environ["GROQ_API_KEY"] = "test-key"
        import server.speech as speech

        def fake(prompt, first_line_only):
            self.assertIn("ما الوظيفة التي تتقدم لها؟", prompt)
            self.assertIn("لست مقتنعاً", prompt)
            self.assertIn("محلل بيانات", prompt)
            return "لست مقتنعاً. ما أقرب خبرة لديك؟"

        original = speech._ask_groq
        speech._ask_groq = fake
        try:
            action = adapt_audience(
                {"pace": 140, "pauses": 0, "repeated": 0, "clarity": 0.9},
                3,
                1,
                "محلل بيانات",
                ["ما الوظيفة التي تتقدم لها؟"],
                [{"role": "skeptical", "line": "ما الوظيفة التي تتقدم لها؟"}],
            )
        finally:
            speech._ask_groq = original
            os.environ.pop("RENDER", None)
            os.environ.pop("GROQ_API_KEY", None)
        self.assertEqual(action["role"], "skeptical")
        self.assertIn("خبرة", action["line"])

    def test_the_opening_judge_hears_the_first_answer(self):
        os.environ["RENDER"] = "true"
        os.environ["GROQ_API_KEY"] = "test-key"
        import server.speech as speech

        def fake(prompt, first_line_only):
            self.assertIn("ما موضوع مشروع التخرج؟", prompt)
            return "ما الأداة التي استخدمتها؟"

        original = speech._ask_groq
        speech._ask_groq = fake
        try:
            action = adapt_audience(
                {"pace": 140, "pauses": 0, "repeated": 0, "clarity": 0.9},
                2,
                0,
                "نظام لإدارة المواعيد",
                [],
                None,
                {"role": "curious", "line": "ما موضوع مشروع التخرج؟"},
            )
        finally:
            speech._ask_groq = original
            os.environ.pop("RENDER", None)
            os.environ.pop("GROQ_API_KEY", None)
        self.assertEqual(action["role"], "curious")
        self.assertIn("الأداة", action["line"])

    def test_after_three_questions_another_judge_can_join(self):
        os.environ["RENDER"] = "true"
        os.environ["GROQ_API_KEY"] = "test-key"
        import server.speech as speech
        history = [
            {"role": "skeptical", "line": "وما الدليل الثالث؟"},
            {"role": "skeptical", "line": "وما الدليل الثاني؟"},
            {"role": "skeptical", "line": "ما الدليل؟"},
        ]

        def fake(prompt, first_line_only):
            self.assertIn("أحد أعضاء اللجنة", prompt)
            return "ما الخطوة التي بدأت بها؟"

        original = speech._ask_groq
        speech._ask_groq = fake
        try:
            action = adapt_audience(
                {"pace": 140, "pauses": 0, "repeated": 0, "clarity": 0.9},
                3,
                3,
                "ذكرت ثلاثة أمثلة من العمل",
                [item["line"] for item in history],
                history,
            )
        finally:
            speech._ask_groq = original
            os.environ.pop("RENDER", None)
            os.environ.pop("GROQ_API_KEY", None)
        self.assertNotEqual(action["role"], "skeptical")

    def test_an_accepted_answer_opens_the_floor_to_the_next_judge(self):
        os.environ["RENDER"] = "true"
        os.environ["GROQ_API_KEY"] = "test-key"
        import server.speech as speech

        def fake(prompt, first_line_only):
            return "لماذا يناسبك هذا العمل تحديداً؟"

        original = speech._ask_groq
        speech._ask_groq = fake
        try:
            action = adapt_audience(
                {"pace": 140, "pauses": 0, "repeated": 0, "clarity": 0.9},
                3,
                3,
                "عملت على تحليل البيانات لعامين",
                ["واضح، هذا يكفي الآن."],
                [{"role": "skeptical", "line": "واضح، هذا يكفي الآن."}],
            )
        finally:
            speech._ask_groq = original
            os.environ.pop("RENDER", None)
            os.environ.pop("GROQ_API_KEY", None)
        self.assertEqual(action["role"], "interrupter")

    def test_a_question_leans_in_and_praise_claps(self):
        from server.speech import mood_for

        self.assertEqual(mood_for("skeptical", "ما الدليل؟"), "lean")
        self.assertEqual(mood_for("interested", "واضح، كمّل."), "clap")
        self.assertEqual(mood_for("uninterested", "وين الخلاصة؟"), "aside")

    def test_silence_is_not_sent_to_the_transcript(self):
        os.environ["RENDER"] = "true"
        os.environ["GROQ_API_KEY"] = "test-key"

        def fail(url, **kwargs):
            raise AssertionError(url)

        import httpx

        original = httpx.post
        httpx.post = fail
        try:
            features = transcribe_pcm(b"\x00\x00" * 16000, 16000)
        finally:
            httpx.post = original
            os.environ.pop("RENDER", None)
            os.environ.pop("GROQ_API_KEY", None)
        self.assertTrue(features["empty"])

    def test_a_stock_phrase_on_silence_is_not_given_to_the_judges(self):
        features = features_from_whisper_json(
            {
                "text": "موضوع العرض هو الطاقة ترجمة نانا",
                "segments": [
                    {
                        "text": "موضوع العرض هو الطاقة",
                        "start": 0.0,
                        "end": 1.6,
                        "no_speech_prob": 0.04,
                        "avg_logprob": -0.3,
                        "words": [
                            {"word": "موضوع", "start": 0.0, "end": 0.3},
                            {"word": "العرض", "start": 0.3, "end": 0.7},
                            {"word": "هو", "start": 0.7, "end": 0.9},
                            {"word": "الطاقة", "start": 0.9, "end": 1.5},
                        ],
                    },
                    {
                        "text": "ترجمة نانا",
                        "start": 1.7,
                        "end": 2.4,
                        "no_speech_prob": 0.86,
                        "avg_logprob": -1.4,
                        "words": [
                            {"word": "ترجمة", "start": 1.7, "end": 2.0},
                            {"word": "نانا", "start": 2.0, "end": 2.4},
                        ],
                    },
                ],
            },
            "whisper-large-v3",
        )
        self.assertIn("الطاقة", features["transcript"])
        self.assertNotIn("نانا", features["transcript"])

    def test_younger_speakers_hear_encouragement(self):
        os.environ["RENDER"] = "true"
        os.environ["GROQ_API_KEY"] = "test-key"
        import server.speech as speech

        def fake(prompt, first_line_only):
            self.assertIn("تشجّعه", prompt)
            self.assertIn("لا تشكك", prompt)
            self.assertIn("مشروع العلوم", prompt)
            return "أحسنت، الفكرة واضحة. كمّل بمثال."

        original = speech._ask_groq
        speech._ask_groq = fake
        try:
            action = adapt_audience(
                {"pace": 140, "pauses": 0, "repeated": 0, "clarity": 0.9},
                2,
                0,
                "مشروع العلوم",
                [],
                age="under_18",
                task="Explain a school project",
            )
        finally:
            speech._ask_groq = original
            os.environ.pop("RENDER", None)
            os.environ.pop("GROQ_API_KEY", None)
        self.assertEqual(action["role"], "supportive")
        self.assertIn("أحسنت", action["line"])

    def test_the_graduation_committee_questions_the_idea(self):
        os.environ["RENDER"] = "true"
        os.environ["GROQ_API_KEY"] = "test-key"
        import server.speech as speech

        def fake(prompt, first_line_only):
            self.assertIn("التشكيك", prompt)
            self.assertIn("يدافع", prompt)
            self.assertIn("تطبيق جامعي", prompt)
            return "ليش هالفكرة بالذات؟ أقنعني."

        original = speech._ask_groq
        speech._ask_groq = fake
        try:
            action = adapt_audience(
                {"pace": 140, "pauses": 0, "repeated": 0, "clarity": 0.9},
                2,
                1,
                "تطبيق جامعي",
                [],
                age="18_plus",
                task="Graduation-project discussion",
            )
        finally:
            speech._ask_groq = original
            os.environ.pop("RENDER", None)
            os.environ.pop("GROQ_API_KEY", None)
        self.assertEqual(action["line"], "ليش هالفكرة بالذات؟ أقنعني.")

    def test_the_interview_asks_an_unexpected_question(self):
        os.environ["RENDER"] = "true"
        os.environ["GROQ_API_KEY"] = "test-key"
        import server.speech as speech

        def fake(prompt, first_line_only):
            self.assertIn("غير متوقع", prompt)
            self.assertIn("محلل بيانات", prompt)
            return "لو انقطع النظام أول يوم، وش بتسوي؟"

        original = speech._ask_groq
        speech._ask_groq = fake
        try:
            action = adapt_audience(
                {"pace": 140, "pauses": 0, "repeated": 0, "clarity": 0.9},
                3,
                1,
                "محلل بيانات",
                [],
                age="18_plus",
                task="Job interview",
            )
        finally:
            speech._ask_groq = original
            os.environ.pop("RENDER", None)
            os.environ.pop("GROQ_API_KEY", None)
        self.assertIn("انقطع", action["line"])

    def test_each_task_seats_its_own_committee(self):
        from server.speech import opening_for, seated_roles

        self.assertEqual(seated_roles("A short presentation"), ["interested"])
        self.assertEqual(seated_roles("A short class talk"), ["supportive"])
        self.assertEqual(seated_roles("Explain a school project"), ["supportive"])
        self.assertEqual(len(seated_roles("Graduation-project discussion")), 6)
        self.assertEqual(seated_roles("Job interview"), ["skeptical", "curious", "interrupter"])
        self.assertIsNone(seated_roles(""))
        young = opening_for("A short class talk", "under_18")
        self.assertEqual(young["role"], "supportive")
        self.assertIn("خذ راحتك", young["line"])

    def test_the_first_adult_level_stays_simple(self):
        os.environ["RENDER"] = "true"
        os.environ["GROQ_API_KEY"] = "test-key"
        import server.speech as speech

        def fake(prompt, first_line_only):
            self.assertIn("بسيط", prompt)
            self.assertIn("لا تشكك", prompt)
            self.assertIn("فكرة العرض", prompt)
            return "واضحة. كمّل النقطة الجاية."

        original = speech._ask_groq
        speech._ask_groq = fake
        try:
            action = adapt_audience(
                {"pace": 140, "pauses": 0, "repeated": 0, "clarity": 0.9},
                1,
                0,
                "فكرة العرض",
                [],
                age="18_plus",
                task="A short presentation",
            )
        finally:
            speech._ask_groq = original
            os.environ.pop("RENDER", None)
            os.environ.pop("GROQ_API_KEY", None)
        self.assertEqual(action["role"], "interested")
        self.assertIn("واضحة", action["line"])


if __name__ == "__main__":
    unittest.main()
