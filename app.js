// telc B1 스프린트 — 앱 로직
const STORE_KEY = "telcb1_v1";
const TOTAL_TARGET = 2400;          // telc B1 목표 어휘 수
const DRILLS_PER_DAY = 10;
const GRAMMAR_PER_DAY = 3;   // 하루 문법 레슨 수
const DECK_GOAL = 20;        // 하루 찍기 카드 목표 수
const SRS_INTERVALS = [0, 1, 2, 4, 8, 16, 32]; // box → 며칠 뒤 복습

let S = load();
function load() {
  const def = {
    srs: {},             // vocabId → {b: box, due: "YYYY-MM-DD"}
    introduced: [],      // 이미 배운 단어 id
    drillsDone: [],      // 완료한 드릴 id
    drillsToday: 0,
    grammarDone: [],     // 완료한 문법 레슨 id
    grammarToday: 0,     // 오늘 완료한 레슨 수
    deckToday: 0,        // 오늘 찍기 카드 맞힌 수
    extraNew: 0,         // 오늘 추가로 허용한 새 단어 수
    extraDrills: 0,      // 오늘 추가 드릴 수
    extraGrammar: 0,     // 오늘 추가 문법 레슨 수
    wrongQ: [],          // 오늘 틀린 문법 문제 ("레슨id:문제번호")
    streak: 0,
    lastStudy: null,     // 마지막으로 목표 달성한 날
    lastOpen: null,
    examDate: addDays(today(), 90),
    newPerDay: 30,
  };
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? Object.assign(def, JSON.parse(raw)) : def;
  } catch { return def; }
}
function save() { localStorage.setItem(STORE_KEY, JSON.stringify(S)); }

function today() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0"); }
function addDays(dateStr, n) { const d = new Date(dateStr + "T12:00:00"); d.setDate(d.getDate() + n); return d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0"); }
function daysBetween(a, b) { return Math.round((new Date(b + "T12:00:00") - new Date(a + "T12:00:00")) / 86400000); }

// 날짜가 바뀌면 오늘 드릴 카운터 리셋 + 스트릭 확인
(function rollover() {
  const t = today();
  if (S.lastOpen !== t) {
    S.drillsToday = 0;
    S.grammarToday = 0;
    S.deckToday = 0;
    S.extraNew = 0;
    S.extraDrills = 0;
    S.extraGrammar = 0;
    S.wrongQ = [];
    if (S.lastStudy && daysBetween(S.lastStudy, t) > 1) S.streak = 0; // 하루 건너뛰면 스트릭 초기화
    S.lastOpen = t;
    save();
  }
})();

function markStudied() {
  const t = today();
  if (S.lastStudy !== t) {
    S.streak = (S.lastStudy && daysBetween(S.lastStudy, t) === 1) ? S.streak + 1 : 1;
    S.lastStudy = t;
  }
  save();
}

// ---------- SRS 큐 ----------
function dueReviews() {
  const t = today();
  return S.introduced.filter(id => S.srs[id] && S.srs[id].due <= t);
}
function introducedTodayCount() {
  return S.introduced.filter(id => S.srs[id] && S.srs[id].intro === today()).length;
}
function newAvailable() {
  const remainCap = Math.max(0, S.newPerDay + (S.extraNew || 0) - introducedTodayCount());
  const notSeen = VOCAB.filter(v => !S.introduced.includes(v.id)).map(v => v.id);
  return notSeen.slice(0, remainCap);
}
function unseenLeft() {
  return VOCAB.filter(v => !S.introduced.includes(v.id)).length;
}
function masteredCount() {
  return S.introduced.filter(id => S.srs[id] && S.srs[id].b >= 4).length;
}

// ---------- TTS ----------
function speak(text) {
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "de-DE";
    u.rate = 0.9;
    speechSynthesis.speak(u);
  } catch {}
}

// ---------- 화면 렌더링 ----------
const screen = document.getElementById("screen");
let currentTab = "home";
let backFn = null;   // 현재 화면의 뒤로가기 동작 (null이면 버튼 없음)

// 세션 상단바 (좌: 뒤로+제목, 우: 진행표시)
function sesTop(title, right) {
  return `<div class="session-top">
    <span class="st-left">${backFn ? `<button class="backbtn" id="backbtn" aria-label="뒤로">←</button>` : ""}<span>${title}</span></span>
    <span>${right || ""}</span>
  </div>`;
}
function wireBack() {
  const b = document.getElementById("backbtn");
  if (b && backFn) b.addEventListener("click", () => { const f = backFn; f(); });
}

function renderTop() {
  const dd = daysBetween(today(), S.examDate);
  document.getElementById("dday").textContent = dd >= 0 ? `시험 D-${dd}` : "시험일 지남";
  document.getElementById("streak").textContent = `연속 ${S.streak}일`;
}

function setTab(tab) {
  currentTab = tab;
  backFn = null;   // 탭 최상위 화면은 뒤로가기 없음
  document.querySelectorAll("#tabbar button").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  renderTop();
  if (tab === "home") renderHome();
  else if (tab === "vocab") startVocabSession();
  else if (tab === "deck") renderDeckHub();
  else if (tab === "drill") startDrillSession();
  else if (tab === "grammar") renderGrammar();
  else if (tab === "settings") renderSettings();
}
document.querySelectorAll("#tabbar button").forEach(b => b.addEventListener("click", () => setTab(b.dataset.tab)));

