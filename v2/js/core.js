// 교사용·학생용이 함께 쓰는 도구: 저장소, AI 호출, 대기 표시, 알림, 탐지.
// 저장소는 지금은 브라우저 localStorage(같은 브라우저의 탭끼리 실시간 동기화)이고,
// Firebase 단계에서 같은 함수 이름으로 Firestore 구현을 바꿔 끼운다.

export const $ = s => document.querySelector(s);
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export const now = () => { const d = new Date(); return [d.getHours(), d.getMinutes(), d.getSeconds()].map(x => String(x).padStart(2, "0")).join(":"); };
export const hm = t => t ? t.slice(0, 5) : "";
export const clone = o => JSON.parse(JSON.stringify(o));
export const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function loadLesson(id = "high-refugee") {
  const r = await fetch(`data/${id}.json`, { cache: "no-cache" });
  if (!r.ok) throw new Error("수업 자료를 불러오지 못했습니다.");
  return r.json();
}

export async function sha(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

// ---------- 알림(toast) ----------
export function toast(msg, isErr = false) {
  const el = document.createElement("div");
  el.className = "toast" + (isErr ? " err" : "");
  el.setAttribute("role", isErr ? "alert" : "status");
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), isErr ? 5000 : 2200);
}

// ---------- 연결 상태 ----------
export function netChip() {
  return navigator.onLine ? `<span class="net on">연결됨</span>` : `<span class="net off">오프라인 · 다시 연결되면 저장됩니다</span>`;
}

// ---------- 저장소 ----------
// 문서 하나 = 수업 하나: { session:{...}, groups:{ "1":{members,work,logs,alerts}, ... } }
const KEY = code => `aieps.v2.s.${code}`;
const IDX = "aieps.v2.index";
const listeners = new Map();

export const store = {
  kind: "local",
  list() { try { return JSON.parse(localStorage.getItem(IDX) || "[]"); } catch { return []; } },
  get(code) { try { const s = localStorage.getItem(KEY(code)); return s ? JSON.parse(s) : null; } catch { return null; } },
  create(doc) {
    localStorage.setItem(KEY(doc.session.code), JSON.stringify(doc));
    const idx = this.list().filter(c => c !== doc.session.code); idx.unshift(doc.session.code);
    localStorage.setItem(IDX, JSON.stringify(idx));
  },
  remove(code) {
    localStorage.removeItem(KEY(code));
    localStorage.setItem(IDX, JSON.stringify(this.list().filter(c => c !== code)));
  },
  // 읽고-고치고-쓰기. fn이 문서를 직접 고친다. 같은 탭의 구독자에게도 알린다.
  update(code, fn) {
    const doc = this.get(code); if (!doc) throw new Error("수업을 찾을 수 없습니다.");
    fn(doc);
    localStorage.setItem(KEY(code), JSON.stringify(doc));
    (listeners.get(code) || []).forEach(cb => cb(doc, true));
    return doc;
  },
  subscribe(code, cb) {
    if (!listeners.has(code)) listeners.set(code, []);
    listeners.get(code).push(cb);
  }
};
window.addEventListener("storage", e => {
  if (!e.key || !e.key.startsWith("aieps.v2.s.")) return;
  const code = e.key.slice("aieps.v2.s.".length);
  const doc = e.newValue ? JSON.parse(e.newValue) : null;
  (listeners.get(code) || []).forEach(cb => cb(doc, false));
});

export function newCode() {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let c = ""; for (let i = 0; i < 6; i++) c += A[Math.floor(Math.random() * A.length)];
  return store.get(c) ? newCode() : c;
}

// 모둠 하나의 작업 기록 초기값(견본 high/index.html의 상태와 같은 짜임)
export function emptyWork(D) {
  return {
    s1: { qs: [], sealed: false, sealT: "", chat: [], phase: 0, qs2: [], discuss: "", sealed2: false, sealT2: "", halted: false, deadline: null, first: true, endT: "" },
    s2: { qa: Array(D.qa.length).fill(""), cls: {}, life: { same: "", place: "", impact: "", act: "" }, guesses: [], vq: [] },
    s3: { sealed: false, sealT: "", rows: [], links: [], root: "", coreC: "", coreE: "", done: false, doneT: "" },
    s4: { pinned: false, pinT: "", coreEdit: "", notes: D.cases.map(() => ({ idea: "" })), alts: [], sealed: false, sealT: "", fb: null, first: null, improve: "" },
    s5: { preds: [], sealed: false, sealT: "", scen: null, sum: { A: "", B: "", C: "" }, diff: { A: "", B: "", C: "" }, pick: "", why: "", whySaved: false, whyT: "", newp: "" },
    s6: { level: "", types: [], typeWhy: "", scope: "", prop: { ask: "", reply: "", effect: "" }, plans: [{ target: "", content: "", how: "", channel: "" }], when: "", chk: [false, false], tok: false, tokT: "", tnote: "", back: [], resOpen: false, res: { how: "", what: "" } },
    s7: { problem: "", peers: [], peer: {}, note: {}, chk: Array(D.refl.length).fill(""), r1: "", r2: "", posted: false }
  };
}
export function emptyGroup(D) { return { members: {}, work: emptyWork(D), logs: [], alerts: [] }; }

