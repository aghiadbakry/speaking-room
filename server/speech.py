"""The three contribution algorithms from Chapter 3.

measureSpeech, adaptAudience, and chooseNextPractice. On the project computer
these use faster-whisper (Whisper medium) and Ollama with Qwen2.5 7B. The
published Render service is the only host that calls the stronger open models
through Groq's API: Whisper large-v3 for the transcript and word timings, and
Qwen3.8 27B for the harder question, the organization judgement, and the short
feedback. That path runs only when Render sets RENDER=true and GROQ_API_KEY.
"""

import array
import io
import json
import math
import os
import re
import urllib.request
import wave

FILLERS = {"uh", "um", "يعني", "اا", "اه", "ام"}

QUESTIONS = {
    1: ["ما الفكرة التي تريد أن يفهمها المستمع؟"],
    2: ["ما الخطوة التالية في هذا الموضوع؟", "لماذا اخترت هذا المثال؟"],
    3: ["ما الدليل على هذه النقطة؟", "ماذا ستفعل إذا اعترض أحد المستمعين؟"],
}

# The same order as the seats in the room. A level only seats the first `count` of these.
SEAT_ORDER = [
    "interested",
    "uninterested",
    "curious",
    "skeptical",
    "interrupter",
    "supportive",
]
SEAT_COUNT = {1: 4, 2: 6, 3: 6}
PERSONALITY = {
    "interested": [
        "هذه النقطة واضحة. واصل.",
        "أنا أتابع معك. أكمل.",
    ],
    "uninterested": [
        "اختصر من فضلك. ما الخلاصة؟",
        "لم تصلني الفكرة. أين النتيجة؟",
    ],
    "curious": [
        "وضّح لي أكثر. ما الذي تقصده؟",
        "وبعد ذلك، ماذا حدث؟",
    ],
    "skeptical": [
        "ما الدليل على هذه النقطة؟",
        "هل هذا المثال يكفي؟",
    ],
    "interrupter": [
        "لحظة. اشرح هذه الجملة الآن.",
    ],
    "supportive": [
        "واضح حتى الآن. أكمل بهدوء.",
        "أداء جيد. حافظ على هذه السرعة.",
    ],
}


def present_roles(level):
    count = SEAT_COUNT.get(int(level), 4)
    found = []
    for index in range(count):
        role = SEAT_ORDER[index % len(SEAT_ORDER)]
        if role not in found:
            found.append(role)
    return found


def resolve_role(role, level):
    """A level-1 room has no interrupter and no supportive seat."""
    present = present_roles(level)
    if role in present:
        return role
    fallback = {"supportive": "interested", "interrupter": "curious"}.get(role)
    if fallback in present:
        return fallback
    return present[0]


def measure_speech(transcript, timings):
    """Chapter 3 measureSpeech. Empty speech returns None and is not scored."""
    text = (transcript or "").strip()
    if not text:
        return None
    words = text.split()
    if not words:
        return None
    if timings:
        span = max(float(timings[-1]["end"]) - float(timings[0]["start"]), len(words) * 0.32, 0.4)
    else:
        span = max(len(words) * 0.45, 0.1)
    minutes = span / 60.0
    pace = len(words) / minutes
    pauses = 0
    if timings and len(timings) > 1:
        for left, right in zip(timings, timings[1:]):
            if float(right["start"]) - float(left["end"]) > 0.6:
                pauses += 1
    repeated = 0
    recent = []
    for word in words:
        key = word.lower()
        if key in recent:
            repeated += 1
        recent.append(key)
        if len(recent) > 6:
            recent.pop(0)
    clear = 0
    for word in words:
        if word.lower() not in FILLERS:
            clear += 1
    clarity = clear / float(len(words))
    return {
        "pace": round(pace, 1),
        "pauses": pauses,
        "repeated": repeated,
        "clarity": round(clarity, 2),
        "words": len(words),
        "source": "faster-whisper" if timings else "transcript",
    }