// ---------- 홈 ----------
function renderHome() {
  const due = dueReviews().length;
  const news = newAvailable().length;
  const introToday = introducedTodayCount();
  const vGoal = S.newPerDay;
  const gSt = grammarStatus();
  const gDone = S.grammarToday || 0;
  const mastered = masteredCount();
  const learned = S.introduced.length;
  const pct = Math.min(100, Math.round(learned / TOTAL_TARGET * 1000) / 10);

  const deckDone = S.deckToday || 0;

  // 오늘 목표 달성률 (초과분은 100%로 계산)
  const vPct = Math.min(1, vGoal ? introToday / vGoal : 1);
  const gPct = Math.min(1, gDone / GRAMMAR_PER_DAY);
  const kPct = Math.min(1, deckDone / DECK_GOAL);
  const totalPct = Math.round((vPct + gPct + kPct) / 3 * 100);

  const vocabBtn = (due + news > 0)
    ? `<button class="btn" data-go="vocab">시작</button>`
    : unseenLeft() > 0
      ? `<button class="btn secondary" data-extra="vocab">+10개 더</button>`
      : `<span class="task-done">완료</span>`;
  const grammarBtn = !gSt.doneToday
    ? `<button class="btn" data-go="grammar">시작</button>`
    : gSt.g
      ? `<button class="btn secondary" data-extra="grammar">+1개 더</button>`
      : `<span class="task-done">완료</span>`;
  const deckBtn = deckDone >= DECK_GOAL
    ? `<button class="btn secondary" data-go="deck">더 하기</button>`
    : `<button class="btn" data-go="deck">시작</button>`;

  screen.innerHTML = `
    <div class="panel">
      <h2>오늘의 미션 · 달성 ${totalPct}%</h2>
      <div class="progress-wrap"><div class="progress-bar" style="width:${totalPct}%"></div></div>
      <div class="task-row">
        <div class="task-left"><div class="task-name">단어 학습</div>
          <div class="task-detail">새 단어 ${introToday}/${vGoal}개${(S.extraNew||0) > 0 ? ` (+${S.extraNew} 추가)` : ""} · 복습 대기 ${due}개</div>
          <div class="mini-wrap"><div class="mini-bar" style="width:${vPct*100}%"></div></div></div>
        ${vocabBtn}
      </div>
      <div class="task-row">
        <div class="task-left"><div class="task-name">오늘의 문법</div>
          <div class="task-detail">${gSt.detail}</div>
          <div class="mini-wrap"><div class="mini-bar" style="width:${gPct*100}%"></div></div></div>
        ${grammarBtn}
      </div>
      <div class="task-row">
        <div class="task-left"><div class="task-name">관사·대명사 찍기</div>
          <div class="task-detail">오늘 ${deckDone}/${DECK_GOAL}개 · 매일 반복하면 저절로 외워져요</div>
          <div class="mini-wrap"><div class="mini-bar" style="width:${kPct*100}%"></div></div></div>
        ${deckBtn}
      </div>
    </div>

    <div class="panel">
      <h2>B1까지 진행률</h2>
      <div class="progress-wrap"><div class="progress-bar" style="width:${pct}%"></div></div>
      <div class="progress-label">배운 단어 ${learned} / ${TOTAL_TARGET}개 · 완전히 외운 단어 ${mastered}개 · 문법 ${S.grammarDone.length}/${GRAMMAR.length}레슨</div>
    </div>

    <div class="panel">
      <h2>12주 스프린트 로드맵</h2>
      <div class="week-plan">
        <b>1~3주</b> A2 핵심 문법 압축 — Perfekt·부문장·분리동사 (단어 ~700)<br>
        <b>4~7주</b> B1 문법 전부 + 어휘 확장 (단어 ~1,600)<br>
        <b>8~10주</b> B1 완성 + telc 시험유형 매일 (단어 2,400)<br>
        <b>11~12주</b> telc 모의고사 반복 + 약점 보완
      </div>
    </div>`;
  screen.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => setTab(b.dataset.go)));
  screen.querySelectorAll("[data-extra]").forEach(b => b.addEventListener("click", () => {
    const kind = b.dataset.extra;
    if (kind === "vocab") S.extraNew = (S.extraNew || 0) + 10;
    if (kind === "drill") S.extraDrills = (S.extraDrills || 0) + 10;
    if (kind === "grammar") S.extraGrammar = (S.extraGrammar || 0) + 1;
    save();
    setTab(kind);
  }));
}

// ---------- 단어 세션 ----------
let vq = [];   // 세션 큐: {id, isNew, introPhase}
function startVocabSession() {
  const due = dueReviews();
  const news = newAvailable();
  vq = [
    ...due.map(id => ({id, isNew: false})),
    ...news.map(id => ({id, isNew: true, introPhase: true})),
  ];
  if (vq.length === 0) {
    renderDone("오늘 단어 학습을 모두 끝냈어요!", "내일 복습 카드가 다시 나와요.", null, vocabExtraBtn());
    return;
  }
  nextVocabCard();
}