export function newSession(D, { title, groups = 7, teacher = "" }) {
  const code = newCode();
  const rev = {}; D.help.forEach(h => { rev[h.k] = h.seq ? { all: 0, g: {}, t: "" } : { all: false, g: {}, t: "" }; });
  const doc = {
    session: {
      code, lessonId: D.id, title: title || D.meta.title, teacher, groups, status: "open", rehearsal: true,
      createdAt: Date.now(), open: 1, ai: {}, req: {}, rev, broadcasts: [], checks: {}
    },
    groups: {}
  };
  for (let g = 1; g <= groups; g++) doc.groups[g] = emptyGroup(D);
  store.create(doc);
  return doc;
}

// ---------- 공개 상태(도움 자료) ----------
// 일반 자료: all=true면 전체, g[n]=true면 그 모둠만. 유사 사례(seq): 공개 건수.
export function helpVisFor(sess, k, g) {
  const r = sess.rev[k]; if (!r) return false;
  if (typeof r.all === "number") return Math.max(r.all, (r.g || {})[g] || 0);
  return !!(r.all || (r.g || {})[g]);
}

// 원문 대조를 마친 자료만 학생에게 보인다. 리허설 모드에서는 확인 대기 자료도 보인다.
export function itemVisible(sess, item, id) {
  return !!(item.checked || (sess.checks || {})[id] || sess.rehearsal);
}

// ---------- 단계 완료 판정(견본과 같은 기준) ----------
export function stageDone(W, n) {
  switch (n) {
    case 1: return W.s1.phase >= 4;
    case 2: return W.s3.sealed;
    case 3: return W.s3.done;
    case 4: return W.s4.first !== null && W.s4.improve.trim().length > 5;
    case 5: return W.s5.whySaved && W.s5.newp.trim().length > 5;
    case 6: return !!(W.s6.level && W.s6.types.length && W.s6.scope && W.s6.plans.some(p => p.target && p.content) && W.s6.back.length);
    case 7: return W.s7.chk.every(Boolean) && W.s7.r1.trim().length > 5;
  }
  return false;
}