def features_from_pcm(pcm, sample_rate):
    """Live bars from the recording when the speech model is not installed."""
    samples = array.array("h")
    usable = pcm[: len(pcm) - (len(pcm) % 2)]
    if len(usable) < 2:
        return None
    samples.frombytes(usable)
    if len(samples) < int(sample_rate * 0.4):
        return None
    frame = max(int(sample_rate * 0.03), 1)
    flags = []
    for start in range(0, len(samples) - frame, frame):
        chunk = samples[start : start + frame]
        energy = math.sqrt(sum(sample * sample for sample in chunk) / float(len(chunk)))
        flags.append(energy > 700)
    if sum(flags) < 4:
        return None
    frame_sec = frame / float(sample_rate)
    first = next(index for index, spoken in enumerate(flags) if spoken)
    last = len(flags) - 1 - next(index for index, spoken in enumerate(reversed(flags)) if spoken)
    span = flags[first : last + 1]
    span_energy = []
    for start in range(0, len(samples) - frame, frame):
        chunk = samples[start : start + frame]
        span_energy.append(math.sqrt(sum(sample * sample for sample in chunk) / float(len(chunk))))
    span_energy = span_energy[first : last + 1]
    pauses = 0
    silent = 0
    for spoken in span:
        if spoken:
            if silent * frame_sec > 0.6:
                pauses += 1
            silent = 0
        else:
            silent += 1
    loud_seconds = sum(span) * frame_sec
    span_seconds = max(len(span) * frame_sec, 0.4)
    peaks = _word_peaks(span_energy, frame_sec)
    words = peaks if peaks >= 2 else max(1, int(round(loud_seconds * 2.2)))
    pace = words / (span_seconds / 60.0)
    clarity = sum(span) / float(len(span))
    # Without a transcript, short gaps between words are not unclear speech.
    if pauses <= 1 and 80 <= pace <= 180:
        clarity = max(clarity, 0.82)
    return {
        "pace": round(pace, 1),
        "pauses": pauses,
        "repeated": 0,
        "clarity": round(clarity, 2),
        "words": words,
        "source": "recording",
    }


def _word_peaks(energies, frame_sec):
    """Count loud peaks at least 0.28s apart, so a normal pace stays near 140."""
    if len(energies) < 3:
        return 0
    level = max(700, max(energies) * 0.45)
    gap = max(1, int(0.28 / frame_sec))
    peaks = 0
    last = -gap
    for index in range(1, len(energies) - 1):
        current = energies[index]
        if current < level:
            continue
        if current < energies[index - 1] or current <= energies[index + 1]:
            continue
        if index - last < gap:
            continue
        peaks += 1
        last = index
    return peaks


def estimate(features):
    pace_gap = min(abs(features["pace"] - 140.0) / 140.0, 1.0)
    pause_gap = min(features["pauses"] / 6.0, 1.0)
    clarity = features["clarity"]
    stress = (0.4 * pause_gap) + (0.35 * pace_gap) + (0.25 * (1.0 - clarity))
    stress = max(0.0, min(1.0, stress))
    confidence = max(0.0, min(1.0, 1.0 - (0.65 * stress) - (0.2 * pause_gap)))
    return round(stress, 2), round(confidence, 2)


def render_api():
    """The API is the Render host only. The project computer stays on Chapter 3."""
    on_render = os.environ.get("RENDER", "").strip().lower() == "true"
    return on_render and bool(os.environ.get("GROQ_API_KEY", "").strip())


def _wav_bytes(pcm, sample_rate):
    usable = pcm[: len(pcm) - (len(pcm) % 2)]
    if len(usable) < 2:
        return None
    buffer = io.BytesIO()
    with wave.open(buffer, "wb") as handle:
        handle.setnchannels(1)
        handle.setsampwidth(2)
        handle.setframerate(int(sample_rate))
        handle.writeframes(usable)
    return buffer.getvalue()


def _folded(text):
    folded = (text or "").strip()
    for src, dst in (("أ", "ا"), ("إ", "ا"), ("آ", "ا"), ("ة", "ه"), ("ى", "ي")):
        folded = folded.replace(src, dst)
    return re.sub(r"[\s\.،,!\-]+", " ", folded).strip()


def _hallucinated(text):
    """Whisper writes these on silence. They are not the speaker."""
    folded = _folded(text)
    if not folded:
        return True
    stock = (
        "ترجمه نانا",
        "ترجمه نانسي",
        "نانسي قنقر",
        "شكرا للمشاهده",
        "شكرا لكم على المشاهده",
        "اشتركوا في القناه",
        "اشترك في القناه",
        "لا تنسوا الاشتراك",
        "لا تنسى الاشتراك",
        "الترجمه بواسطة",
    )
    return any(phrase in folded for phrase in stock)