function nextVocabCard() {
  if (vq.length === 0) { markStudied(); renderDone("단어 세션 완료", "이제 오늘의 문법을 풀어볼까요?", "grammar", vocabExtraBtn()); return; }
  const item = vq[0];
  const w = VOCAB.find(v => v.id === item.id);
  const total = vq.length;
  const isIntro = item.isNew && item.introPhase;
  const subLine = w.pl ? `<div class="plural">복수: ${w.pl}</div>` : w.gr ? `<div class="plural">${w.gr}</div>` : "";
  backFn = () => setTab("home");

  screen.innerHTML = `
    ${sesTop("단어 학습", `남은 카드 ${total}장`)}
    <div class="card-stage">
      <div class="flashcard swipeable" id="card">
        ${isIntro ? `
          <span class="badge-new">새 단어</span>
          <div class="de">${w.de}</div>
          ${subLine}
          <div class="ko">${w.ko}</div>
          <div class="example">${w.ex}<span class="exko">${w.exKo}</span></div>` : `
          <div class="de">${w.de}</div>
          ${subLine}
          <div id="back" style="display:none">
            <div class="ko">${w.ko}</div>
            <div class="example" style="margin-top:10px">${w.ex}<span class="exko">${w.exKo}</span></div>
          </div>
          <div class="hint" id="hint">탭하면 뜻이 보여요</div>`}
        <button class="tts-btn" id="tts">발음 듣기</button>
      </div>
      <div class="swipe-tag left" id="tagL">몰라요</div>
      <div class="swipe-tag right" id="tagR">${isIntro ? "외웠어요" : "알아요"}</div>
    </div>
    ${isIntro
      ? `<div class="grade-row"><button class="g-good" id="good">외웠어요 →</button></div>`
      : `<div class="grade-row"><button class="g-again" id="again">몰라요</button><button class="g-good" id="good">알아요</button></div>`}
    <p class="hint-line">${isIntro ? "오른쪽으로 밀어서 넘기세요" : "오른쪽 = 알아요 · 왼쪽 = 몰라요"}</p>`;

  wireBack();
  const card = document.getElementById("card");
  const tagL = document.getElementById("tagL");
  const tagR = document.getElementById("tagR");
  let flipped = isIntro;

  const flip = () => {
    if (flipped) return;
    flipped = true;
    document.getElementById("back").style.display = "block";
    document.getElementById("hint").style.display = "none";
  };

  const finish = (ok) => {
    // 카드를 옆으로 날리고 다음 카드로
    card.style.transition = "transform 0.18s ease-out, opacity 0.18s";
    card.style.transform = `translateX(${ok ? 480 : -480}px) rotate(${ok ? 18 : -18}deg)`;
    card.style.opacity = "0";
    setTimeout(() => {
      if (isIntro) {
        vq.shift();
        vq.push({id: item.id, isNew: true, introPhase: false});
        nextVocabCard();
      } else {
        grade(item, ok);
      }
    }, 150);
  };

  // 스와이프 (터치+마우스 공용)
  let startX = null, startY = null, dx = 0, moved = false;
  card.addEventListener("pointerdown", e => {
    if (e.target.id === "tts") return;
    startX = e.clientX; startY = e.clientY; dx = 0; moved = false;
    try { card.setPointerCapture(e.pointerId); } catch {}
    card.style.transition = "none";
  });
  card.addEventListener("pointermove", e => {
    if (startX === null) return;
    dx = e.clientX - startX;
    if (Math.abs(dx) > 8) moved = true;
    card.style.transform = `translateX(${dx}px) rotate(${dx / 22}deg)`;
    tagR.style.opacity = dx > 30 && (flipped || isIntro || dx > 0) ? Math.min(1, dx / 100) : 0;
    tagL.style.opacity = dx < -30 ? Math.min(1, -dx / 100) : 0;
  });
  const release = () => {
    if (startX === null) return;
    tagL.style.opacity = 0; tagR.style.opacity = 0;
    if (dx > 90) { finish(true); }
    else if (dx < -90 && !isIntro) { finish(false); }
    else {
      card.style.transition = "transform 0.15s ease-out";
      card.style.transform = "";
      if (!moved) flip(); // 살짝 탭 = 뒤집기
    }
    startX = null;
  };
  card.addEventListener("pointerup", release);
  card.addEventListener("pointercancel", release);

  document.getElementById("tts").addEventListener("click", e => { e.stopPropagation(); speak(isIntro ? w.de + ". " + w.ex : w.de); });
  speak(w.de);
  const againBtn = document.getElementById("again");
  if (againBtn) againBtn.addEventListener("click", () => finish(false));
  document.getElementById("good").addEventListener("click", () => finish(true));
}

