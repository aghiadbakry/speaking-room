"""The three contribution algorithms from Chapter 3.

measureSpeech, adaptAudience, and chooseNextPractice. faster-whisper and
Qwen2.5 are used when they are installed on this computer. Until then, the
same rules run on the loudness and the pauses in the recording, and the
questions come from the three fixed levels. Nothing is sent to a paid service.
"""

import array
import json
import math
import urllib.request

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
        span = max(float(timings[-1]["end"]) - float(timings[0]["start"]), 0.1)
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


def _qwen(prompt):
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


def adapt_audience(features, level, asked):
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