def _segment_kept(segment):
    if not isinstance(segment, dict):
        return False
    if _hallucinated(segment.get("text") or ""):
        return False
    if float(segment.get("no_speech_prob") or 0) >= 0.55:
        return False
    if segment.get("avg_logprob") is not None and float(segment["avg_logprob"]) <= -1.05:
        return False
    if float(segment.get("compression_ratio") or 0) >= 2.4:
        return False
    return True


def _word_in_segment(word, segment):
    if "start" not in word or "end" not in word:
        return True
    if "start" not in segment or "end" not in segment:
        return True
    middle = (float(word["start"]) + float(word["end"])) / 2.0
    return float(segment["start"]) - 0.05 <= middle <= float(segment["end"]) + 0.05


def features_from_whisper_json(payload, source):
    """Turn a Whisper verbose_json payload into the Chapter 3 measures."""
    if not isinstance(payload, dict):
        return None
    segments = [segment for segment in (payload.get("segments") or []) if isinstance(segment, dict)]
    kept = [segment for segment in segments if _segment_kept(segment)]
    raw_words = list(payload.get("words") or [])
    if segments:
        if not kept:
            return {"empty": True}
        scoped = []
        for word in raw_words:
            if any(_word_in_segment(word, segment) for segment in kept):
                scoped.append(word)
        raw_words = scoped or [
            word for segment in kept for word in (segment.get("words") or [])
        ]
    elif not raw_words:
        raw_words = []
    words = []
    timings = []
    for item in raw_words:
        text = (item.get("word") or "").strip()
        if not text:
            continue
        words.append(text)
        if "start" in item and "end" in item:
            timings.append({"start": item["start"], "end": item["end"]})
    transcript = " ".join(words).strip() or " ".join(
        (segment.get("text") or "").strip() for segment in kept
    ).strip()
    if not segments:
        transcript = transcript or (payload.get("text") or "").strip()
    if _hallucinated(transcript):
        return {"empty": True}
    complete = len(timings) == len(words) and len(timings) > 0
    features = measure_speech(transcript, timings if complete else None)
    if features is None:
        return {"empty": True}
    features["transcript"] = transcript
    features["source"] = source
    return features


def _post_json(url, key, payload, timeout):
    try:
        import httpx
    except Exception:
        return None
    try:
        response = httpx.post(
            url,
            headers={
                "Authorization": "Bearer %s" % key,
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=timeout,
        )
    except Exception:
        return None
    if response.status_code >= 400:
        return None
    try:
        return response.json()
    except Exception:
        return None


def _chat(key, model, prompt):
    payload = _post_json(
        "https://api.groq.com/openai/v1/chat/completions",
        key,
        {
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": "أجب بالعربية فقط. لا تكتب مقدمة ولا تفكيرًا ظاهرًا.",
                },
                {"role": "user", "content": prompt},
            ],
            "max_tokens": 180,
            "temperature": 0.3,
            "reasoning_effort": "none",
        },
        8,
    )
    if not payload:
        return ""
    choices = payload.get("choices") or []
    if not choices:
        return ""
    message = choices[0].get("message") or {}
    return (message.get("content") or "").strip()


def _ask_groq(prompt, first_line_only):
    if not render_api():
        return ""
    key = os.environ.get("GROQ_API_KEY", "").strip()
    primary = os.environ.get("LANGUAGE_MODEL", "qwen/qwen3.8-27b")
    fallback = os.environ.get("LANGUAGE_MODEL_FALLBACK", "openai/gpt-oss-120b")
    text = _chat(key, primary, prompt)
    if not text and fallback and fallback != primary:
        text = _chat(key, fallback, prompt)
    text = text.strip().strip('"').strip("«»")
    if not text:
        return ""
    if first_line_only:
        return text.split("\n")[0].strip()[:180]
    return text[:800]