function grade(item, ok) {
  const id = item.id;
  if (!S.srs[id]) S.srs[id] = {b: 0, due: today(), intro: today()};
  if (!S.introduced.includes(id)) S.introduced.push(id);
  const rec = S.srs[id];
  if (ok) {
    rec.b = Math.min(rec.b + 1, SRS_INTERVALS.length - 1);
    rec.due = addDays(today(), SRS_INTERVALS[rec.b]);
    vq.shift();
  } else {
    rec.b = 1;
    rec.due = today();
    // 틀린 카드는 세션 뒤로 다시
    vq.push(vq.shift());
  }
  save();
  nextVocabCard();
}

function vocabExtraBtn() {
  if (unseenLeft() === 0) return null;
  return {label: "새 단어 10개 더 외우기", fn: () => { S.extraNew = (S.extraNew || 0) + 10; save(); startVocabSession(); }};
}
function drillExtraBtn() {
  return {label: "10문장 더 풀기", fn: () => { S.extraDrills = (S.extraDrills || 0) + 10; save(); startDrillSession(); }};
}

// ---------- 문장 드릴 ----------
let dq = [];
function startDrillSession() {
  const left = Math.max(0, DRILLS_PER_DAY + (S.extraDrills || 0) - S.drillsToday);
  if (left === 0) { renderDone("오늘 드릴을 모두 끝냈어요!", "내일 새 문장이 기다려요.", null, drillExtraBtn()); return; }
  const fresh = DRILLS.filter(d => !S.drillsDone.includes(d.id));
  const review = DRILLS.filter(d => S.drillsDone.includes(d.id));
  // 새 문장 우선, 부족하면 복습 문장으로 채움
  dq = [...fresh, ...review].slice(0, left).map(d => d.id);
  if (dq.length === 0) { renderDone("모든 드릴 문장을 끝냈어요!", "새 콘텐츠가 곧 추가될 거예요."); return; }
  nextDrill();
}

function normalize(s) {
  return s.toLowerCase()
    .replace(/ß/g, "ss")
    .replace(/[.,!?;:]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function nextDrill() {
  if (dq.length === 0) { markStudied(); renderDone("드릴 세션 완료", "오늘 미션을 다 채웠는지 홈에서 확인하세요.", "home", drillExtraBtn()); return; }
  const d = DRILLS.find(x => x.id === dq[0]);
  screen.innerHTML = `
    <div class="session-top"><span>문장 드릴</span><span>남은 문장 ${dq.length}개</span></div>
    <div class="drill-card">
      <div class="drill-ko">${d.ko}</div>
      <input type="text" class="drill-input" id="answer" placeholder="독일어로 입력하세요"
        autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" lang="de">
      <div class="umlaut-row">
        ${["ä","ö","ü","ß"].map(c => `<button data-ch="${c}">${c}</button>`).join("")}
      </div>
      <div id="fb"></div>
      <button class="btn big" id="check">확인</button>
    </div>`;
  const input = document.getElementById("answer");
  input.focus();
  screen.querySelectorAll("[data-ch]").forEach(b => b.addEventListener("click", () => {
    input.value += b.dataset.ch; input.focus();
  }));

  let answered = false;
  const check = () => {
    if (answered) return;
    answered = true;
    const user = normalize(input.value);
    const answers = [d.de, ...(d.alt || [])].map(normalize);
    const ok = answers.includes(user);
    input.classList.add(ok ? "ok" : "no");
    input.disabled = true;
    const fb = document.getElementById("fb");
    if (ok) {
      fb.innerHTML = `<div class="feedback ok"><span class="label">정답</span><span class="correct">${d.de}</span></div>`;
      if (!S.drillsDone.includes(d.id)) S.drillsDone.push(d.id);
      S.drillsToday++;
      dq.shift();
    } else {
      fb.innerHTML = `<div class="feedback no"><span class="label">오답 · 정답은</span><span class="correct">${d.de}</span>
        <span class="note">${d.note}</span></div>`;
      // 틀린 문장은 세션 끝에 한 번 더
      dq.push(dq.shift());
    }
    save();
    speak(d.de);
    document.getElementById("check").textContent = "다음 →";
    answered = "next";
  };
  document.getElementById("check").addEventListener("click", () => {
    if (answered === "next") nextDrill(); else check();
  });
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") { if (answered === "next") nextDrill(); else check(); }
  });
}

