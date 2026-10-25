const app = document.querySelector("#app");
const logoutButton = document.querySelector("#logout");

const SKIN = { light: "#f3d2b5", medium: "#c68642", deep: "#6b3a22" };
const OUTFIT = { navy: "#1f4e79", white: "#f4f7fb", black: "#243040" };

let token = localStorage.getItem("token") || "";
let user = null;
let draft = { gender: "female", age_group: "under_18", skin: "medium", hair: "tied", outfit: "navy", mode: "normal" };

logoutButton.addEventListener("click", async () => {
  try { await api("/api/logout", { method: "POST" }); } catch (err) { /* already signed out */ }
  token = "";
  localStorage.removeItem("token");
  user = null;
  if (window.SpeakingRoom) SpeakingRoom.close();
  document.body.classList.remove("in-room");
  showAccount();
});

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.detail;
    const message = typeof detail === "string" ? detail : "راجع الحقول ثم أعد المحاولة.";
    throw new Error(message);
  }
  return data;
}

function avatarSvg(avatar) {
  const skin = SKIN[avatar.skin] || SKIN.medium;
  const outfit = OUTFIT[avatar.outfit] || OUTFIT.navy;
  const hair = avatar.hair || "tied";
  const long = hair === "long" ? `<path d="M70 78c18 10 40 70 8 118" stroke="#2b2118" stroke-width="14" fill="none" stroke-linecap="round"/><path d="M130 78c-18 10-40 70-8 118" stroke="#2b2118" stroke-width="14" fill="none" stroke-linecap="round"/>` : "";
  const tied = hair === "tied" ? `<circle cx="128" cy="62" r="14" fill="#2b2118"/>` : "";
  const cap = hair === "short"
    ? `<path d="M72 78c4-28 52-40 70-8" fill="#2b2118"/>`
    : `<path d="M68 86c2-40 62-52 78-8" fill="#2b2118"/>`;
  return `
    <svg viewBox="0 0 200 260" width="180" height="230" aria-hidden="true">
      ${long}
      <rect x="78" y="128" width="44" height="78" rx="16" fill="${outfit}" stroke="#1f4e79" stroke-width="2"/>
      <circle cx="100" cy="86" r="34" fill="${skin}" stroke="#1f4e79" stroke-width="2"/>
      ${cap}${tied}
    </svg>`;
}

function avatarOf(source) {
  const from = source || {};
  return {
    skin: from.skin || "medium",
    hair: from.hair || "tied",
    outfit: from.outfit || "navy",
    gender: from.gender || (user && user.gender) || draft.gender || "female",
  };
}

function showLobby(source) {
  document.body.classList.remove("in-room");
  document.body.classList.add("has-lobby");
  const avatar = avatarOf(source);
  const key = JSON.stringify(avatar);
  let layer = document.querySelector("#lobby");
  if (!layer) {
    layer = document.createElement("div");
    layer.id = "lobby";
    document.body.prepend(layer);
  }
  if (layer.dataset.key === key && layer.dataset.on === "1") return;
  const canvas = document.createElement("canvas");
  layer.replaceChildren(canvas);
  layer.dataset.key = key;
  layer.dataset.on = "1";
  SpeakingRoom.lobby(canvas, avatar);
}

function hideLobby() {
  const layer = document.querySelector("#lobby");
  if (layer) {
    layer.dataset.on = "0";
    layer.dataset.key = "";
    layer.replaceChildren();
  }
  document.body.classList.remove("has-lobby");
  if (window.SpeakingRoom) SpeakingRoom.close();
}

function mount(html, options) {
  const opts = options || {};
  showLobby(opts.avatar);
  app.innerHTML = `<section class="frame${opts.wide ? " wide" : ""}">${html}</section>`;
}

function choiceGroup(name, options, selected) {
  return `<div class="choices" data-group="${name}">
    ${options.map(([value, label]) => `
      <button type="button" class="choice ${value === selected ? "selected" : ""}" data-value="${value}">${label}</button>
    `).join("")}
  </div>`;
}