def speak_line(text, role):
    """Saudi speech for one judge line. Local Chapter 3 stays silent."""
    speak_line.last_status = 0
    speak_line.last_reason = ""
    if not render_api():
        return None
    line = (text or "").strip()
    if not line:
        return None
    key = os.environ.get("GROQ_API_KEY", "").strip()
    voice = VOICES.get(role or "", "abdullah")
    try:
        import httpx

        response = httpx.post(
            "https://api.groq.com/openai/v1/audio/speech",
            headers={"Authorization": "Bearer %s" % key},
            json={
                "model": "canopylabs/orpheus-arabic-saudi",
                "input": line[:200],
                "voice": voice,
                "response_format": "wav",
            },
            timeout=12,
        )
    except Exception:
        speak_line.last_status = 0
        return None
    speak_line.last_status = response.status_code
    speak_line.last_reason = ""
    if response.status_code != 200 or not response.content:
        try:
            err = (response.json() or {}).get("error") or {}
            speak_line.last_reason = str(err.get("code") or err.get("type") or "")[:40]
        except Exception:
            speak_line.last_reason = ""
        return None
    return response.content


def _qwen(prompt):
    if os.environ.get("RENDER", "").strip().lower() == "true":
        return _ask_groq(prompt, first_line_only=True)
    body = json.dumps(
        {"model": "qwen2.5:7b", "prompt": prompt, "stream": False}
    ).encode("utf-8")
    request = urllib.request.Request(
        "http://127.0.0.1:11434/api/generate",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=4) as response:
            payload = json.loads(response.read().decode("utf-8"))
        text = (payload.get("response") or "").strip()
        return text.split("\n")[0][:180]
    except Exception:
        return ""


def _spoken_pcm(pcm, sample_rate):
    """Drop the quiet edges. Silence is where the transcript goes wrong."""
    samples = array.array("h")
    usable = pcm[: len(pcm) - (len(pcm) % 2)]
    if len(usable) < 2:
        return None
    samples.frombytes(usable)
    frame = max(int(sample_rate * 0.03), 1)
    flags = []
    for start in range(0, len(samples) - frame, frame):
        chunk = samples[start : start + frame]
        energy = math.sqrt(sum(sample * sample for sample in chunk) / float(len(chunk)))
        flags.append(energy > 700)
    if sum(flags) < 4:
        return None
    first = next(index for index, spoken in enumerate(flags) if spoken)
    last = len(flags) - 1 - next(index for index, spoken in enumerate(reversed(flags)) if spoken)
    first = max(0, first - 2)
    last = min(len(flags) - 1, last + 2)
    start = first * frame
    end = min(len(samples), (last + 1) * frame)
    trimmed = samples[start:end]
    if len(trimmed) < int(sample_rate * 0.4):
        return None
    return trimmed.tobytes()


def transcribe_pcm(pcm, sample_rate, context=""):
    """Whisper large-v3 through Groq. None means this host is not using the API."""
    if not render_api() or not pcm:
        return None
    spoken = _spoken_pcm(pcm, sample_rate)
    if spoken is None:
        return {"empty": True}
    wav = _wav_bytes(spoken, sample_rate)
    if wav is None:
        return None
    model = os.environ.get("SPEECH_MODEL", "whisper-large-v3")
    key = os.environ.get("GROQ_API_KEY", "").strip()
    try:
        import httpx
    except Exception:
        return None
    data = {
        "model": model,
        "language": "ar",
        "response_format": "verbose_json",
        "temperature": "0",
        "timestamp_granularities[]": "word",
    }
    prior = (context or "").strip()
    if prior and not _hallucinated(prior):
        data["prompt"] = prior[-180:]
    try:
        response = httpx.post(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            headers={"Authorization": "Bearer %s" % key},
            files={"file": ("speech.wav", wav, "audio/wav")},
            data=data,
            timeout=18,
        )
    except Exception:
        return None
    if response.status_code >= 400:
        return None
    try:
        payload = response.json()
    except Exception:
        return None
    return features_from_whisper_json(payload, model)


def _parse_judgement(text):
    lines = [line.strip(" -*") for line in (text or "").splitlines() if line.strip()]
    if not lines:
        return None
    match = re.search(r"\b(0(?:\.\d+)?|1(?:\.0+)?)\b", lines[0])
    if match is None and len(lines) > 1:
        match = re.search(r"\b(0(?:\.\d+)?|1(?:\.0+)?)\b", lines[1])
        sentence = lines[0]
    else:
        sentence = lines[1] if len(lines) > 1 else ""
    if match is None:
        return None
    score = max(0.0, min(1.0, float(match.group(1))))
    return {"organization": round(score, 2), "feedback": sentence[:180]}