// ---------- 찍기 (관사·대명사 즉시 암기) ----------
function renderDeckHub() {
  backFn = null;
  const deckDone = S.deckToday || 0;
  screen.innerHTML = `
    <div class="panel">
      <h2>관사·대명사 찍기 · 오늘 ${deckDone}/${DECK_GOAL}</h2>
      <p class="sub">한국어를 보고 독일어를 <b>바로 튀어나오게</b> 만드는 반복 훈련이에요.<br>카드를 탭하면 답이 보이고, 알면 오른쪽·모르면 왼쪽으로 넘기세요.</p>
      <button class="btn big" id="deckAll">전체 섞어서 시작 (${DECK.reduce((n,c)=>n+c.cards.length,0)}장)</button>
    </div>
    <div class="panel">
      <h2>주제별 연습</h2>
      <div class="gram-list">
        ${DECK.map((c, i) => `<button class="gram-row" data-di="${i}">
          <span class="gram-num">${c.cards.length}</span>
          <span class="gram-row-title">${c.cat}</span>
          <span class="gram-state">▶</span>
        </button>`).join("")}
      </div>
    </div>`;
  document.getElementById("deckAll").addEventListener("click", () => {
    const all = [];
    DECK.forEach(c => c.cards.forEach(([q, a]) => all.push({q, a, cat: c.cat})));
    runDeck(shuffle(all), "전체 섞기");
  });
  screen.querySelectorAll("[data-di]").forEach(b => b.addEventListener("click", () => {
    const c = DECK[parseInt(b.dataset.di)];
    runDeck(shuffle(c.cards.map(([q, a]) => ({q, a, cat: c.cat}))), c.cat);
  }));
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let deckQ = [];
function runDeck(cards, label) {
  deckQ = cards.slice();
  deckLabel = label;
  deckTotal = cards.length;
  nextDeckCard();
}
let deckLabel = "", deckTotal = 0;

function nextDeckCard() {
  backFn = renderDeckHub;
  if (deckQ.length === 0) {
    renderDone("찍기 완료", `${deckLabel} 한 바퀴를 다 돌았어요. 내일 또 반복!`, null,
      {label: "한 번 더 섞어서", fn: renderDeckHub});
    return;
  }
  const c = deckQ[0];
  const doneN = deckTotal - deckQ.length + 1;
  screen.innerHTML = `
    ${sesTop(deckLabel, `${doneN} / ${deckTotal}`)}
    <div class="card-stage">
      <div class="flashcard swipeable deck-card" id="card">
        <div class="deck-cat">${c.cat}</div>
        <div class="deck-prompt">${c.q}</div>
        <div id="back" style="display:none">
          <div class="deck-answer">${c.a}</div>
        </div>
        <div class="hint" id="hint">탭하면 정답이 보여요</div>
      </div>
      <div class="swipe-tag left" id="tagL">모름</div>
      <div class="swipe-tag right" id="tagR">외움</div>
    </div>
    <div class="grade-row"><button class="g-again" id="again">모름</button><button class="g-good" id="good">외움</button></div>
    <p class="hint-line">오른쪽 = 외움 · 왼쪽 = 다시</p>`;
  wireBack();

  const card = document.getElementById("card");
  const tagL = document.getElementById("tagL");
  const tagR = document.getElementById("tagR");
  let flipped = false;
  const flip = () => {
    if (flipped) return;
    flipped = true;
    document.getElementById("back").style.display = "block";
    document.getElementById("hint").style.display = "none";
    speak(c.a);
  };
  const finish = (ok) => {
    card.style.transition = "transform 0.18s ease-out, opacity 0.18s";
    card.style.transform = `translateX(${ok ? 480 : -480}px) rotate(${ok ? 18 : -18}deg)`;
    card.style.opacity = "0";
    setTimeout(() => {
      deckQ.shift();
      if (ok) { S.deckToday = (S.deckToday || 0) + 1; save(); }
      else { deckQ.push(c); }   // 모르면 뒤로 다시
      nextDeckCard();
    }, 150);
  };
  let startX = null, dx = 0, moved = false;
  card.addEventListener("pointerdown", e => {
    startX = e.clientX; dx = 0; moved = false;
    try { card.setPointerCapture(e.pointerId); } catch {}
    card.style.transition = "none";
  });
  card.addEventListener("pointermove", e => {
    if (startX === null) return;
    dx = e.clientX - startX;
    if (Math.abs(dx) > 8) moved = true;
    card.style.transform = `translateX(${dx}px) rotate(${dx / 22}deg)`;
    tagR.style.opacity = dx > 30 ? Math.min(1, dx / 100) : 0;
    tagL.style.opacity = dx < -30 ? Math.min(1, -dx / 100) : 0;
  });
  const release = () => {
    if (startX === null) return;
    tagL.style.opacity = 0; tagR.style.opacity = 0;
    if (!flipped && Math.abs(dx) < 10) { flip(); startX = null; return; }
    if (dx > 90 && flipped) finish(true);
    else if (dx < -90 && flipped) finish(false);
    else { card.style.transition = "transform 0.15s ease-out"; card.style.transform = ""; if (!moved && !flipped) flip(); }
    startX = null;
  };
  card.addEventListener("pointerup", release);
  card.addEventListener("pointercancel", release);
  document.getElementById("again").addEventListener("click", () => { if (!flipped) flip(); else finish(false); });
  document.getElementById("good").addEventListener("click", () => { if (!flipped) flip(); else finish(true); });
}

// ---------- 오늘의 문법 (설명 + Sprachbausteine식 퀴즈) ----------
function grammarCap() { return GRAMMAR_PER_DAY + (S.extraGrammar || 0); }
function grammarStatus() {
  const doneCount = S.grammarToday || 0;
  const next = GRAMMAR.find(g => !S.grammarDone.includes(g.id));
  if (!next) return {doneToday: true, g: null, detail: "모든 레슨 완료"};
  if (doneCount >= grammarCap()) return {doneToday: true, g: next, detail: `오늘 ${doneCount}레슨 완료${(S.extraGrammar||0) > 0 ? ` (+${S.extraGrammar} 추가)` : ""}`};
  return {doneToday: false, g: next, detail: `오늘 ${doneCount}/${GRAMMAR_PER_DAY}레슨 · 다음: ${next.title}`};
}

// 퀴즈 엔진: mode = "lesson"(오늘 진도) | "practice"(복습) | "wrong"(오답 다시 풀기)
let qz = null; // {list:[{g, qi}], pos, correct, mode, lesson}

// 문법 허브: 오늘 레슨 + 오답 복습 + 전체 판
function renderGrammar() {
  const st = grammarStatus();
  const wrongN = (S.wrongQ || []).length;
  const doneN = S.grammarDone.length;
  screen.innerHTML = `
    <div class="panel">
      <h2>오늘의 문법</h2>
      <div class="task-row">
        <div class="task-left">
          <div class="task-name">${st.g ? st.g.title : "모든 레슨 완료"}</div>
          <div class="task-detail">${st.detail}</div>
        </div>
        ${!st.doneToday && st.g ? `<button class="btn" id="startlesson">시작</button>`
          : st.g ? `<button class="btn secondary" id="extraLesson">+1개 더</button>` : `<span class="task-done">완료</span>`}
      </div>
      ${wrongN > 0 ? `
      <div class="task-row">
        <div class="task-left">
          <div class="task-name">오답 다시 풀기</div>
          <div class="task-detail">오늘 틀린 문제 ${wrongN}개 — 맞히면 목록에서 빠져요</div>
        </div>
        <button class="btn" id="startwrong">시작</button>
      </div>` : ""}
      <div class="task-row">
        <div class="task-left">
          <div class="task-name">실전 모의 (섞어서)</div>
          <div class="task-detail">${doneN > 0 ? `배운 ${doneN}개 레슨` : "전체 레슨"}에서 10문제 무작위 — 시험처럼</div>
        </div>
        <button class="btn secondary" id="startmixed">시작</button>
      </div>
    </div>
    <div class="panel">
      <h2>문법 전체 보기 · ${doneN}/${GRAMMAR.length} 완료</h2>
      <div class="gram-list">
        ${GRAMMAR.map((g, i) => {
          const done = S.grammarDone.includes(g.id);
          const isNext = st.g && st.g.id === g.id && !st.doneToday;
          return `<button class="gram-row" data-gid="${g.id}">
            <span class="gram-num${done ? " done" : ""}">${i + 1}</span>
            <span class="gram-row-title">${g.title}</span>
            <span class="gram-state">${done ? "완료" : isNext ? "오늘" : ""}</span>
          </button>`;
        }).join("")}
      </div>
      <p class="sub" style="margin-top:12px">레슨을 누르면 자세한 설명이 펼쳐져요</p>
    </div>`;
  const sl = document.getElementById("startlesson");
  if (sl) sl.addEventListener("click", startTodayLesson);
  const ex = document.getElementById("extraLesson");
  if (ex) ex.addEventListener("click", () => { S.extraGrammar = (S.extraGrammar || 0) + 1; save(); startTodayLesson(); });
  const sw = document.getElementById("startwrong");
  if (sw) sw.addEventListener("click", startWrongQuiz);
  const sm = document.getElementById("startmixed");
  if (sm) sm.addEventListener("click", startMixedQuiz);
  screen.querySelectorAll("[data-gid]").forEach(b => b.addEventListener("click", () => renderGrammarDetail(b.dataset.gid)));
}

function startMixedQuiz() {
  // 배운 레슨(없으면 전체)에서 문제 풀을 만들어 10개 무작위 출제
  const pool = [];
  const source = S.grammarDone.length > 0
    ? GRAMMAR.filter(g => S.grammarDone.includes(g.id))
    : GRAMMAR;
  source.forEach(g => g.quiz.forEach((q, i) => pool.push({g, qi: i})));
  const picked = shuffle(pool).slice(0, 10);
  if (picked.length === 0) { renderGrammar(); return; }
  qz = {list: picked, pos: 0, correct: 0, mode: "mixed", lesson: null};
  nextQuizQ();
}

function startTodayLesson() {
  const st = grammarStatus();
  if (!st.g || st.doneToday) { renderGrammar(); return; }
  renderLessonIntro(st.g, "lesson");
}

function renderLessonIntro(g, mode) {
  const num = GRAMMAR.indexOf(g) + 1;
  backFn = renderGrammar;
  screen.innerHTML = `
    ${sesTop(mode === "lesson" ? `오늘의 문법 ${(S.grammarToday||0)+1} / ${grammarCap()}` : "복습", `레슨 ${num} / ${GRAMMAR.length}`)}
    <div class="gram-card">
      <div class="gram-title">${g.title}</div>
      <div class="gram-rule">${g.rule}</div>
      ${g.tip ? `<div class="gram-signal"><span class="sig-label">시그널</span>${g.tip}</div>` : ""}
    </div>
    <button class="btn big" id="startquiz">문제 풀기 (${g.quiz.length}문제)</button>
    <button class="btn big secondary" id="detailbtn">자세한 설명 보기</button>`;
  wireBack();
  document.getElementById("startquiz").addEventListener("click", () => startQuiz(g, mode));
  document.getElementById("detailbtn").addEventListener("click", () => renderGrammarDetail(g.id, {g, mode}));
}

// 자세한 설명 화면 (전체 판에서 레슨을 눌렀을 때)
function renderGrammarDetail(gid, backToLesson) {
  const g = GRAMMAR.find(x => x.id === gid);
  if (!g) { renderGrammar(); return; }
  const num = GRAMMAR.indexOf(g) + 1;
  backFn = backToLesson ? () => renderLessonIntro(backToLesson.g, backToLesson.mode) : renderGrammar;
  screen.innerHTML = `
    ${sesTop("문법 자세히 보기", `레슨 ${num} / ${GRAMMAR.length}`)}
    <div class="gram-card">
      <div class="gram-title">${g.title}</div>
      ${g.tip ? `<div class="gram-signal"><span class="sig-label">시그널</span>${g.tip}</div>` : ""}
      <div class="gram-detail">${g.detail || g.rule}</div>
    </div>
    ${backToLesson
      ? `<button class="btn big" id="backlesson">레슨으로 돌아가기</button>`
      : `<button class="btn big" id="practice">이 레슨 문제 풀기 (복습)</button>
         <button class="btn big secondary" id="backhub">전체 목록으로</button>`}`;
  wireBack();
  const bl = document.getElementById("backlesson");
  if (bl) bl.addEventListener("click", () => renderLessonIntro(backToLesson.g, backToLesson.mode));
  const pr = document.getElementById("practice");
  if (pr) pr.addEventListener("click", () => startQuiz(g, "practice"));
  const bh = document.getElementById("backhub");
  if (bh) bh.addEventListener("click", renderGrammar);
}

function startQuiz(g, mode) {
  qz = {list: g.quiz.map((q, i) => ({g, qi: i})), pos: 0, correct: 0, mode, lesson: g};
  nextQuizQ();
}

function startWrongQuiz() {
  const items = (S.wrongQ || []).map(k => {
    const [gid, qi] = k.split(":");
    const g = GRAMMAR.find(x => x.id === gid);
    return g ? {g, qi: parseInt(qi)} : null;
  }).filter(Boolean);
  if (items.length === 0) { renderGrammar(); return; }
  qz = {list: items, pos: 0, correct: 0, mode: "wrong", lesson: null};
  nextQuizQ();
}

function nextQuizQ() {
  if (qz.pos >= qz.list.length) { finishQuiz(); return; }
  const {g, qi} = qz.list[qz.pos];
  const item = g.quiz[qi];
  // 보기 섞기 (정답은 opts[0])
  const opts = item.opts.map((t, i) => ({t, correct: i === 0}));
  for (let i = opts.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [opts[i], opts[j]] = [opts[j], opts[i]];
  }
  const abc = ["a", "b", "c"];
  const label = qz.mode === "wrong" ? "오답 다시 풀기" : qz.mode === "mixed" ? "실전 모의" : g.title;
  backFn = renderGrammar;
  screen.innerHTML = `
    ${sesTop(label, `문제 ${qz.pos + 1} / ${qz.list.length}`)}
    <div class="quiz-card">
      <div class="quiz-q">${item.q.replace("___", `<span class="gap">___</span>`)}</div>
      <div class="quiz-opts">
        ${opts.map((o, i) => `<button class="opt" data-i="${i}"><span class="abc">${abc[i]}</span>${o.t}</button>`).join("")}
      </div>
      <div id="qfb"></div>
      <button class="btn big" id="qnext" style="display:none">다음 →</button>
    </div>`;
  wireBack();
  let answered = false;
  screen.querySelectorAll(".opt").forEach(btn => btn.addEventListener("click", () => {
    if (answered) return;
    answered = true;
    const picked = opts[parseInt(btn.dataset.i)];
    const correctText = item.opts[0];
    screen.querySelectorAll(".opt").forEach((b, i) => {
      b.disabled = true;
      if (opts[i].correct) b.classList.add("right");
      else if (b === btn) b.classList.add("wrong");
    });
    // 오답 기록: 틀리면 등록, (오답 복습에서) 맞히면 제거
    const key = g.id + ":" + qi;
    if (!S.wrongQ) S.wrongQ = [];
    if (picked.correct) {
      qz.correct++;
      const ix = S.wrongQ.indexOf(key);
      if (ix >= 0) S.wrongQ.splice(ix, 1);
    } else {
      if (!S.wrongQ.includes(key)) S.wrongQ.push(key);
    }
    save();
    const fullSentence = item.q.replace("___", `<u>${correctText}</u>`);
    document.getElementById("qfb").innerHTML = `
      <div class="feedback ${picked.correct ? "ok" : "no"}">
        <span class="label">${picked.correct ? "정답" : "오답 · 정답 문장"}</span>
        <span class="correct sentence">${fullSentence}</span>
        <span class="note">${item.why}</span>
      </div>`;
    speak(item.q.replace("___", correctText));
    document.getElementById("qnext").style.display = "block";
  }));
  document.getElementById("qnext").addEventListener("click", () => { qz.pos++; nextQuizQ(); });
}

function finishQuiz() {
  if (qz.mode === "lesson") {
    const g = qz.lesson;
    if (!S.grammarDone.includes(g.id)) S.grammarDone.push(g.id);
    S.grammarToday = (S.grammarToday || 0) + 1;
    markStudied();
    save();
    const lessonsLeft = GRAMMAR.some(x => !S.grammarDone.includes(x.id));
    const more = (S.grammarToday < grammarCap()) && lessonsLeft;
    const wrongN = (S.wrongQ || []).length;
    screen.innerHTML = `
      <div class="done-box panel">
        <div class="rule"></div>
        <h2>레슨 완료 · ${qz.correct} / ${qz.list.length} 정답</h2>
        <p class="sub">${g.title}</p>
        ${more ? `<button class="btn big" id="nextlesson">다음 레슨 →</button>`
               : lessonsLeft ? `<button class="btn big" id="extralesson">레슨 1개 더 풀기</button>` : ""}
        ${wrongN ? `<button class="btn big secondary" id="gowrong">오늘 오답 ${wrongN}개 다시 풀기</button>` : ""}
        <button class="btn big secondary" data-go="home">홈으로</button>
      </div>`;
    const nl = document.getElementById("nextlesson");
    if (nl) nl.addEventListener("click", startTodayLesson);
    const el = document.getElementById("extralesson");
    if (el) el.addEventListener("click", () => { S.extraGrammar = (S.extraGrammar || 0) + 1; save(); startTodayLesson(); });
    const gw = document.getElementById("gowrong");
    if (gw) gw.addEventListener("click", startWrongQuiz);
    screen.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => setTab(b.dataset.go)));
  } else if (qz.mode === "wrong") {
    const remain = (S.wrongQ || []).length;
    renderDone(
      remain === 0 ? "오답 정리 완료!" : `오답 복습 끝 · ${remain}개 남음`,
      remain === 0 ? "오늘 틀린 문제를 전부 맞혔어요." : "아직 틀리는 문제는 바로 한 번 더 돌 수 있어요.",
      null,
      remain > 0 ? {label: `남은 오답 ${remain}개 다시 풀기`, fn: startWrongQuiz} : null);
  } else if (qz.mode === "mixed") {
    const score = Math.round(qz.correct / qz.list.length * 100);
    renderDone(`실전 모의 결과 · ${qz.correct} / ${qz.list.length} (${score}점)`,
      score >= 60 ? "telc 합격선(60%)을 넘겼어요!" : "아직 60% 아래예요. 오답을 복습해봐요.",
      null,
      {label: "다시 섞어서 풀기", fn: startMixedQuiz});
  } else {
    renderDone(`복습 완료 · ${qz.correct} / ${qz.list.length} 정답`, qz.lesson.title, null,
      {label: "문법 전체 목록으로", fn: renderGrammar});
  }
}