function bindChoices(root, onChange) {
  root.querySelectorAll(".choices").forEach((group) => {
    group.addEventListener("click", (event) => {
      const button = event.target.closest(".choice");
      if (!button) return;
      group.querySelectorAll(".choice").forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
      draft[group.dataset.group] = button.dataset.value;
      onChange();
    });
  });
}

function showAccount() {
  logoutButton.hidden = true;
  mount(`
    <section class="card">
      <p class="eyebrow">المشهد أمامك</p>
      <h2>قاعة التحدث</h2>
      <p class="lede">الحساب يفتح هذه الغرفة. الجمهور الذي تراه هو الجمهور الذي ستقف أمامه.</p>
      <div class="tabs">
        <button class="choice selected" id="tab-login" type="button">دخول</button>
        <button class="choice" id="tab-register" type="button">حساب جديد</button>
      </div>
      <h2 id="account-title">دخول</h2>
      <p class="lede">كلمة المرور تُحفظ مشفّرة ولا تُرسل إلى خدمة خارجية.</p>
      <form id="account-form">
        <label for="username">الاسم</label>
        <input id="username" name="username" autocomplete="username" required>
        <label for="password">كلمة المرور</label>
        <input id="password" name="password" type="password" autocomplete="current-password" required>
        <p class="error" id="error"></p>
        <div class="row"><button class="primary" type="submit">متابعة</button></div>
      </form>
    </section>`);
  let mode = "login";
  const title = document.querySelector("#account-title");
  document.querySelector("#tab-login").onclick = () => {
    mode = "login";
    title.textContent = "دخول";
    document.querySelector("#tab-login").classList.add("selected");
    document.querySelector("#tab-register").classList.remove("selected");
  };
  document.querySelector("#tab-register").onclick = () => {
    mode = "register";
    title.textContent = "حساب جديد";
    document.querySelector("#tab-register").classList.add("selected");
    document.querySelector("#tab-login").classList.remove("selected");
  };
  document.querySelector("#account-form").onsubmit = async (event) => {
    event.preventDefault();
    const error = document.querySelector("#error");
    error.textContent = "";
    const body = {
      username: document.querySelector("#username").value,
      password: document.querySelector("#password").value,
    };
    try {
      const result = await api(mode === "login" ? "/api/login" : "/api/register", { method: "POST", body });
      token = result.token;
      localStorage.setItem("token", token);
      user = result.user;
      route();
    } catch (err) {
      error.textContent = err.message;
    }
  };
}

function showSetup() {
  logoutButton.hidden = false;
  if (user.gender) draft.gender = user.gender;
  if (user.age_group) draft.age_group = user.age_group;
  if (user.avatar) Object.assign(draft, user.avatar);
  if (user.mode) draft.mode = user.mode;
  mount(`
    <section class="card">
      <p class="steps"><span class="active">1 أنت</span><span>2 الشخصية</span><span>3 العرض</span></p>
      <h2>من الذي يتدرب؟</h2>
      <label>الجنس</label>
      ${choiceGroup("gender", [["female", "أنثى"], ["male", "ذكر"]], draft.gender)}
      <label>الفئة العمرية</label>
      ${choiceGroup("age_group", [["under_18", "أقل من 18"], ["18_plus", "18 فأكثر"]], draft.age_group)}
      <p class="error" id="error"></p>
      <div class="row"><button class="primary" id="next" type="button">متابعة</button></div>
    </section>`, { avatar: draft });
  bindChoices(app, () => {});
  document.querySelector("#next").onclick = () => showAvatar();
}

function showAvatar() {
  mount(`
    <section class="card setup">
      <div class="preview" id="preview"></div>
      <div>
        <p class="steps"><span>1 أنت</span><span class="active">2 الشخصية</span><span>3 العرض</span></p>
        <h2>اختر المتحدث</h2>
        <p class="lede">هذه الشخصية تقف الآن على المسرح.</p>
        <label>البشرة</label>
        ${choiceGroup("skin", [["light", "فاتحة"], ["medium", "متوسطة"], ["deep", "داكنة"]], draft.skin)}
        <label>الشعر</label>
        ${choiceGroup("hair", [["short", "قصير"], ["tied", "مربوط"], ["long", "طويل"]], draft.hair)}
        <label>اللباس</label>
        ${choiceGroup("outfit", [["navy", "كحلي"], ["white", "أبيض"], ["black", "أسود"]], draft.outfit)}
        <div class="row">
          <button class="secondary" id="back" type="button">رجوع</button>
          <button class="primary" id="next" type="button">متابعة</button>
        </div>
      </div>
    </section>`, { avatar: draft });
  const paint = () => {
    document.querySelector("#preview").innerHTML = avatarSvg(draft);
    showLobby(draft);
  };
  paint();
  bindChoices(app, paint);
  document.querySelector("#back").onclick = () => showSetup();
  document.querySelector("#next").onclick = () => showMode();
}