def judge_session(transcript):
    """One language-model call at the end of a level, and only on Render."""
    text = (transcript or "").strip()
    if not text or not render_api():
        return None
    raw = _ask_groq(
        "اقرأ نص متحدث يتدرب على الخطابة.\n"
        "أجب بسطرين فقط.\n"
        "السطر الأول رقم من 0 إلى 1 يقيس ترتيب الأفكار.\n"
        "السطر الثاني نصيحة عربية واحدة قصيرة.\n"
        "النص:\n%s" % text[:1800],
        first_line_only=False,
    )
    if not raw:
        return None
    return _parse_judgement(raw)


def opening_for(task):
    """Each task starts with one question, then the speaker answers."""
    table = {
        "A short class talk": ("interested", "وش موضوع حديثك؟"),
        "A short presentation": ("interested", "وش موضوع عرضك؟"),
        "Explain a school project": ("curious", "وش المشروع اللي بتشرحه؟"),
        "Graduation-project discussion": ("curious", "وش موضوع مشروع تخرجك؟"),
        "Present to the class": ("interested", "وش موضوع عرضك قدام الفصل؟"),
        "Job interview": ("skeptical", "وش الوظيفة اللي مقدم عليها؟"),
    }
    found = table.get(task)
    if not found:
        return None
    return {"role": found[0], "line": found[1], "mood": mood_for(found[0], found[1])}


FOLLOW_UP = {
    2: ["وش الخطوة الجاية في الشغل؟", "وش الصعوبة اللي واجهتها؟"],
    3: ["ليش الشغل هذا يناسبك؟", "وش أقرب خبرة عندك؟"],
}

VOICES = {
    "interested": "noura",
    "uninterested": "sultan",
    "curious": "aisha",
    "skeptical": "abdullah",
    "interrupter": "fahad",
    "supportive": "lulwa",
    "crowd": "noura",
}


def _topic_clause(topic):
    """The subject named at the start stays on the board for the rest of the round."""
    text = (topic or "").strip().replace("%", "")
    if not text:
        return ""
    return "الموضوع المثبت على اللوحة: «%s». ابقَ على هذا الموضوع.\n" % text[:80]


def _audience_line(role, transcript, intent, recent, features, level=1, waiting=None, topic=""):
    """On Render, one new sentence about what was just said. Local stays on the fixed line."""
    if not render_api():
        return ""
    heard = (transcript or "").strip()
    if not heard:
        return ""

    def ask(prompt):
        dialect = (
            "اكتب الجملة بلهجة سعودية بيضاء، مثل كلام الرياض: وش، تبي، هذي، خلاص. "
            "لا فصحى رسمية ولا لهجة بلد آخر.\n"
        )
        return _ask_groq(_topic_clause(topic) + dialect + prompt, first_line_only=True)
    voices = {
        "interested": "مستمع مهتم. إذا كانت الجملة واضحة، سمِّ الفكرة وقل إنها واضحة ثم اطلب النقطة التالية.",
        "uninterested": "مستمع يريد خلاصة الفكرة التي قيلت، باسمها.",
        "curious": "مستمع يسأل عن تفصيل من الجملة التي قيلت.",
        "skeptical": "مستمع يسأل عن دليل على شيء قيل في الجملة نفسها.",
        "interrupter": "مستمع يقاطع بسؤال عن الجملة التي قيلت.",
        "supportive": "مستمع يشجع الفكرة التي قيلت ويطلب إكمالها.",
    }
    previous = " | ".join(recent[:4]) if recent else "لا يوجد"
    if waiting and int(level) < 2:
        return ask(
            "أنت المستمع الذي سأل عن موضوع العرض.\n"
            "سؤالك: «%s»\n"
            "جوابه: «%s»\n"
            "إذا فهمت الموضوع، سمِّه بجملة دافئة واطلب أن يبدأ العرض، بلا سؤال جديد.\n"
            "إذا لم تفهم الموضوع، اسأل مرة واحدة بلطف: ما الموضوع؟\n"
            "إذا كانت الكلمات غير مفهومة، اطلب إعادة الجملة ولا تقتبسها.\n"
            "لا تكرر: %s"
            % ((waiting.get("line") or "")[:300], heard[:700], previous)
        )
    if waiting:
        return ask(
            "أنت نفس العضو الذي سأل، وتكمل الحديث معه أنت وحدك.\n"
            "سؤالك السابق: «%s»\n"
            "جوابه الآن: «%s»\n"
            "إذا بقي الشك أو الجواب ناقص، قل «لست مقتنعاً» أو اطلب التفصيل، واختم بسؤال واحد.\n"
            "إذا الجواب يكفي، اقبله بجملة قصيرة دافئة بلا سؤال.\n"
            "اجعل الجملة خفيفة كحوار لعبة، بلا نبرة امتحان.\n"
            "إذا كانت الكلمات غير مفهومة، اطلب إعادة الجملة ولا تقتبسها.\n"
            "لا تسلم الدور لشخص آخر، ولا تكرر: %s"
            % ((waiting.get("line") or "")[:300], heard[:700], previous)
        )
    if int(level) >= 2:
        return ask(
            "أنت أحد أعضاء اللجنة، وأنت من يسأل.\n"
            "جواب المتحدث: «%s»\n"
            "اسأل سؤالاً واحداً قصيراً ودافئاً عن هذا الجواب فقط.\n"
            "في مناقشة المشروع اسأل عن المشروع. في المقابلة اسأل عن الوظيفة والعمل.\n"
            "يمكنك أن تبدي شكاً إذا لزم الأمر.\n"
            "إذا كانت الكلمات غير مفهومة، اطلب إعادة الجملة ولا تقتبسها.\n"
            "لا تكرر: %s"
            % (heard[:700], previous)
        )
    return ask(
        "أنت تستمع إلى المتحدث الآن.\n"
        "قال حرفياً: «%s»\n"
        "شخصيتك: %s\n"
        "اكتب جملة عربية واحدة دافئة، كتعليق في لعبة. اذكر شيئاً قاله ثم رد عليه.\n"
        "إذا كانت فكرته واضحة، قل إنها واضحة بلطف واطلب الفكرة التالية.\n"
        "إذا كانت الكلمات غير مفهومة، اطلب إعادة الجملة ولا تقتبسها.\n"
        "ممنوع استخدام جملة عامة لا علاقة لها بكلامه.\n"
        "لا تكرر: %s"
        % (heard[:700], voices.get(role, role), previous)
    )