// ---------- 완료 화면 ----------
function renderDone(title, sub, nextTab, extra) {
  renderTop();
  screen.innerHTML = `
    <div class="done-box panel">
      <div class="rule"></div>
      <h2>${title}</h2>
      <p class="sub">${sub}</p>
      ${nextTab ? `<button class="btn big" data-go="${nextTab}">계속하기 →</button>` : ""}
      ${extra ? `<button class="btn big ${nextTab ? "secondary" : ""}" id="extrabtn">${extra.label}</button>` : ""}
      <button class="btn big secondary" data-go="home">홈으로</button>
    </div>`;
  screen.querySelectorAll("[data-go]").forEach(b => b.addEventListener("click", () => setTab(b.dataset.go)));
  if (extra) document.getElementById("extrabtn").addEventListener("click", extra.fn);
}

// ---------- 설정 ----------
function renderSettings() {
  screen.innerHTML = `
    <div class="panel">
      <h2>설정</h2>
      <div class="set-row">
        <label>시험 날짜</label>
        <input type="date" id="exam" value="${S.examDate}">
      </div>
      <div class="set-row">
        <label>하루 새 단어 수</label>
        <select id="npd">
          ${[10,20,30,40].map(n => `<option value="${n}" ${S.newPerDay===n?"selected":""}>${n}개</option>`).join("")}
        </select>
      </div>
    </div>
    <div class="panel">
      <h2>콘텐츠 현황</h2>
      <p class="sub">배치 1 (A2 핵심, A1 건너뜀): 단어 ${VOCAB.length}개 · 드릴 ${DRILLS.length}문장 · 문법 ${GRAMMAR.length}레슨(문제 ${GRAMMAR.reduce((n,g)=>n+g.quiz.length,0)}개)<br>
      다음 배치가 매주 추가돼요. 최종 목표: telc B1 어휘 2,400개.</p>
    </div>
    <div class="panel">
      <button class="btn ghost" id="reset">학습 기록 초기화</button>
    </div>`;
  document.getElementById("exam").addEventListener("change", e => { S.examDate = e.target.value; save(); renderTop(); });
  document.getElementById("npd").addEventListener("change", e => { S.newPerDay = parseInt(e.target.value); save(); });
  document.getElementById("reset").addEventListener("click", () => {
    if (confirm("모든 학습 기록이 지워져요. 정말 초기화할까요?")) {
      localStorage.removeItem(STORE_KEY);
      location.reload();
    }
  });
}

// 시작
renderTop();
renderHome();
