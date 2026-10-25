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


def features_from_whisper_json(payload, source):
    """Turn a Whisper verbose_json payload into the Chapter 3 measures."""
    if not isinstance(payload, dict):
        return None
    raw_words = list(payload.get("words") or [])
    if not raw_words:
        for segment in payload.get("segments") or []:
            raw_words.extend(segment.get("words") or [])
    words = []
    timings = []
    for item in raw_words:
        text = (item.get("word") or "").strip()
        if not text:
            continue
        words.append(text)
        if "start" in item and "end" in item:
            timings.append({"start": item["start"], "end": item["end"]})
    transcript = " ".join(words).strip() or (payload.get("text") or "").strip()
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


def transcribe_pcm(pcm, sample_rate):
    """Whisper large-v3 through Groq. None means this host is not using the API."""
    if not render_api() or not pcm:
        return None
    wav = _wav_bytes(pcm, sample_rate)
    if wav is None:
        return None
    model = os.environ.get("SPEECH_MODEL", "whisper-large-v3")
    key = os.environ.get("GROQ_API_KEY", "").strip()
    try:
        import httpx
    except Exception:
        return None
    try:
        response = httpx.post(
            "https://api.groq.com/openai/v1/audio/transcriptions",
            headers={"Authorization": "Bearer %s" % key},
            files={"file": ("speech.wav", wav, "audio/wav")},
            data={
                "model": model,
                "language": "ar",
                "response_format": "verbose_json",
                "temperature": "0",
                "timestamp_granularities[]": "word",
                "prompt": "خطاب، عرض تقديمي، مقابلة عمل.",
            },
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
    """Level 2 and 3 begin with the committee, before the speaker answers."""
    table = {
        "Explain a school project": ("curious", "ما المشروع الذي ستشرحه؟"),
        "Graduation-project discussion": ("curious", "ما موضوع مشروع التخرج؟"),
        "Present to the class": ("interested", "ما موضوع عرضك أمام الفصل؟"),
        "Job interview": ("skeptical", "ما الوظيفة التي تتقدم لها؟"),
    }
    found = table.get(task)
    if not found:
        return None
    return {"role": found[0], "line": found[1]}


FOLLOW_UP = {
    2: ["ما الخطوة التالية في هذا العمل؟", "ما الصعوبة التي واجهتها فيه؟"],
    3: ["لماذا يناسبك هذا العمل؟", "ما الخبرة الأقرب إلى ما ذكرته؟"],
}


def _audience_line(role, transcript, intent, recent, features, level=1):
    """On Render, one new sentence about what was just said. Local stays on the fixed line."""
    if not render_api():
        return ""
    heard = (transcript or "").strip()
    if not heard:
        return ""
    voices = {
        "interested": "مستمع مهتم. إذا كانت الجملة واضحة، سمِّ الفكرة وقل إنها واضحة ثم اطلب النقطة التالية.",
        "uninterested": "مستمع يريد خلاصة الفكرة التي قيلت، باسمها.",
        "curious": "مستمع يسأل عن تفصيل من الجملة التي قيلت.",
        "skeptical": "مستمع يسأل عن دليل على شيء قيل في الجملة نفسها.",
        "interrupter": "مستمع يقاطع بسؤال عن الجملة التي قيلت.",
        "supportive": "مستمع يشجع الفكرة التي قيلت ويطلب إكمالها.",
    }
    previous = " | ".join(recent[:4]) if recent else "لا يوجد"
    if int(level) >= 2:
        return _ask_groq(
            "أنت أحد أعضاء اللجنة، وأنت من يسأل.\n"
            "جواب المتحدث: «%s»\n"
            "اسأل سؤالاً واحداً قصيراً عن هذا الجواب فقط.\n"
            "في مناقشة المشروع اسأل عن المشروع. في المقابلة اسأل عن الوظيفة والعمل.\n"
            "لا تكرر: %s"
            % (heard[:700], previous),
            first_line_only=True,
        )
    return _ask_groq(
        "أنت تستمع إلى المتحدث الآن.\n"
        "قال حرفياً: «%s»\n"
        "شخصيتك: %s\n"
        "اكتب جملة عربية واحدة. اذكر شيئاً قاله ثم رد عليه.\n"
        "إذا كانت فكرته واضحة، قل إنها واضحة واطلب الفكرة التالية.\n"
        "ممنوع استخدام جملة عامة لا علاقة لها بكلامه.\n"
        "لا تكرر: %s"
        % (heard[:700], voices.get(role, role), previous),
        first_line_only=True,
    )


def _usable_line(text, recent):
    line = (text or "").strip()
    if not line or line in recent:
        return ""
    if len(line) > 90 or "دقيقة" in line or "كلمة في" in line:
        return ""
    return line


def adapt_audience(features, level, asked, transcript="", recent=None):
    """Chapter 3 chooses the listener. Render then writes a line about the speech."""
    result = _adapt_rules(features, level, asked)
    recent = recent or []
    spoken = _usable_line(
        _audience_line(result["role"], transcript, result["line"], recent, features, level),
        recent,
    )
    if spoken:
        result["line"] = spoken
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