def mood_for(role, line):
    """A short body reaction so the listener feels present in the round."""
    if _is_question(line):
        if role == "uninterested":
            return "aside"
        if role in ("skeptical", "curious", "interrupter"):
            return "lean"
        return "nod"
    if role in ("interested", "supportive"):
        return "clap"
    if role == "uninterested":
        return "aside"
    return "nod"


def _is_question(line):
    text = line or ""
    return "؟" in text or "?" in text


def _waiting_judge(level, history, opening, asked):
    """The judge who asked last keeps the exchange, for up to three questions."""
    if not render_api():
        return None
    if history:
        last = history[0]
        if not _is_question(last.get("line")):
            return None
        streak = 0
        for item in history:
            if item.get("role") != last.get("role") or not _is_question(item.get("line")):
                break
            streak += 1
        if streak >= 3:
            return None
        return {"role": last.get("role"), "line": last.get("line"), "streak": streak}
    if opening and int(asked) == 0:
        return {
            "role": resolve_role(opening["role"], level),
            "line": opening["line"],
            "streak": 1,
        }
    return None


def _hand_off(result, level, history, waiting):
    """A finished exchange moves to another seated listener."""
    if waiting or not history or not render_api():
        return
    last = history[0].get("role")
    present = present_roles(level)
    if not last or last not in present or result["role"] != last:
        return
    result["role"] = present[(present.index(last) + 1) % len(present)]


def _usable_line(text, recent):
    line = (text or "").strip()
    if not line or line in recent:
        return ""
    if len(line) > 140 or "دقيقة" in line or "كلمة في" in line:
        return ""
    return line


def adapt_audience(features, level, asked, transcript="", recent=None, history=None, opening=None, topic=""):
    """Chapter 3 chooses the listener. Render then writes a line about the speech."""
    result = _adapt_rules(features, level, asked)
    recent = recent or []
    history = history or []
    waiting = _waiting_judge(level, history, opening, asked)
    if waiting:
        result["role"] = resolve_role(waiting["role"], level)
    else:
        _hand_off(result, level, history, waiting)
    spoken = _usable_line(
        _audience_line(
            result["role"], transcript, result["line"], recent, features, level, waiting, topic
        ),
        recent,
    )
    if spoken:
        result["line"] = spoken
    elif waiting and render_api():
        result["role"] = resolve_role(waiting["role"], level)
        result["line"] = "لسه عندي سؤال. وضّحها بمثال بسيط؟"
    elif int(level) >= 2 and render_api():
        bank = FOLLOW_UP[int(level)]
        choice = bank[int(asked) % len(bank)]
        if choice not in recent:
            result["line"] = choice
            result["role"] = resolve_role("curious" if int(level) == 2 else "skeptical", level)
    elif result["line"] in recent:
        choices = PERSONALITY.get(result["role"], [])
        for choice in choices:
            if choice not in recent:
                result["line"] = choice
                break
    result["reply_seconds"] = 8 if int(level) >= 2 else 6
    result["mood"] = mood_for(result["role"], result["line"])
    return result