function showMode() {
  mount(`
    <section class="card">
      <p class="steps"><span>1 أنت</span><span>2 الشخصية</span><span class="active">3 العرض</span></p>
      <h2>كيف تريد أن ترى الغرفة؟</h2>
      <p class="lede">النمطان يعرضان الغرفة نفسها. إذا لم تتصل النظارة، يستمر الواقع الافتراضي على الشاشة.</p>
      ${choiceGroup("mode", [["normal", "الوضع العادي"], ["vr", "الواقع الافتراضي"]], draft.mode)}
      <p class="error" id="error"></p>
      <div class="row">
        <button class="secondary" id="back" type="button">رجوع</button>
        <button class="primary" id="save" type="button">احفظ وأظهر المستويات</button>
      </div>
    </section>`, { avatar: draft });
  bindChoices(app, () => {});
  document.querySelector("#back").onclick = () => showAvatar();
  document.querySelector("#save").onclick = async () => {
    const error = document.querySelector("#error");
    error.textContent = "";
    try {
      user = await api("/api/profile", {
        method: "PUT",
        body: {
          gender: draft.gender,
          age_group: draft.age_group,
          avatar: { skin: draft.skin, hair: draft.hair, outfit: draft.outfit },
          mode: draft.mode,
        },
      });
      showHome();
    } catch (err) {
      error.textContent = err.message;
    }
  };
}

async function showHome() {
  logoutButton.hidden = false;
  const levels = await api("/api/levels");
  const age = user.age_group === "under_18" ? "أقل من 18" : "18 فأكثر";
  const mode = user.mode === "vr" ? "الواقع الافتراضي" : "الوضع العادي";
  const tasks = {
    "A short class talk": "حديث قصير أمام الصف",
    "Explain a school project": "شرح مشروع مدرسي",
    "Present to the class": "عرض أمام الفصل",
    "A short presentation": "عرض تقديمي قصير",
    "Graduation-project discussion": "مناقشة مشروع التخرج",
    "Job interview": "مقابلة وظيفية",
  };
  mount(`
    <section class="card home-card">
      <p class="eyebrow">القاعة مفتوحة</p>
      <h2>${user.username}</h2>
      <p class="lede">${age} · ${mode}. اختر مستوى وابدأ التحدث بصوتك.</p>
      <div class="levels">
        ${levels.levels.map((level) => `
          <article class="level">
            <div class="badge">مستوى ${level.level}</div>
            <div class="copy">
              <strong>${tasks[level.task] || level.task}</strong>
              <span>${({
                "A small calm group. No questions.": "مجموعة صغيرة وهادئة. بدون أسئلة.",
                "More listeners, and up to two questions.": "مستمعون أكثر، وسؤالان على الأكثر.",
                "Interruptions, and one harder question.": "مقاطعات، وسؤال أصعب.",
              })[level.pressure] || level.pressure}</span>
            </div>
            <button class="primary start-level" data-level="${level.level}" type="button">ادخل المستوى</button>
          </article>
        `).join("")}
      </div>
      <div class="row"><button class="secondary" id="edit" type="button">تعديل الإعداد</button></div>
    </section>`, { avatar: user.avatar, wide: true });
  document.querySelector("#edit").onclick = () => showSetup();
  document.querySelectorAll(".start-level").forEach((button) => {
    button.onclick = () => enterLevel(Number(button.dataset.level), tasks);
  });
}

let micState = null;
const wave = [];