// ---------- Red 탐지: 학생 입력과 AI 응답의 글자 3-gram 겹침 ----------
export function aiTexts(W) {
  const o = [];
  W.s1.chat.forEach(m => { if (m.r === "ai" && !m.wait) o.push(m.x); });
  W.s3.rows.forEach(r => { if (r.ans) o.push(r.ans); if (r.fu) o.push(r.fu); });
  if (W.s4.fb) W.s4.fb.forEach(f => o.push(f.s.join(" ") + " " + f.w.join(" ")));
  if (W.s5.scen) ["A", "B", "C"].forEach(k => o.push(W.s5.scen[k].story.join(" ")));
  return o;
}
function grams(s) { s = String(s).replace(/[\s.,!?·'"“”‘’()\-:;~…]/g, ""); const g = new Set(); for (let i = 0; i + 3 <= s.length; i++) g.add(s.slice(i, i + 3)); return g; }
export function overlapWith(txt, arr) {
  const a = grams(txt || ""); if (a.size < 6) return null;
  let best = 0;
  arr.forEach(t => { const b = grams(t); let h = 0; a.forEach(x => { if (b.has(x)) h++; }); best = Math.max(best, h / a.size); });
  return best;
}
// 재구성 점검 대상 칸: 학생 화면과 교사 평가 지표가 같은 목록을 쓴다.
export function redFields(W) {
  const f = [];
  W.s3.rows.forEach((r, i) => f.push([`s3-sum-${i}`, `3-1 응답 핵심(질문 ${i + 1})`, r.sum, 3]));
  f.push(["s3-core", "핵심 원인 문장", W.s3.coreC + " " + W.s3.coreE, 3]);
  (W.s4.fb || []).forEach((x, i) => f.push([`s4-sum-${i}`, `4-4 강점·약점 요약(대안 ${i + 1})`, x.sum, 4]));
  f.push(["s4-improve", "1순위 대안과 보완 내용", W.s4.improve, 4]);
  ["A", "B", "C"].forEach(k => f.push([`s5-sum-${k}`, `5-3 눈에 띈 장면(${k})`, W.s5.sum[k], 5]));
  f.push(["s5-why", "시나리오 선택 이유", W.s5.why, 5]);
  f.push(["s5-newp", "예상하지 못한 문제", W.s5.newp, 5]);
  return f;
}

// ---------- AI 호출 ----------
// mode "demo": 견본의 미리 넣은 예시 응답. mode "server": Cloud Functions 중계(Firebase 단계에서 연결).
export function fill(t, v) { return t.replace(/\{\{(\w+)\}\}/g, (m, k) => v[k] ?? ""); }
export function prompts(D) {
  const P = D.prompts;
  return {
    persona: () => P.persona,
    search: q => fill(P.search, { q }),
    follow: (q, a) => fill(P.follow, { q, a }),
    feedback: (core, alts) => fill(P.feedback, { core, alts: alts.map((a, i) => `${i + 1}. [${a.actor}] ${a.txt}`).join("\n") }),
    scenario: (alt, preds) => fill(P.scenario, { alt, preds: preds.map(p => fill(P.scenarioPredFmt, { who: p.who, ex: p.ex ? " (목소리를 내기 어려운 이해관계자)" : "", txt: p.txt, reason: p.reason ? " (이유: " + p.reason + ")" : "" })).join("\n") })
  };
}

export function makeAI(D, mode = "demo") {
  const re = s => new RegExp(s);
  const personaCanned = q => { for (const c of D.persona.canned) if (re(c.re).test(q)) return c.a; return D.persona.def; };
  const searchCanned = q => { for (const r of D.searchDemo.rules) if (re(r.re).test(q)) return D.searchDemo.items[r.k]; return D.searchDemo.def; };
  // 시연 응답도 실제처럼 조금씩 흘려보낸다(스트리밍). 기다리는 동안 화면이 멈춘 것처럼 보이지 않게.
  async function stream(text, onText) {
    await sleep(500);
    for (let i = 0; i < text.length; i += 3) { onText && onText(text.slice(0, i + 3)); await sleep(18); }
    return text;
  }
  const server = () => { throw Object.assign(new Error("서버 AI가 아직 연결되지 않았습니다."), { code: "not_configured" }); };
  return {
    mode,
    personaCanned, searchCanned,
    async persona(q, first, onText) {
      if (mode === "server") server();
      return stream((first ? D.persona.pre : "") + personaCanned(q), onText);
    },
    async search(q) { if (mode === "server") server(); await sleep(900); const o = searchCanned(q); return { a: o.a, src: o.src.slice() }; },
    async follow() { if (mode === "server") server(); await sleep(700); return D.searchDemo.follow; },
    async feedback(core, alts) {
      if (mode === "server") server(); await sleep(1100);
      return alts.map(a => { const f = D.feedbackDemo[a.actor] || D.feedbackDemo["세계시민"]; return { s: f.s.slice(), w: f.w.slice() }; });
    },
    async scenarios() { if (mode === "server") server(); await sleep(1600); return clone(D.scenarioDemo); }
  };
}

// ---------- 기다리는 동안 보이는 표시 ----------
// 경과 시간에 따라 안내 문구가 바뀐다. since를 문서에 두면 화면을 다시 그려도 시간이 이어진다.
export const WAIT = {
  chat: [[0, "유수프가 답을 떠올리는 중이에요"], [12, "조금 길게 생각하고 있어요"], [30, "응답이 늦어지고 있어요. 화면을 닫지 말고 기다려 주세요"]],
  ai: [[0, "AI가 응답을 쓰는 중이에요"], [10, "자료를 정리하는 중이에요"], [30, "평소보다 오래 걸려요. 화면을 닫지 말아 주세요"], [80, "계속 안 되면 선생님께 알려 주세요"]],
  join: [[0, "수업에 들어가는 중이에요"], [6, "모둠 자리를 준비하고 있어요"]]
};
export function waitHtml({ steps = WAIT.ai, since = Date.now(), compact = false } = {}) {
  const secs = Math.max(0, Math.floor((Date.now() - since) / 1000));
  const msg = [...steps].reverse().find(([t]) => secs >= t)?.[1] ?? steps[0][1];
  return `<div class="wait${compact ? " compact" : ""}" role="status" aria-live="polite" data-since="${since}" data-steps="${esc(JSON.stringify(steps))}"><span class="wait-dot" aria-hidden="true"><i></i><i></i><i></i></span><span class="wait-msg">${esc(msg)}</span><span class="wait-sec">${secs}초</span></div>`;
}
export function tickWaits() {
  const t = Date.now();
  document.querySelectorAll(".wait[data-since]").forEach(el => {
    const secs = Math.max(0, Math.floor((t - Number(el.dataset.since)) / 1000));
    let steps; try { steps = JSON.parse(el.dataset.steps); } catch { return; }
    const msg = [...steps].reverse().find(([s]) => secs >= s)?.[1];
    const m = el.querySelector(".wait-msg"), s = el.querySelector(".wait-sec");
    if (m && msg && m.textContent !== msg) m.textContent = msg;
    if (s) s.textContent = secs + "초";
  });
}
setInterval(tickWaits, 1000);

// ---------- 문서 변경(교사 화면과 학생 화면의 시연 버튼이 같은 함수를 쓴다) ----------
export function pushLog(grp, stage, kind, text) { grp.logs.push({ t: now(), stage, kind, text }); }
export function pushAlert(grp, stage, kind, text, ref) {
  if (ref && grp.alerts.some(a => a.ref === ref && !a.done)) return false;
  grp.alerts.push({ id: grp.alerts.length + 1, t: now(), stage, kind, text, ref: ref || "", done: false });
  return true;
}
// 선생님이 봉인된 산출물을 확인하고 그 단계의 AI를 연다. 1단계는 1차 대화 4분이 시작된다.
export function openAI(doc, g, n) {
  const s = doc.session, grp = doc.groups[g];
  (s.ai[g] = s.ai[g] || {})[n] = true;
  if (s.req[g]) delete s.req[g][n];
  pushLog(grp, n, "open", `${n}단계 AI 열기`);
  const s1 = grp.work.s1;
  if (n === 1 && s1.phase === 0 && s1.sealed) {
    s1.phase = 1; s1.chat.push({ r: "sys", x: "선생님이 대화를 열었습니다. 1차 대화는 4분입니다." }); s1.deadline = Date.now() + 240000;
  }
}
export function requestFix(doc, g, n, msg) {
  const s = doc.session;
  (s.req[g] = s.req[g] || {})[n] = msg || "산출물을 보완해 다시 저장해 봅시다.";
  pushLog(doc.groups[g], n, "help", `${n}단계 보완 요청: ${s.req[g][n]}`);
}
export function revealHelp(doc, D, k, mode, g) {
  const r = doc.session.rev[k], h = D.help.find(x => x.k === k);
  if (h.seq) {
    if (mode === "hide") { r.all = 0; r.g = {}; }
    else if (mode === "all") r.all = Math.min(D.cases.length, r.all + 1);
    else r.g[g] = Math.min(D.cases.length, Math.max(r.all, r.g[g] || 0) + 1);
  } else {
    if (mode === "hide") { r.all = false; r.g = {}; }
    else if (mode === "all") r.all = true;
    else r.g[g] = true;
  }
  r.t = now();
  const label = mode === "hide" ? "숨김" : mode === "all" ? "전체 공개" : `${g}모둠 공개`;
  const targets = mode === "all" || mode === "hide" ? Object.keys(doc.groups) : [g];
  targets.forEach(x => pushLog(doc.groups[x], h.stage, "help", `${h.name} ${label}`));
}
export function resolveAlert(doc, g, id, res, resume) {
  const grp = doc.groups[g], al = grp.alerts.find(x => x.id === id); if (!al) return;
  al.done = true; al.res = res;
  if (resume) { grp.work.s1.halted = false; grp.work.s1.chat.push({ r: "sys", x: "선생님이 확인했습니다. 대화를 이어 갑니다." }); }
  pushLog(grp, al.stage, "open", "알림 처리: " + res);
}
export function teacherCheck6(doc, g, note) {
  const s6 = doc.groups[g].work.s6; s6.tok = true; s6.tokT = now(); s6.tnote = note || "";
  pushLog(doc.groups[g], 6, "open", "제출 전 교사 확인");
}

// 문제 해결 흐름 5칸(7-1). 다른 모둠 평가(7-2)에도 쓴다.
export function coreTextOf(W) { return W.s4.pinned ? W.s4.coreEdit : (W.s3.coreC ? `${W.s3.coreC} (근거: ${W.s3.coreE})` : ""); }
export function firstAltOf(W) { const d = W.s4; if (d.first === null || !d.alts[d.first]) return ""; return d.improve.trim() || d.alts[d.first].txt; }
export function chainOf(W) {
  const d6 = W.s6;
  return [["문제", W.s7.problem], ["핵심 원인", coreTextOf(W)], ["대안", firstAltOf(W)], ["예상하지 못한 문제", W.s5.newp],
    ["행동계획", d6.types.length ? `(${d6.types.join("·")}) ` + d6.plans.filter(p => p.target).map(p => p.target + " · " + p.content).join(" / ") + (d6.scope ? ` [${d6.scope}]` : "") : ""]];
}