def _adapt_rules(features, level, asked):
    """Chapter 3 adaptAudience. The caller already rejected an empty turn."""
    stress, confidence = estimate(features)
    level = max(1, min(3, int(level)))
    bank = QUESTIONS[level]
    if stress >= 0.62:
        return {
            "stress": stress,
            "confidence": confidence,
            "role": resolve_role("supportive", level),
            "line": "خذ ثانيتين. ما الفكرة الرئيسية؟",
            "extra_seconds": 2,
            "interruptions": "fewer",
        }
    if features["pace"] > 180:
        return {
            "stress": stress,
            "confidence": confidence,
            "role": resolve_role("skeptical", level),
            "line": "ممكن تعيد النقطة الأخيرة؟",
            "extra_seconds": 0,
            "interruptions": "normal",
        }
    if features["pauses"] >= 3:
        return {
            "stress": stress,
            "confidence": confidence,
            "role": resolve_role("curious", level),
            "line": "كمّل، ما الذي جاء بعد ذلك؟",
            "extra_seconds": 0,
            "interruptions": "normal",
        }
    if features["clarity"] < 0.55:
        return {
            "stress": stress,
            "confidence": confidence,
            "role": resolve_role("skeptical", level),
            "line": "وضّح هذه النقطة بمثال واحد.",
            "extra_seconds": 0,
            "interruptions": "normal",
        }
    if features["repeated"] >= 2:
        return {
            "stress": stress,
            "confidence": confidence,
            "role": resolve_role("curious", level),
            "line": "انتقلت بين الأفكار. ما النقطة التي تريدها الآن؟",
            "extra_seconds": 0,
            "interruptions": "normal",
        }
    # A steady performance lets every seated listener respond in character.
    # The harder question still appears when the interrupter's turn comes.
    present = present_roles(level)
    role = present[int(asked) % len(present)]
    if role == "interrupter":
        if render_api():
            line = bank[min(int(asked), len(bank) - 1)]
        else:
            prompt = (
                "اكتب سؤالاً واحداً أصعب لجمهور يتدرب أمامه متحدث. "
                "السؤال فقط، بدون مقدمة."
            )
            line = _qwen(prompt) or bank[min(asked, len(bank) - 1)]
        interruptions = "more"
    elif role == "curious":
        extra = PERSONALITY["curious"]
        choices = list(bank) + extra
        line = choices[int(asked) % len(choices)]
        interruptions = "normal"
    else:
        choices = PERSONALITY[role]
        line = choices[int(asked) % len(choices)]
        interruptions = "normal"
    return {
        "stress": stress,
        "confidence": confidence,
        "role": role,
        "line": line,
        "extra_seconds": 0,
        "interruptions": interruptions,
    }


def choose_next_practice(scores, previous_confidence):
    """Chapter 3 chooseNextPractice. It points back to level 1, 2, or 3."""
    names = {
        "pace": "سرعة الكلام",
        "pauses": "التوقفات",
        "clarity": "وضوح الكلام",
        "organization": "ترتيب الأفكار",
        "interruptions": "المقاطعات والأسئلة المفاجئة",
    }
    weak_key = min(names, key=lambda name: scores.get(name, 1))
    if weak_key in ("pace", "pauses"):
        next_level = 1
    elif weak_key in ("clarity", "organization"):
        next_level = 2
    else:
        next_level = 3
    confidence = scores.get("confidence", 0)
    if previous_confidence is None:
        change = None
    else:
        change = round((confidence - previous_confidence) * 100)
    return {
        "confidence": round(confidence * 100),
        "change": change,
        "weak": names[weak_key],
        "weak_key": weak_key,
        "next_level": next_level,
    }