function pushWave(level) {
  wave.push(Math.min(1, level * 8));
  if (wave.length > 48) wave.shift();
  const canvas = document.querySelector("#wave");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const width = canvas.width = canvas.clientWidth * 2;
  const height = canvas.height = 72;
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "#e2b56a";
  ctx.lineWidth = 3;
  ctx.beginPath();
  wave.forEach((amp, index) => {
    const x = (index / 47) * width;
    const y = height / 2 - amp * (height * 0.42);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  for (let index = wave.length - 1; index >= 0; index -= 1) {
    const x = (index / 47) * width;
    const y = height / 2 + wave[index] * (height * 0.42);
    ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = "rgba(226, 181, 106, 0.35)";
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.stroke();
}

function percent(value) {
  return Math.round((value || 0) * 100);
}

async function enterLevel(level, tasks) {
  const session = await api("/api/sessions", { method: "POST", body: { level } });
  session.level.task_ar = tasks[session.level.task] || session.level.task;
  showRoom(session);
}

function showRoom(session) {
  hideLobby();
  document.body.classList.add("in-room");
  logoutButton.hidden = true;
  const minutes = 4;
  const pressure = ({
    "A small calm group. No questions.": "مجموعة صغيرة وهادئة",
    "More listeners, and up to two questions.": "مستمعون أكثر، وسؤالان على الأكثر",
    "Interruptions, and one harder question.": "مقاطعات، وسؤال أصعب",
  })[session.level.pressure] || "";
  app.innerHTML = `
    <section class="stage">
      <canvas id="scene"></canvas>
      <div class="hud">
        <div class="topbar">
          <button class="ghost end" id="leave" type="button">إنهاء الجلسة</button>
          <div class="title-pill">
            <strong>مستوى ${session.level.level} — ${session.level.task_ar}</strong>
            <span>${pressure}</span>
          </div>
          <button class="ghost" id="headset" type="button">النظارة</button>
        </div>
        <aside class="panel side-left">
          <div class="timer-card">
            <div class="metric"><span>الوقت المتبقي</span><b id="timer">${String(minutes).padStart(2, "0")}:00</b></div>
            <div class="meter time"><span id="time-bar"></span></div>
          </div>
          <strong class="panel-title">الجمهور <span id="audience-count"></span></strong>
          <div id="audience"></div>
        </aside>
        <aside class="panel side-right">
          <strong class="panel-title">المؤشرات الحية</strong>
          <div class="metric"><span class="ico clarity">وضوح</span><b id="clarity-label">—</b></div>
          <div class="meter"><span id="clarity-bar"></span></div>
          <div class="metric"><span class="ico pace">سرعة الكلام</span><b id="pace-label">—</b></div>
          <div class="metric"><span class="ico pause">التوقفات</span><b id="pause-label">—</b></div>
          <div class="metric"><span class="ico stress">التوتر</span><b id="stress-label">—</b></div>
          <div class="meter stress"><span id="stress-bar"></span></div>
          <div class="metric"><span class="ico conf">الثقة</span><b id="conf-label">—</b></div>
          <div class="meter conf"><span id="conf-bar"></span></div>
        </aside>
        <aside class="panel corner tip">
          <strong class="panel-title">نصيحة مباشرة</strong>
          <p id="tip">وزّع نظرك على الجمهور، وتجنّب التركيز على شخص واحد.</p>
        </aside>
        <aside class="panel corner smart">
          <strong class="panel-title">رد الجمهور</strong>
          <p id="heard">سيظهر رد أحد المستمعين هنا بعد أن تتحدث.</p>
        </aside>
        <div class="dock">
          <div class="transcript" id="transcript">
            <canvas id="wave"></canvas>
            <p id="caption">اضغط الميكروفون وتحدّث.</p>
          </div>
          <div class="tools">
            <button class="mic" id="mic" type="button">مايك</button>
            <button class="tool" id="captions" type="button">النص</button>
          </div>
        </div>
      </div>
    </section>`;
  const canvas = document.querySelector("#scene");
  if (session.avatar) session.avatar.gender = user && user.gender;
  const members = SpeakingRoom.open(canvas, session);
  const list = document.querySelector("#audience");
  const count = document.querySelector("#audience-count");
  if (count) count.textContent = `(${members.length})`;
  list.innerHTML = members.map((member) => `
    <div class="audience-row" data-index="${member.index}">
      <span class="avatar-dot" style="background:${member.color}"></span>
      <span>${member.name}</span>
    </div>
  `).join("");

  let remaining = minutes * 60;
  const total = remaining;
  const timer = setInterval(() => {
    remaining = Math.max(0, remaining - 1);
    const m = String(Math.floor(remaining / 60)).padStart(2, "0");
    const s = String(remaining % 60).padStart(2, "0");
    const node = document.querySelector("#timer");
    const bar = document.querySelector("#time-bar");
    if (node) node.textContent = `${m}:${s}`;
    if (bar) bar.style.width = `${(remaining / total) * 100}%`;
    if (remaining === 0) finishLevel();
  }, 1000);

  document.querySelector("#headset").onclick = async () => {
    const entered = await SpeakingRoom.enterHeadset();
    const tip = document.querySelector("#tip");
    if (!entered && tip) tip.textContent = "النظارة غير متصلة. المشهد مستمر على الشاشة.";
  };
  document.querySelector("#mic").onclick = () => toggleMic(session.session_id);
  document.querySelector("#captions").onclick = () => {
    document.querySelector("#transcript").classList.toggle("hidden");
  };
  document.querySelector("#leave").onclick = () => finishLevel();

  async function finishLevel() {
    clearInterval(timer);
    stopMic();
    let result = { turns: 0, confidence: 0, report: null, level: session.level.level };
    try {
      result = await api(`/api/sessions/${session.session_id}/finish`, { method: "POST" });
    } catch (err) {
      result.error = err.message;
    }
    SpeakingRoom.close();
    document.body.classList.remove("in-room");
    showResult(result, session);
  }
}

function showResult(result, session) {
  logoutButton.hidden = false;
  const report = result.report;
  const change = report && report.change !== null && report.change !== undefined
    ? (report.change >= 0 ? `تحسنت بمقدار ${report.change} نقطة` : `انخفضت بمقدار ${Math.abs(report.change)} نقطة`)
    : "لا توجد جلسة سابقة للمقارنة";
  mount(`
    <section class="card">
      <p class="eyebrow">نتيجة الوقوف على المسرح</p>
      <h2>نهاية المستوى ${result.level}</h2>
      ${result.turns ? `<p class="score">${result.confidence}٪</p><p class="lede">الثقة في «${session.level.task_ar}»</p>` : `<p class="lede">${session.level.task_ar}</p>`}
      <ul class="report-list">
        ${result.turns ? `<li>مستوى الثقة: ${result.confidence}٪</li>
        <li>وضوح الكلام: ${result.clarity || 0}٪</li>
        <li>السرعة: ${result.pace || 0}٪ من النطاق المناسب</li>
        <li>التوقفات: ${result.pauses || 0}٪</li>
        <li>لقطات محسبة: ${result.turns}</li>` : `<li>لم يُلتقط كلام في هذه الجلسة، لذلك لا توجد نتيجة.</li>`}
        ${report ? `<li>مقارنة بالجلسة السابقة: ${change}</li>
          <li>المهارة الأضعف: ${report.weak}</li>
          <li>المستوى الذي يُعاد: ${report.next_level}</li>` : ""}
      </ul>
      <div class="row"><button class="primary" id="back-home" type="button">العودة للمستويات</button></div>
    </section>`, { avatar: user && user.avatar, wide: true });
  document.querySelector("#back-home").onclick = () => showHome();
}

function stopMic() {
  if (!micState) return;
  micState.listening = false;
  micState.processor.disconnect();
  micState.source.disconnect();
  micState.stream.getTracks().forEach((track) => track.stop());
  micState.context.close();
  micState = null;
  const button = document.querySelector("#mic");
  if (button) button.classList.remove("live");
}

async function toggleMic(sessionId) {
  const button = document.querySelector("#mic");
  if (micState) {
    stopMic();
    return;
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const processor = context.createScriptProcessor(4096, 1, 1);
  const silent = context.createGain();
  silent.gain.value = 0;
  const state = { listening: true, buffer: [], samples: 0, processor, source, stream, context };
  micState = state;
  processor.onaudioprocess = (event) => {
    if (!state.listening) return;
    const channel = event.inputBuffer.getChannelData(0);
    state.buffer.push(new Float32Array(channel));
    state.samples += channel.length;
    let energy = 0;
    for (let index = 0; index < channel.length; index += 1) energy += channel[index] * channel[index];
    pushWave(Math.sqrt(energy / channel.length));
    if (state.samples > context.sampleRate * 3.2) {
      const taken = state.buffer;
      state.buffer = [];
      state.samples = 0;
      sendChunk(sessionId, taken, context.sampleRate);
    }
  };
  source.connect(processor);
  processor.connect(silent);
  silent.connect(context.destination);
  button.classList.add("live");
}

async function sendChunk(sessionId, parts, sampleRate) {
  const joined = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  parts.forEach((part) => {
    joined.set(part, offset);
    offset += part.length;
  });
  const ratio = sampleRate / 16000;
  const length = Math.floor(joined.length / ratio);
  const pcm = new Int16Array(length);
  for (let index = 0; index < length; index += 1) {
    const sample = joined[Math.floor(index * ratio)] || 0;
    pcm[index] = Math.max(-1, Math.min(1, sample)) * 0x7fff;
  }
  const response = await fetch(`/api/sessions/${sessionId}/turn`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Sample-Rate": "16000",
      "Content-Type": "application/octet-stream",
    },
    body: pcm.buffer,
  });
  const data = await response.json();
  if (!response.ok) return;
  const heard = document.querySelector("#heard");
  const tip = document.querySelector("#tip");
  const tips = {
    interested: "الكلام واضح. وزّع نظرك على بقية الجمهور.",
    uninterested: "هذا المستمع شارد. اختصر وقل النتيجة.",
    curious: "سؤال بسيط. أكمل الفكرة التي بدأتها.",
    skeptical: "يطلب الدليل. اذكر مثالاً واحداً.",
    interrupter: "مقاطعة. أجب باختصار ثم ارجع لفكرتك.",
    supportive: "خذ نفسًا قصيرًا، ثم أكمل بالنقطة الرئيسية.",
  };
  if (data.empty) {
    if (heard) heard.textContent = data.line;
    SpeakingRoom.react(null);
    document.querySelectorAll(".audience-row").forEach((row) => row.classList.remove("active"));
    return;
  }
  const speaker = SpeakingRoom.react(data.role, data.line);
  if (heard) heard.textContent = data.line;
  if (tip && tips[data.role]) tip.textContent = tips[data.role];
  const stress = document.querySelector("#stress-bar");
  const conf = document.querySelector("#conf-bar");
  if (stress) stress.style.width = `${percent(data.stress)}%`;
  if (conf) conf.style.width = `${percent(data.confidence)}%`;
  const stressLabel = document.querySelector("#stress-label");
  const confLabel = document.querySelector("#conf-label");
  if (stressLabel) stressLabel.textContent = data.stress >= 0.62 ? "مرتفع" : "منخفض";
  if (confLabel) confLabel.textContent = `${percent(data.confidence)}٪`;
  const pace = document.querySelector("#pace-label");
  const pauses = document.querySelector("#pause-label");
  if (pace) pace.textContent = `${Math.round(data.pace)}`;
  if (pauses) pauses.textContent = String(data.pauses);
  const clarityBar = document.querySelector("#clarity-bar");
  const clarityLabel = document.querySelector("#clarity-label");
  if (clarityBar) clarityBar.style.width = `${percent(data.clarity)}%`;
  if (clarityLabel) clarityLabel.textContent = `${percent(data.clarity)}٪`;
  document.querySelectorAll(".audience-row").forEach((row) => {
    row.classList.toggle("active", Number(row.dataset.index) === speaker);
  });
}

function route() {
  if (!token) return showAccount();
  if (!user || !user.complete) return showSetup();
  return showHome();
}

async function start() {
  if (!token) return showAccount();
  try {
    user = await api("/api/me");
    route();
  } catch (err) {
    token = "";
    localStorage.removeItem("token");
    showAccount();
  }
}

start();
