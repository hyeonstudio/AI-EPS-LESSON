// 학생용(모둠 화면). 수업 흐름·문구·규칙은 견본 high/index.html(지도안 v25 맞춤본)을 그대로 따르고,
// 상태는 모둠 문서(work.s1~s7)에 저장해 같은 모둠의 다른 기기와 공유한다.
import {
  $, esc, now, hm, clone, sha, toast, netChip, loadLesson, store, makeAI, waitHtml, WAIT,
  helpVisFor, itemVisible, stageDone, aiTexts, overlapWith, redFields, openAI, revealHelp, teacherCheck6,
  pushLog, pushAlert, coreTextOf, firstAltOf, chainOf
} from "./core.js";

const app = $("#app"), top = $("#top");
const LOGIN = "aieps.v2.login"; // 탭마다 다른 학생이 들어올 수 있게 로그인은 sessionStorage, 입력 칸 채우기용 값만 localStorage
const NEED = 3; // 합의한 원인 3개 이상, 원인마다 원인 확인 질문 1개(지도안 v25)
let D, ai, BIAS, PI;
let code, G, me, doc, sess, grp, W, synced = {}, stage = 1;
const KEYS = ["s1", "s2", "s3", "s4", "s5", "s6", "s7"];

/* ================= 저장: 화면 값을 먼저 바꾸고 단계별로 모아 저장한다 ================= */
function flush() {
  if (!code) return;
  const changed = KEYS.filter(k => JSON.stringify(W[k]) !== synced[k]);
  if (!changed.length) return;
  try {
    store.update(code, d => { changed.forEach(k => { d.groups[G].work[k] = clone(W[k]); }); });
    changed.forEach(k => { synced[k] = JSON.stringify(W[k]); });
  } catch (e) { console.error(e); toast("저장하지 못했어요. 연결을 확인하세요.", true); }
}
let flushTimer = null;
function queueFlush(ms = 600) { clearTimeout(flushTimer); flushTimer = setTimeout(flush, ms); }
const pending = () => KEYS.some(k => JSON.stringify(W[k]) !== synced[k]);
window.addEventListener("beforeunload", e => { flush(); if (pending()) { e.preventDefault(); e.returnValue = ""; } });

function merge(nd) {
  if (!nd) return;
  doc = nd; sess = doc.session; grp = doc.groups[G];
  if (!grp) return;
  KEYS.forEach(k => {
    const remote = JSON.stringify(grp.work[k]);
    if (JSON.stringify(W[k]) === synced[k]) W[k] = clone(grp.work[k]); // 내 쪽에 저장 안 된 입력이 없을 때만 받아온다
    synced[k] = remote;
  });
  requestRender();
}
function mutate(fn) { flush(); store.update(code, d => fn(d, d.groups[G])); }
const log = (st, kind, text) => mutate((d, g) => pushLog(g, st, kind, text));
const alertAdd = (st, kind, text, ref) => mutate((d, g) => pushAlert(g, st, kind, text, ref));

/* ================= 도우미 ================= */
const helpVis = k => helpVisFor(sess, k, G);
function helpAfter(k) { if (k === "case") return helpVis("case") > 1 || !!helpVis("alt"); return !!helpVis(k); }
const aiOpen = n => !!(sess.ai[G] || {})[n];
const reqMsg = n => (sess.req[G] || {})[n] || "";
const demo = () => !!sess.rehearsal;
const articles = () => D.articles.map((a, i) => ({ a, i })).filter(({ a, i }) => itemVisible(sess, a, "art" + i));
const cases = () => D.cases.map((c, i) => ({ c, i })).filter(({ c, i }) => itemVisible(sess, c, "case" + i));
const nicks = () => Object.values(grp.members).map(m => m.nick);
let todo = "";
const flowList = items => { const n = items.find(([, st]) => st === "now"); if (n && !todo) todo = n[0].replace(/\s\d+'$/, ""); return `<ol class="flow">${items.map(([t, st]) => `<li class="${st}">${esc(t)}</li>`).join("")}</ol>`; };
const lockWrap = (on, msg, inner) => on ? `<div class="locked"><div class="lockmsg">${esc(msg)}</div><div class="lockbody">${inner}</div></div>` : inner;
const pendBox = name => `<div class="pend"><b>${esc(name)}</b><span>선생님이 공개하면 여기에 나타납니다. 그 전에 모둠이 먼저 생각해 봅시다.</span></div>`;
const aftTag = x => x && x.aft ? `<span class="aft">공개 후</span>` : "";
const demoBtn = (attrs, label, style = "") => demo() ? `<button class="demo-btn" ${attrs} ${style ? `style="${style}"` : ""}>${esc(label)}</button>` : "";
function signal(g) {
  return g === "Y"
    ? `<div class="signal Y"><span class="lamp" aria-hidden="true"><i></i><i></i><i></i></span><div><strong>노란불 · 먼저 생각하고, 그다음에 AI</strong>모둠이 먼저 만든 것을 저장하면 봉인되고, 선생님이 단계를 열어야 AI를 쓸 수 있습니다. AI의 답은 우리 말로 다시 정리하고, 대화 기록은 자동으로 제출됩니다.</div></div>`
    : `<div class="signal N"><span class="lamp" aria-hidden="true"><i></i><i></i><i></i></span><div><strong>AI 미사용 단계</strong>이 단계는 모둠이 직접 생각하고 토의합니다. 화면에 AI 창이 없습니다.</div></div>`;
}
function gateBox(n, sealed, what) {
  if (!sealed) return "";
  if (aiOpen(n)) return `<div class="gate ok"><b>선생님이 AI를 열었습니다</b><span>봉인한 ${esc(what)}을(를) 바탕으로 AI를 쓸 수 있습니다.</span></div>`;
  if (reqMsg(n)) return `<div class="gate req"><b>선생님의 보완 요청</b><span>${esc(reqMsg(n))}</span><button class="btn sm" data-act="unseal" data-n="${n}">봉인 풀고 보완하기</button></div>`;
  if (!todo) todo = "선생님이 봉인한 내용을 확인하고 AI를 열 때까지 기다려요";
  return `<div class="gate"><b>선생님 확인 대기</b><span>${esc(what)}이(가) 봉인되었습니다. 선생님이 확인하고 단계를 열면 AI 창이 열립니다.</span>${demoBtn(`data-act="tOpen" data-n="${n}"`, "리허설: 선생님이 연 것으로 처리")}</div>`;
}

/* ================= Red 탐지(학생 입력 ↔ AI 응답) ================= */
const overlap = txt => overlapWith(txt, aiTexts(W));
const caseTexts = () => [...D.cases.map(c => c.title + " " + c.body), ...D.altEx];
function redHtml(id, val) {
  const v = overlap(val);
  if (v === null) return `<div class="redbox idle" id="rb-${id}">재구성 점검: 문장을 더 쓰면 AI 응답과 겹치는 정도를 표시합니다.</div>`;
  const p = Math.round(v * 100), cls = v >= D.detect.red ? "red" : v >= D.detect.warn ? "warn" : "ok";
  const msg = v >= D.detect.red ? "Red 의심 · AI 응답과 많이 겹칩니다. 선생님이 말로 설명해 보라고 할 수 있습니다." : v >= D.detect.warn ? "주의 · AI 표현이 많이 남아 있습니다. 우리 말로 다시 써 봅시다." : "우리 말로 정리한 문장입니다.";
  return `<div class="redbox ${cls}" id="rb-${id}"><span>${msg}</span><span class="meter" aria-hidden="true"><i style="width:${p}%"></i></span><b>${p}%</b></div>`;
}
const fieldName = id => (redFields(W).find(f => f[0] === id) || [id, id])[1];
function checkRed(id, val, st) { const v = overlap(val); if (v === null) return; if (v >= D.detect.red) alertAdd(st, "red", `Red 의심 · ${fieldName(id)} · AI 응답 일치율 ${Math.round(v * 100)}%`, "red-" + id); }

/* ================= 렌더 ================= */
let typing = false, wantRender = false;
function requestRender() {
  const a = document.activeElement;
  if (a && app.contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.type !== "radio" && a.type !== "checkbox") { wantRender = true; renderTop(); return; }
  render();
}
app.addEventListener("focusout", () => setTimeout(() => { if (wantRender && !app.contains(document.activeElement)) { wantRender = false; render(); } }, 0));

function renderTop() {
  if (!sess) { top.innerHTML = topBar(""); return; }
  top.innerHTML = topBar(`${netChip()}<span class="meta">${G}모둠 · ${esc(grp.members[me]?.nick || "")}</span><button class="tbtn" data-top="help" aria-label="도움말">?</button><button class="tbtn" data-top="out">로그아웃</button>`)
    + (sess.rehearsal ? `<div class="ribbon"><b>리허설 모드</b> · 선생님이 수업 전 시연하는 중입니다. '리허설' 버튼은 실제 수업에서 보이지 않습니다.</div>` : "");
}
const topBar = right => `<div class="topbar"><div class="topin"><a class="logo" href="./"><span class="mark">EPS</span><span><b>AI-EPS</b><span>확장된 경험 기반 문제해결학습 모형 · ${esc(D?.meta.title || "")}</span></span></a>${right}</div></div>`;

let rendering = false;
function render(keepScroll) {
  if (rendering) return; rendering = true;
  const y = window.scrollY;
  renderTop();
  try {
    if (!sess) app.innerHTML = joinView();
    else if (sess.status === "closed") app.innerHTML = `<div class="panel join"><h2>수업이 닫혔습니다</h2><p class="small">선생님이 수업을 마쳤습니다. 기록은 선생님께 저장되었습니다.</p><div class="row"><button class="btn" data-top="out">처음 화면으로</button></div></div>`;
    else app.innerHTML = studentView();
  } catch (err) { console.error(err); app.innerHTML = `<div class="panel"><b>화면을 그리는 중 문제가 생겼습니다.</b><p class="small">${esc(err.message)}</p></div>`; }
  if (keepScroll !== false) window.scrollTo(0, y);
  const c = document.querySelector(".chat"); if (c) c.scrollTop = c.scrollHeight;
  rendering = false;
}

/* ---------- 입장 ---------- */
function joinView() {
  const last = (() => { try { return JSON.parse(localStorage.getItem(LOGIN + ".last") || "null"); } catch { return null; } })();
  const codes = store.list();
  return `<div class="panel join"><h2>수업 들어가기</h2><p class="small" style="margin:0 0 18px">선생님이 알려 준 수업 코드와 우리 모둠 번호를 넣습니다. 비밀번호는 다른 기기에서 다시 들어올 때 씁니다.</p>
   <form id="joinf" autocomplete="off">
    <div class="field"><label for="j-code">수업 코드</label><input id="j-code" class="codein" maxlength="6" required value="${esc(new URLSearchParams(location.search).get("code") || last?.code || "")}" placeholder="ABC123"></div>
    <div class="field"><label for="j-g">모둠</label><select id="j-g">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${last?.g === i + 1 ? "selected" : ""}>${i + 1}모둠</option>`).join("")}</select></div>
    <div class="field"><label for="j-nick">이름(별칭)</label><input id="j-nick" maxlength="12" required value="${esc(last?.nick || "")}"></div>
    <div class="field"><label for="j-pw">비밀번호 4자리</label><input id="j-pw" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required></div>
    <button class="btn primary" type="submit" style="width:100%;padding:12px">들어가기</button>
   </form>
   ${codes.length ? `<p class="small" style="margin-top:14px">이 브라우저에 있는 수업: ${codes.slice(0, 5).map(c => `<code>${esc(c)}</code>`).join(" · ")}</p>` : `<p class="small" style="margin-top:14px">지금은 시연판이라 선생님 화면과 같은 브라우저에서만 수업에 들어갈 수 있습니다.</p>`}</div>`;
}
async function join(c, g, nick, pw) {
  const d0 = store.get(c);
  if (!d0) throw new Error("수업 코드를 찾을 수 없어요. 선생님께 다시 확인해 주세요.");
  if (d0.session.status === "closed") throw new Error("이미 닫힌 수업이에요.");
  if (!d0.groups[g]) throw new Error(`이 수업에는 ${g}모둠이 없어요.`);
  const uid = await sha(`${c}|${g}|${nick}`), ph = await sha(`${uid}|${pw}`);
  const m = d0.groups[g].members[uid];
  if (m && m.pw !== ph) throw new Error("비밀번호가 달라요. 처음 들어올 때 쓴 비밀번호를 넣어 주세요.");
  store.update(c, d => {
    const mm = d.groups[g].members;
    mm[uid] = { ...(mm[uid] || { nick, pw: ph, role: "" }), last: Date.now(), stage: mm[uid]?.stage || 1 };
    pushLog(d.groups[g], 0, "join", `${nick} 입장`);
  });
  sessionStorage.setItem(LOGIN, JSON.stringify({ code: c, g, uid, nick }));
  localStorage.setItem(LOGIN + ".last", JSON.stringify({ code: c, g, nick }));
  enter(c, g, uid);
}
let subscribed = new Set(), hb = null;
function enter(c, g, uid) {
  code = c; G = g; me = uid;
  doc = store.get(c); if (!doc || !doc.groups[g] || !doc.groups[g].members[uid]) { leave(); return; }
  sess = doc.session; grp = doc.groups[g];
  ai = makeAI(D, "demo");
  W = clone(grp.work); KEYS.forEach(k => { synced[k] = JSON.stringify(W[k]); });
  stage = Math.min(grp.members[uid].stage || 1, sess.open);
  if (!subscribed.has(c)) { store.subscribe(c, nd => { if (code === c) merge(nd); }); subscribed.add(c); }
  clearInterval(hb); hb = setInterval(beat, 20000); beat();
  render(false);
}
function beat() { if (!code) return; try { store.update(code, d => { const m = d.groups[G]?.members[me]; if (m) { m.last = Date.now(); m.stage = stage; } }); } catch { } }
function leave() { flush(); clearInterval(hb); sessionStorage.removeItem(LOGIN); code = G = me = doc = sess = grp = null; W = null; render(false); }

/* ---------- 모둠 화면 ---------- */
function studentView() {
  todo = "";
  if (stage > sess.open) stage = sess.open;
  const mine = grp.members[me] || {};
  const online = m => Date.now() - (m.last || 0) < 60000;
  let rail = `<nav class="rail" aria-label="수업 단계"><div class="who"><b>${G}모둠</b> · 고1 · ${Object.keys(grp.members).length}명
    <div class="members">${Object.entries(grp.members).map(([id, m]) => `<div><span><span class="dot ${online(m) ? "on" : ""}"></span>${esc(m.nick)}</span>${id === me ? `<select data-act-change="role" aria-label="내 모둠 역할"><option value="">역할 선택</option>${D.roles.map(r => `<option ${mine.role === r ? "selected" : ""}>${esc(r)}</option>`).join("")}</select>` : `<span class="small">${esc(m.role || "역할 미정")}</span>`}</div>`).join("")}</div>
    <span class="small" style="display:block;margin-top:4px">모둠 역할은 2차시에 교대합니다.</span></div>`;
  [1, 2].forEach(sn => {
    rail += `<div class="session">${sn}/2차시 · 45분</div>`;
    D.stages.filter(s => s.ses === sn).forEach(st => {
      const dis = st.n > sess.open;
      rail += `<button class="step ${stageDone(W, st.n) ? "done" : ""}" data-stage="${st.n}" ${dis ? "disabled" : ""} ${stage === st.n ? 'aria-current="step"' : ""}><span class="n">${st.n}</span><span class="t">${esc(st.t)}</span><span class="s">${dis ? "선생님이 아직 열지 않음" : `<span class="chip ${st.g}">${st.g === "Y" ? "YELLOW" : "AI 없음"}</span><span>${st.min}분</span>`}</span></button>`;
    });
  });
  rail += `</nav>`;
  const st = D.stages[stage - 1];
  const head = `<div class="stage-head"><h2>${st.n}단계 · ${esc(st.t)}</h2><span class="chip ${st.g}">${st.g === "Y" ? "YELLOW" : "AI 미사용"}</span><span class="ws">${esc(st.ws)}</span><span class="mins">${st.min}분</span>${st.role ? `<span class="small">AI 역할: ${esc(st.role)}</span>` : ""}${st.tool ? `<span class="small">AI 기능: ${esc(st.tool)}</span>` : ""}${demoBtn(`data-act="demo" data-n="${st.n}"`, "리허설: 예시 넣기", "margin-left:auto")}</div><p class="stage-def">${esc(st.def)}</p>${signal(st.g)}`;
  const body = [null, s1, s2, s3, s4, s5, s6, s7][stage]();
  const nx = stage + 1;
  const next = nx > 7 ? "" : nx <= sess.open ? `<div class="nextbar"><button class="btn primary" data-stage="${nx}">${nx}단계로 이동</button></div>` : `<div class="nextbar"><span class="small">${nx}단계는 선생님이 아직 열지 않았습니다.</span></div>`;
  if (!todo) todo = stageDone(W, stage) ? (nx <= sess.open ? `${nx}단계로 이동해요` : nx > 7 ? "수고했어요. 기록이 모두 제출되었습니다" : "선생님이 다음 단계를 열 때까지 기다려요") : "이 단계의 활동을 이어 가요";
  const bc = latestBroadcast();
  return `${bc ? `<div class="bcast" role="status"><b>선생님</b><span>${esc(bc.text)}</span><button class="btn sm" data-act="bcread" data-v="${esc(bc.id)}">확인</button></div>` : ""}
   <div class="todo"><b>지금 할 일</b><span>${esc(todo)}</span></div>
   <div class="student">${rail}<section class="panel">${head}${body}${next}</section></div>`;
}
function latestBroadcast() {
  let seen = []; try { seen = JSON.parse(localStorage.getItem("aieps.v2.seen." + code) || "[]"); } catch { }
  return [...(sess.broadcasts || [])].reverse().find(b => (b.to === "all" || +b.to === G) && !seen.includes(b.id));
}

/* ---------- 1단계 ---------- */
function timerText() { const d = W.s1; if (!d.deadline) return "--:--"; const r = Math.max(0, Math.round((d.deadline - Date.now()) / 1000)); return String(Math.floor(r / 60)).padStart(2, "0") + ":" + String(r % 60).padStart(2, "0"); }
function s1() {
  const d = W.s1, ph = d.phase, P = D.persona;
  const fl = flowList([["편지 읽기", "ok"], ["① 질문 합의 3'", ph === 0 ? "now" : "ok"], ["② 1차 대화 4'", ph === 1 ? "now" : ph > 1 ? "ok" : ""], ["③ 멈추고 논의 1'", ph === 2 ? "now" : ph > 2 ? "ok" : ""], ["④ 2차 대화 2'", ph === 3 ? "now" : ph > 3 ? "ok" : ""], ["로그 제출", ph >= 4 ? "ok" : ""]]);
  const letter = `<div class="block first"><h3>${esc(P.name)}에게서 온 편지 <span class="ws">1-1</span> <span class="mins">2'</span></h3><div class="letter"><div class="from">${esc(P.letterFrom)}</div>${P.letter.map(p => `<p>${esc(p)}</p>`).join("")}</div></div>`;
  const miss = D.qtypes.filter((t, i) => !d.qs.some(q => q.type === i));
  const qType = +(sessionStorage.getItem("aieps.v2.qtype") || 0);
  const q = `<div class="block"><h3>① ${esc(P.name)}에게 무엇을 물어야 그의 상황을 이해할 수 있을까요? <span class="ws">1-2</span> ${d.sealed ? `<span class="seal">봉인 ${hm(d.sealT)}</span>` : ""}</h3>
   <p class="hint">편지에 나오지 않은 이야기 가운데 무엇을 알아야 할까요? 세 유형을 고루 생각하며 모둠에서 4~5개의 질문을 합의합니다. 원인이나 해결책은 묻지 않습니다.</p>
   <ul class="list">${d.qs.map((x, i) => `<li><span class="tag">${esc(D.qtypes[x.type])}</span><span class="txt">${esc(x.t)}${aftTag(x)}</span>${d.sealed ? "" : `<button class="x" data-act="del" data-k="s1.qs" data-i="${i}">삭제</button>`}</li>`).join("")}</ul>
   ${d.sealed ? "" : `<div class="addrow"><select id="s1-type" class="narrow" aria-label="질문 유형">${D.qtypes.map((t, i) => `<option value="${i}" ${qType === i ? "selected" : ""}>${t}</option>`).join("")}</select><input type="text" id="s1-new" placeholder="모둠이 합의한 질문"><button class="btn" data-act="s1add">추가</button></div>
   ${miss.length && d.qs.length ? `<div class="warnline">아직 없는 유형: ${esc(miss.join(", "))}</div>` : ""}
   ${helpVis("q1") ? `<div class="exbox"><b class="small">선생님이 공개한 예시 질문</b> <span class="small">그대로 쓰지 말고 우리가 더 알고 싶은 것으로 바꿔 봅시다. 공개 뒤 만든 질문은 '공개 후'로 표시됩니다.</span><ul>${D.q1Ex.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>` : pendBox("예시 질문")}
   <div class="row"><button class="btn primary" data-act="s1seal" ${d.qs.length < 4 || d.qs.length > 5 ? "disabled" : ""}>합의 완료 · 질문 봉인</button><span class="small">${d.qs.length}개 · 4~5개여야 저장할 수 있습니다. 저장하면 고칠 수 없고 시각이 기록됩니다.</span></div>`}
   ${gateBox(1, d.sealed, "질문 목록")}</div>`;
  const busy = d.chat.some(m => m.wait);
  const chat = `<div class="persona"><span class="av">${esc(P.initial)}</span><div><b>${esc(P.name)}</b><em>${esc(P.card)}</em></div><span class="timer" id="s1-timer">${timerText()}</span></div>
   <div class="chat" aria-live="polite">${d.chat.length ? d.chat.map((m, i) => m.r === "sys" ? `<div class="msg sys">${esc(m.x)}</div>` : m.r === "me" ? `<div class="msg me">${esc(m.x)}</div>` : `<div class="msg ai ${m.flag ? "flag" : ""}" id="m-${i}"><span class="who">${esc(P.name)}${m.flag ? " · 신고됨" : ""}${m.wait || m.flag ? "" : `<button class="rep" data-act="report" data-i="${i}">일반화 표현 신고</button>`}</span>${m.wait ? `<span class="body">${streamText[i] ? esc(streamText[i]) : waitHtml({ steps: WAIT.chat, since: m.since || Date.now(), compact: true })}</span>` : esc(m.x)}</div>`).join("") : '<div class="msg sys">선생님이 열면 합의한 질문을 골라 보낼 수 있습니다.</div>'}</div>
   ${d.halted ? `<div class="warnline r">일반화 표현을 신고해 대화를 멈췄습니다. 선생님이 확인하고 대화를 다시 열 때까지 기다립니다.</div>` : ""}`;
  const r1 = d.qs.filter(x => !x.sent);
  const c1 = `<div class="block"><h3>② 1차 대화 <span class="ws">1-3</span> <span class="mins">4'</span></h3><p class="hint">자유 입력창은 없습니다. 합의한 질문만 보낼 수 있습니다. 특정 집단을 일반화하는 응답이 나오면 '일반화 표현 신고'를 누릅니다.</p>${chat}
   ${ph === 1 ? `<div class="addrow"><select id="s1-pick" aria-label="보낼 질문">${r1.map(x => `<option value="${d.qs.indexOf(x)}">${esc(x.t)}</option>`).join("")}</select><button class="btn primary" data-act="s1send" ${r1.length && !d.halted && !busy ? "" : "disabled"}>보내기</button></div>
   <div class="row"><button class="btn" data-act="s1pause" ${busy ? "disabled" : ""}>대화 멈추고 모둠 논의</button><span class="small">${r1.length ? `남은 질문 ${r1.length}개 · 시간이 다 되면 멈춥니다.` : "합의한 질문을 모두 보냈습니다."}</span></div>` : ""}</div>`;
  const disc = `<div class="block"><h3>③ 멈추고 모둠 논의 <span class="ws">1-3</span> <span class="mins">1'</span> ${d.sealed2 ? `<span class="seal">봉인 ${hm(d.sealT2)}</span>` : ""}</h3><p class="hint">${esc(P.name)}의 대답에서 아직 비어 있는 부분은 무엇인가요? 더 필요한 질문을 합의합니다. 앞선 응답의 빈틈을 겨냥한 질문일수록 좋습니다.</p>
   <textarea id="s1-disc" data-bind="s1.discuss" ${d.sealed2 ? "readonly" : ""} placeholder="예: 배에서 일했다고 했는데, 그 일을 어떻게 구했는지는 아직 모른다.">${esc(d.discuss)}</textarea>
   <ul class="list" style="margin-top:8px">${d.qs2.map((x, i) => `<li><span class="tag">추가 ${i + 1}</span><span class="txt">${esc(x.t)}</span>${d.sealed2 ? "" : `<button class="x" data-act="del" data-k="s1.qs2" data-i="${i}">삭제</button>`}</li>`).join("")}</ul>
   ${d.sealed2 ? "" : `<div class="addrow"><input type="text" id="s1-new2" placeholder="추가로 합의한 질문 (1~2개)"><button class="btn" data-act="s1add2">추가</button></div><div class="row"><button class="btn primary" data-act="s1seal2">${d.qs2.length ? "논의 완료 · 2차 대화 시작" : "추가 질문 없이 마치기"}</button></div>`}</div>`;
  const r2 = d.qs2.filter(x => !x.sent);
  const c2 = `<div class="block"><h3>④ 2차 대화 <span class="mins">2'</span></h3>${d.qs2.length ? (ph === 3 ? `<div class="addrow"><select id="s1-pick2" aria-label="보낼 추가 질문">${r2.map(x => `<option value="${d.qs2.indexOf(x)}">${esc(x.t)}</option>`).join("")}</select><button class="btn primary" data-act="s1send2" ${r2.length && !d.halted && !busy ? "" : "disabled"}>보내기</button><button class="btn" data-act="s1end" ${busy ? "disabled" : ""}>대화 마치기</button></div>` : "") : '<p class="hint">추가 질문 없이 대화를 마쳤습니다.</p>'}
   <p class="small" style="margin:8px 0 0">${ph >= 4 ? `<span class="seal">로그 제출됨 ${hm(d.endT)}</span> 1·2차 대화 로그가 제출되었습니다.` : "대화를 마치면 1·2차 대화 로그가 자동으로 제출됩니다."}</p></div>`;
  return fl + letter + q + lockWrap(!(d.sealed && aiOpen(1)), "질문을 봉인하고 선생님이 단계를 열어야 대화할 수 있습니다.", c1) + lockWrap(ph < 2, "1차 대화를 멈춰야 논의가 열립니다.", disc) + lockWrap(ph < 3, "논의 결과를 저장해야 2차 대화가 열립니다.", c2);
}

/* ---------- 2단계 ---------- */
function s2() {
  const d = W.s2, L = d.life, artOpen = helpVis("art"), P = D.persona;
  const answered = d.qa.filter((x, i) => D.qa[i].type === "ox" ? x : String(x).trim()).length;
  const fl = flowList([["기사·사실 확인 4'", answered < D.qa.length ? "now" : "ok"], [`${P.name} 이야기 비교 2'`, answered === D.qa.length && !Object.keys(d.cls).length ? "now" : Object.keys(d.cls).length ? "ok" : ""], ["삶 잇기 3'", Object.values(L).every(x => x.trim()) ? "ok" : ""], ["원인 추측 2'", d.guesses.length >= NEED ? "ok" : ""], ["원인 확인 질문 봉인 3'", W.s3.sealed ? "ok" : d.guesses.length >= NEED ? "now" : ""]]);
  const facts = `<div class="block first"><h3>실제 사건 확인하기 <span class="ws">2-1</span> <span class="mins">4'</span></h3><p class="hint">${esc(P.name)}는 가상 인물이지만, 2018년 제주에서는 실제로 예멘인 549명이 난민 인정을 신청했습니다. 선생님이 공개한 기사 3건을 읽고 사실 확인 질문 6개의 답을 찾습니다.</p>
   ${artOpen ? `<div class="facts">${articles().map(({ a }) => `<article class="article"><span class="atag">${esc(a.tag)}</span><h4>${esc(a.title)}</h4>${a.body.map(x => `<p>${esc(x)}</p>`).join("")}${a.note ? `<p class="note">${esc(a.note)}</p>` : ""}<div class="src">${a.src.map(s => s.u ? `<a href="${esc(s.u)}" target="_blank" rel="noopener">${esc(s.t)}</a>` : `<span>${esc(s.t)}</span>`).join("")}</div></article>`).join("")}</div>
   <p class="small" style="margin:8px 0 0">원문을 선생님이 요약한 것입니다. 수치와 날짜는 원문에서 확인했습니다.</p>`
    : `<div class="pend"><b>실제 사건 기사 3건</b><span>2단계를 시작하면 선생님이 공개합니다.</span>${demoBtn('data-act="help" data-k="art" data-m="all"', "리허설: 선생님이 기사를 공개한 것으로 처리", "margin:6px 0 0;align-self:flex-start")}</div>`}
   <ol class="qa" style="margin-top:12px">${D.qa.map((q, i) => `<li><div class="qa-q"><span class="qa-type">${q.type === "ox" ? "O/X" : "단답"}</span><span>${esc(q.q)}</span><span class="small" style="margin-left:auto;white-space:nowrap">기사 ${esc(q.src)}</span></div>${q.type === "ox"
    ? `<div class="ox" role="group" aria-label="O 또는 X">${["O", "X"].map(v => `<button data-act="ox" data-i="${i}" data-v="${v}" aria-pressed="${d.qa[i] === v}" ${artOpen ? "" : "disabled"}>${v}</button>`).join("")}${d.qa[i] ? (d.qa[i] === q.a ? `<span class="qa-fb ok">맞아요 · ${esc(q.why)}</span>` : `<span class="qa-fb no">기사 ${esc(q.src)}를 다시 읽어 보세요</span>`) : ""}</div>`
    : `<input type="text" data-bind="s2.qa.${i}" value="${esc(d.qa[i])}" placeholder="기사에서 찾은 답" aria-label="답" ${artOpen ? "" : "disabled"}>`}</li>`).join("")}</ol>
   <p class="small" style="margin:6px 0 0">${answered}/${D.qa.length} 답함</p></div>`;
  const ais = W.s1.chat.map((m, i) => ({ m, i })).filter(o => o.m.r === "ai" && !o.m.wait);
  const cmp = `<div class="block"><h3>${esc(P.name)} 이야기와 실제 사건 비교하기 <span class="ws">2-2</span> <span class="mins">2'</span></h3>
   <div class="fiction"><span class="fic-tag">가상</span><b>${esc(P.name)}의 이야기</b> <span class="small">실제 사건을 바탕으로 만든 가상 인물과의 대화입니다.</span>
    <ul>${P.letterFacts.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>
   <p class="hint" style="margin-top:12px">우리 모둠의 대화에서 ${esc(P.name)}가 한 말을 실제 사건에서 확인된 이야기와 기사에서 확인할 수 없는 창작된 이야기로 나눕니다. 확인된 이야기는 근거가 된 기사를 고릅니다.</p>
   ${ais.length ? `<div class="tablewrap"><table><thead><tr><th style="width:46%">${esc(P.name)}의 말(대화 내용)</th><th>구분</th><th>근거 기사</th></tr></thead><tbody>${ais.map(({ m, i }) => { const c = d.cls[i] || {}; return `<tr><td class="ai-ans">${esc(m.x.replace(P.pre, ""))}</td><td><div class="judge" role="group" aria-label="구분">${["확인된 이야기", "창작된 이야기"].map(o => `<button data-act="cls" data-i="${i}" data-v="${o}" aria-pressed="${c.v === o}">${o}</button>`).join("")}</div></td><td><select data-bind="s2.cls.${i}.art" aria-label="근거 기사" ${c.v === "확인된 이야기" ? "" : "disabled"}><option value="">-</option>${D.articles.map((a, k) => `<option value="${k + 1}" ${String(c.art) === String(k + 1) ? "selected" : ""}>기사 ${k + 1}</option>`).join("")}</select></td></tr>`; }).join("")}</tbody></table></div>` : `<div class="pend"><b>대화 기록이 없습니다</b><span>1단계에서 ${esc(P.name)}와 대화하면 응답이 여기에 나타납니다.</span></div>`}
   </div>`;
  const LQ = [["same", `나와 ${P.name}의 공통점은?`, `예: ${P.name}도 대학에 가고 싶어 했고, 가족과 연락할 때 휴대전화를 쓴다.`], ["place", `내가 ${P.name}의 마을에서 태어났다면?`, "그곳에서 나는 어떤 일을 겪었을까요?"], ["impact", `${P.name}가 실존한다면 나의 삶에 어떤 영향을 미칠까?`, "같은 학교, 같은 동네에서 만난다면?"], ["act", `나의 행동은 ${P.name}에게 어떤 영향을 미칠 수 있을까?`, "내가 읽고 쓰고 퍼뜨리는 말과 댓글, 나의 선택을 떠올려 봅니다."]];
  const life = `<div class="block"><h3>사건과 나의 삶 잇기 <span class="ws">2-3</span> <span class="mins">3'</span></h3><p class="hint">모둠 토의를 하며 씁니다. 주변 사람을 쓸 때는 실명을 쓰지 않습니다.</p>
   <div class="grid2">${LQ.map(([k, q, ph]) => `<div class="field"><label for="s2-${k}">${esc(q)}</label><textarea id="s2-${k}" data-bind="s2.life.${k}" placeholder="${esc(ph)}">${esc(L[k])}</textarea></div>`).join("")}</div>
   ${PI.test(Object.values(L).join(" ")) ? `<div class="warnline r">전화번호나 이메일 같은 개인정보가 들어 있습니다.</div>` : ""}</div>`;
  const biasHit = d.guesses.some(g => BIAS.test(g.t));
  const guess = `<div class="block"><h3>원인 추측하기 <span class="ws">2-4</span> <span class="mins">2'</span> <span class="chip N">AI 미사용</span></h3><p class="hint">${esc(P.name)}는 전쟁을 피해 왔는데 왜 여기서도 안정적으로 지내기 어려울까요? 각자 기록지 2-4에 먼저 추측한 뒤, 모둠에서 비교해 합의한 원인을 ${NEED}개 이상 입력합니다.</p>
   <ul class="list">${d.guesses.map((g, i) => `<li><span class="tag">원인 ${i + 1}</span><span class="txt">${esc(g.t)}</span>${W.s3.sealed ? "" : `<button class="x" data-act="del" data-k="s2.guesses" data-i="${i}">삭제</button>`}</li>`).join("")}</ul>
   ${W.s3.sealed ? "" : `<div class="addrow"><input type="text" id="s2-g" placeholder="모둠이 합의한 원인"><button class="btn" data-act="s2g">추가</button></div>`}
   <p class="small" style="margin:6px 0 0">${d.guesses.length}/${NEED}개 이상${d.guesses.length < NEED ? ` · ${NEED}개가 되면 원인 확인 질문을 정할 수 있습니다.` : ""}</p>
   ${biasHit ? `<div class="warnline">선생님 질문: 같은 예멘인 신청자도 결과가 달랐던 이유는 무엇일까요? 개인의 노력만으로 해결될 수 있을까요? 원인을 제도와 여론의 층위에서 다시 생각해 봅시다.</div>` : ""}</div>`;
  const vq = `<div class="block"><h3>원인 확인 질문 정하기 <span class="ws">2-5</span> <span class="mins">3'</span> ${W.s3.sealed ? `<span class="seal">봉인 ${hm(W.s3.sealT)}</span>` : ""}</h3><p class="hint">추측한 원인이 맞는지 확인하려면 어떤 정보가 필요할까요? 개인의 노력만으로 해결될 수 있는지, 제도나 여론이 어떤 영향을 주었는지 생각해 봅니다. 모둠원이 상의하여 합의한 원인마다 질문을 1개씩 정하고, AI 입력자가 저장·봉인합니다. 확인할 것이 여럿이면 한 질문에 묶고, 더 필요한 근거는 3단계의 ‘근거 다시 묻기’로 보충합니다. 저장하고 칠판에도 붙여 다른 모둠과 겹치거나 충돌하는 질문을 확인합니다. 3단계에서는 봉인한 질문만 AI에게 물을 수 있습니다.</p>
   <ul class="list">${d.vq.map((x, i) => `<li><span class="tag">질문 ${i + 1}</span><span class="txt">${esc(x.q)}${x.cause ? `<br><span class="small">확인하려는 원인: ${esc(x.cause)}</span>` : ""}${aftTag(x)}</span>${W.s3.sealed ? "" : `<button class="x" data-act="del" data-k="s2.vq" data-i="${i}">삭제</button>`}</li>`).join("")}</ul>
   ${W.s3.sealed ? "" : d.vq.length < d.guesses.length ? `<div class="addrow"><select id="s2-vc" class="narrow" aria-label="이 질문으로 확인할 원인"><option value="">이 질문으로 확인할 원인</option>${d.guesses.map((g, k) => d.vq.some(v => v.cause === g.t) ? "" : `<option value="${esc(g.t)}">원인 ${k + 1}. ${esc(g.t)}</option>`).join("")}</select><input type="text" id="s2-v" placeholder="대상·시점·필요한 정보가 드러나게"><button class="btn" data-act="s2v">추가</button></div><p class="small" style="margin:6px 0 0">이미 질문을 정한 원인은 목록에서 빠집니다.</p>` : ""}
   ${W.s3.sealed ? "" : helpVis("q2") ? `<div class="exbox"><b class="small">선생님이 공개한 원인 탐색 질문 예시</b> <span class="small">우리가 추측한 원인에 맞게 바꿔 씁니다.</span><ul>${D.q2Ex.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>` : pendBox("원인 탐색 질문 예시")}
   ${W.s3.sealed ? "" : `<div class="row"><button class="btn primary" data-act="s3seal" ${d.guesses.length >= NEED && d.vq.length === d.guesses.length ? "" : "disabled"}>원인 확인 질문 저장 · 봉인</button><span class="small">${d.vq.length}/${d.guesses.length}개 · 합의한 원인마다 질문을 1개씩 정해야 합니다. 봉인한 뒤 선생님이 3단계를 열어야 질문할 수 있습니다.</span></div>`}
   ${gateBox(3, W.s3.sealed, "원인 확인 질문")}</div>`;
  return fl + facts + cmp + life + guess + lockWrap(d.guesses.length < NEED && !W.s3.sealed, `2-4에서 모둠이 합의한 원인을 ${NEED}개 이상 적어야 원인 확인 질문을 정할 수 있습니다.`, vq);
}

/* ---------- 3단계 ---------- */
function syncRows() {
  const d = W.s3;
  if (d.rows.length !== W.s2.vq.length || d.rows.some((r, i) => r.q !== W.s2.vq[i].q)) {
    d.rows = W.s2.vq.map(v => ({ q: v.q, cause: v.cause, who: v.who || "", ans: null, src: [], fu: "", sum: "", res: "", ck: [false, false, false, false], j: "", why: "", wait: false, err: "" }));
    queueFlush();
  }
}
function s3() {
  const d = W.s3; syncRows();
  if (!d.rows.length) return `<div class="pend"><b>원인 확인 질문이 없습니다</b><span>2단계에서 원인 확인 질문을 먼저 만듭니다.</span></div>`;
  const asked = d.rows.every(r => r.ans), judged = asked && d.rows.every(r => r.j && r.res.trim() && r.sum.trim() && (r.why || "").trim());
  const fl = flowList([["질문 봉인(2-5)", d.sealed ? "ok" : "now"], ["정보 탐색 3'", d.sealed && !asked ? "now" : asked ? "ok" : ""], ["정보 검증·판정 5'", asked && !judged ? "now" : judged ? "ok" : ""], ["원인 관계도 4'", judged && !d.root ? "now" : d.root ? "ok" : ""], ["핵심 원인 2'", d.root && !d.done ? "now" : d.done ? "ok" : ""]]);
  const seal = `<div class="block first"><h3>원인 확인 질문 <span class="small">2단계 2-5</span> ${d.sealed ? `<span class="seal">봉인 ${hm(d.sealT)}</span>` : ""}</h3>
   <ul class="list">${d.rows.map((r, i) => `<li><span class="tag">질문 ${i + 1}</span><span class="txt">${esc(r.q)}${r.who ? `<br><span class="small">맡은 사람: ${esc(r.who)}</span>` : ""}</span></li>`).join("")}</ul>
   ${d.sealed ? gateBox(3, d.sealed, "원인 확인 질문") : `<div class="pend"><b>아직 봉인 전입니다</b><span>2단계 2-5에서 원인 확인 질문을 저장·봉인합니다.</span></div>`}</div>`;
  const who = nicks();
  const tbl = `<div class="block"><h3>원인 확인 질문으로 얻은 정보 검증하기 <span class="ws">3-1</span></h3><p class="hint">질문 입력창은 없습니다. ‘AI 응답’ 버튼을 눌러 AI 응답을 모둠원이 함께 확인합니다. 응답마다 맡은 사람을 정하고, 맡은 사람은 응답을 우리 말로 요약해 AI 입력자에게 넘깁니다. 각자 AI가 제시한 출처에 직접 접속해 확인하고, 출처가 없거나 확인되지 않으면 검증 자료 목록과 추가 검색으로 검증합니다. 검증 결과를 모둠에 설명한 뒤 출처 신뢰성·정확성·최신성을 기준으로 함께 논의해 판정합니다. AI의 답은 정답이 아니며, 출처를 확인하지 못한 정보는 근거로 쓸 수 없습니다.</p>
   <div class="tablewrap"><table style="min-width:1040px"><thead><tr><th style="width:14%">원인 확인 질문</th><th style="width:21%">AI 응답과 제시한 출처</th><th style="width:17%">AI 응답의 핵심(우리 말로)</th><th style="width:17%">직접 확인한 결과</th><th style="width:16%">검증 체크리스트</th><th>판정과 이유</th></tr></thead><tbody>${d.rows.map((r, i) => `<tr>
    <td><span class="small">질문 ${i + 1}</span><br>${esc(r.q)}${r.ans ? `<label class="small" style="display:block;margin-top:8px">맡은 사람<select data-bind="s3.rows.${i}.who" aria-label="질문 ${i + 1} 응답을 맡은 사람" style="margin-top:2px"><option value="">선택</option>${who.map(w => `<option ${r.who === w ? "selected" : ""}>${esc(w)}</option>`).join("")}</select></label>` : ""}</td>
    <td>${r.ans ? `<div class="ai-ans">${esc(r.ans)}<span class="srcs">출처: ${r.src.map(esc).join(" / ") || "없음"}</span>${r.fu ? `<span class="srcs" style="color:var(--ink)">근거 다시 묻기 → ${esc(r.fu)}</span>` : r.wait ? waitHtml({ since: r.since, compact: true }) : `<button class="btn sm" style="margin-top:6px" data-act="s3fu" data-i="${i}">근거 다시 묻기</button>`}</div>` : r.wait ? waitHtml({ since: r.since, compact: true }) : `<button class="btn primary sm" data-act="s3ask" data-i="${i}">AI 응답</button><span class="small" style="display:block;margin-top:4px">"…답의 근거가 된 자료의 기관명·자료명·날짜를 함께 제시해 줘. 확인할 수 없는 내용은 '확인 불가'라고 표시해 줘. 원인이 무엇인지 판단하지는 마."</span>`}${r.err ? `<div class="warnline">${esc(r.err)}</div>` : ""}</td>
    <td><textarea id="s3-sum-${i}" data-bind="s3.rows.${i}.sum" data-red="s3-sum-${i}" data-st="3" ${r.ans ? "" : "disabled"} aria-label="AI 응답의 핵심" placeholder="우리 말로 한 줄">${esc(r.sum)}</textarea>${r.ans ? redHtml("s3-sum-" + i, r.sum) : ""}</td>
    <td><textarea data-bind="s3.rows.${i}.res" ${r.ans ? "" : "disabled"} placeholder="자료 내용 / 출처(기관·문서명, 날짜)" aria-label="직접 확인한 결과">${esc(r.res)}</textarea></td>
    <td><div class="checks">${D.verify.map((c, k) => `<label><input type="checkbox" data-bind="s3.rows.${i}.ck.${k}" ${r.ck[k] ? "checked" : ""} ${r.ans ? "" : "disabled"}> ${esc(c)}</label>`).join("")}</div></td>
    <td><div class="judge" role="group" aria-label="판정" style="flex-direction:column;align-items:stretch">${[["○ 수용", "수용"], ["△ 보류", "보류"], ["× 불수용", "불수용"]].map(([l, v]) => `<button data-act="s3j" data-i="${i}" data-v="${v}" aria-pressed="${r.j === v}" ${r.ans ? "" : "disabled"}>${l}</button>`).join("")}</div><input type="text" data-bind="s3.rows.${i}.why" value="${esc(r.why || "")}" placeholder="이유" aria-label="판정 이유" style="margin-top:6px" ${r.ans ? "" : "disabled"}>${r.j === "수용" && !r.ck[0] ? `<div class="warnline">출처를 직접 확인하지 못한 정보는 수용할 수 없습니다.</div>` : ""}</td></tr>`).join("")}</tbody></table></div>
   <p class="small" style="margin:8px 0 0">판정 기준: 출처 신뢰성·정확성·최신성 · ○ 수용: 출처를 확인했고 원자료와 일치 · △ 보류: 확인하지 못했거나 자료마다 다름 · × 불수용: 원자료와 다르거나 출처가 없음</p>
   <details class="pd"><summary>검증 자료 목록 (선생님 제공)</summary><ul class="small" style="margin:8px 0 0;padding-left:18px">${articles().flatMap(({ a }) => a.src).filter(s => s.u).map(s => `<li><a href="${esc(s.u)}" target="_blank" rel="noopener">${esc(s.t)}</a></li>`).join("")}</ul><p class="small">검색 엔진의 AI 요약이나 출처가 불분명한 게시물은 검증 자료로 인정하지 않습니다.</p></details></div>`;
  const acc = d.rows.filter(r => r.j === "수용");
  const causes = [...new Set([...W.s2.guesses.map(g => g.t), ...d.rows.map(r => r.cause).filter(Boolean)])];
  const un = W.s2.guesses.map(g => g.t).filter(t => !d.rows.some(r => r.cause === t));
  const core = `<div class="block"><h3>원인 관계도 그리기 <span class="ws">3-2</span> <span class="mins">4'</span> <span class="chip N">AI 미사용</span></h3><p class="hint">수용한 정보만 근거로 원인들을 화살표로 연결합니다. 이것이 해결되면 다른 원인도 함께 풀리는 원인은 무엇인가요?</p>
   ${un.length ? `<p class="small">미확인 원인(원인 확인 질문 없음): ${un.map(esc).join(" / ")} · 근거가 없으므로 화살표에 쓰지 않습니다.</p>` : ""}<p class="small">수용한 정보 ${acc.length}건${acc.length ? ": " + acc.map(r => esc(r.sum.slice(0, 40)) + (r.sum.length > 40 ? "…" : "")).join(" / ") : ""}</p>
   <ul class="links">${d.links.map((l, i) => `<li><span>${esc(l[0])}</span><span class="arr">→</span><span>${esc(l[1])}</span><button class="btn sm" data-act="del" data-k="s3.links" data-i="${i}" style="margin-left:auto">삭제</button></li>`).join("")}</ul>
   <div class="addrow"><select id="s3-la" aria-label="원인 A"><option value="">원인 A</option>${causes.map(c => `<option>${esc(c)}</option>`).join("")}</select><span class="arr" aria-hidden="true">→</span><select id="s3-lb" aria-label="원인 B"><option value="">원인 B (A 때문에 생기는 것)</option>${causes.map(c => `<option>${esc(c)}</option>`).join("")}</select><button class="btn" data-act="s3link">화살표 추가</button></div>
   <div class="field" style="margin-top:10px"><label for="s3-root">다른 원인을 함께 풀 수 있는 원인</label><select id="s3-root" data-bind="s3.root"><option value="">선택</option>${causes.map(c => `<option ${d.root === c ? "selected" : ""}>${esc(c)}</option>`).join("")}</select></div>
   <h3 style="margin-top:16px">핵심 원인 정하기 <span class="ws">3-3</span> <span class="mins">2'</span></h3><p class="hint">AI의 문장을 옮기지 않고 우리 말로 씁니다. 출처를 확인하지 못한 정보는 근거로 쓰지 않습니다.</p><div class="corebox"><span class="small">모둠이 정한 핵심 원인과 근거</span>${esc(D.persona.name)}의 체류가 불안정한 핵심 원인은 (<input type="text" data-bind="s3.coreC" data-red="s3-coreC" data-st="3" value="${esc(d.coreC)}" style="display:inline-block;width:auto;min-width:min(260px,100%);margin:4px 2px" aria-label="핵심 원인">)이며, 그 근거는 (<input type="text" data-bind="s3.coreE" data-red="s3-coreE" data-st="3" value="${esc(d.coreE)}" style="display:inline-block;width:auto;min-width:min(260px,100%);margin:4px 2px" aria-label="근거">)이다.</div>
   ${redHtml("s3-core", d.coreC + " " + d.coreE)}
   <div class="row"><button class="btn primary" data-act="s3done" ${d.coreC.trim() && d.coreE.trim() && acc.length ? "" : "disabled"}>핵심 원인 공유 · 로그 제출 확인</button>${d.done ? `<span class="seal">제출됨 ${hm(d.doneT)}</span>` : `<span class="small">수용한 정보가 1건 이상 있어야 합니다. 전자칠판에 핵심 원인 문장이 올라갑니다.</span>`}</div></div>`;
  return fl + seal + lockWrap(!(d.sealed && aiOpen(3)), "2단계에서 원인 확인 질문을 봉인하고 선생님이 3단계를 열어야 질의할 수 있습니다.", tbl) + lockWrap(!judged, "모든 질문에 핵심 요약, 직접 확인 결과, 판정과 이유를 적어야 열립니다.", core);
}

/* ---------- 4단계 ---------- */
function s4() {
  const d = W.s4;
  if (!d.pinned && !d.coreEdit && W.s3.coreC) d.coreEdit = `${W.s3.coreC} (근거: ${W.s3.coreE})`;
  const nCase = helpVis("case");
  const judged = d.fb && d.fb.every(f => f.j && f.why.trim() && f.sum.trim());
  const rated = judged && d.fb.every(f => f.r.every(Boolean));
  const fl = flowList([["① 핵심 원인 고정 3'", d.pinned ? "ok" : "now"], ["② 첫 사례 살펴보기 3'", d.pinned && !d.sealed ? "now" : d.sealed ? "ok" : ""], ["③ 대안 만들기 4'", d.pinned && !d.sealed ? "now" : d.sealed ? "ok" : ""], ["④ AI 피드백 판단 2'", d.sealed && !judged ? "now" : judged ? "ok" : ""], ["⑤ 비교표·1순위 4'", judged && d.first === null ? "now" : d.first !== null ? "ok" : ""]]);
  const pin = `<div class="block first"><h3>우리 모둠의 핵심 원인 <span class="ws">4-1</span> <span class="mins">3'</span> ${d.pinned ? `<span class="seal">고정 ${hm(d.pinT)}</span>` : ""}</h3>
   ${d.pinned ? `<div class="corebox">${esc(d.coreEdit)}</div><p class="hint" style="margin-top:8px">오늘 만드는 대안은 이 원인을 해결하기 위한 것이어야 합니다.</p>` : `<p class="hint">지난 시간에 확정한 핵심 원인을 고정합니다. 근거가 약하면 검증표를 보고 문장을 다듬은 뒤 고정합니다.</p><textarea id="s4-core" data-bind="s4.coreEdit" placeholder="1차시 3단계에서 확정한 핵심 원인 문장">${esc(d.coreEdit)}</textarea><div class="row"><button class="btn primary" data-act="s4pin" ${d.coreEdit.trim().length > 5 ? "" : "disabled"}>핵심 원인 고정</button></div>`}</div>`;
  const shown = cases().slice(0, nCase);
  const cs = `<div class="block"><h3>유사 사례에서 아이디어 얻기 <span class="ws">4-2</span> <span class="mins">3'</span> <span class="small">선생님이 공개</span></h3>
   ${nCase ? `<p class="hint">해결책을 고르는 자료가 아닙니다. 그 사례에서는 문제가 어떻게 해결되었는지 살펴보고, 핵심 아이디어를 정리합니다. 아이디어가 더 필요하면 선생님께 다음 사례를 요청합니다.</p><div class="casegrid">${shown.map(({ c, i }) => { const n = d.notes[i] || { idea: "" }; return `<div class="casebox"><span class="small">사례 ${i + 1}${i === 0 ? " · 학급 전체 공개" : " · 추가 공개"}</span><h4>${esc(c.title)}</h4><p class="small" style="margin:0 0 6px"><span class="tag">${esc(c.actor)}</span> 겨냥한 어려움: ${esc(c.aim)}</p><p>${esc(c.body)}</p><span class="small">생각해 볼 점: ${esc(c.ask)}<br>출처: ${esc(c.src)}</span>
     <label class="small" for="s4-id${i}">핵심 아이디어</label><input type="text" id="s4-id${i}" data-bind="s4.notes.${i}.idea" value="${esc(n.idea)}"></div>`; }).join("")}</div>` : pendBox("유사 사례")}
   ${helpVis("alt") ? `<div class="exbox" style="margin-top:12px"><b class="small">선생님이 공개한 대안 예시</b> <span class="small">그대로 옮기지 말고 우리 핵심 원인에 맞게 바꿔 씁니다. 공개 뒤 만든 대안은 '공개 후'로 표시됩니다.</span><ul>${D.altEx.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}</div>`;
  const list = `<ul class="list">${d.alts.map((a, i) => { const sim = overlapWith(a.txt, caseTexts()); return `<li><span class="tag">${esc(a.actor)}</span><span class="txt">${esc(a.txt)}${aftTag(a)}${sim !== null && sim >= .4 ? `<br><span class="simwarn">사례·예시와 표현이 많이 겹칩니다 (${Math.round(sim * 100)}%). 우리 원인과 상황에 맞게 바꿨나요?</span>` : ""}</span>${d.sealed ? "" : `<button class="x" data-act="del" data-k="s4.alts" data-i="${i}">삭제</button>`}</li>`; }).join("")}</ul>`;
  const add = d.sealed ? "" : `<div class="altform"><input type="text" id="s4-txt" placeholder="우리 모둠이 생각한 대안"><select id="s4-actor" aria-label="실행 주체">${D.actors.map(t => `<option>${t}</option>`).join("")}</select><button class="btn" data-act="s4add">추가</button></div>
   <div class="row"><button class="btn primary" data-act="s4seal" ${d.alts.length >= 3 ? "" : "disabled"}>대안 확정 · 봉인</button><span class="small">${d.alts.length}/3개 이상 · 대안마다 실행 주체를 고릅니다.</span></div>`;
  const alt = `<div class="block"><h3>행위 주체별 대안 만들기 <span class="ws">4-3</span> <span class="mins">4'</span> <span class="chip N">AI 미사용</span> ${d.sealed ? `<span class="seal">봉인 ${hm(d.sealT)}</span>` : ""}</h3><p class="hint">각자 기록지에 먼저 생각한 뒤 모둠에서 결합하여 3개 이상 정합니다. 모든 대안은 4-1의 핵심 원인을 해결하기 위한 것이고, 대안마다 실행 주체(국가, 국제기구, 비정부 기구, 세계시민)를 고릅니다.</p>${list}${add}${gateBox(4, d.sealed, "대안표")}</div>`;
  const fb = `<div class="block"><h3>AI 피드백 판단하기 <span class="ws">4-4</span> <span class="mins">2'+</span></h3><p class="hint">대안 검토 도우미는 강점과 약점만 말합니다. 새 대안을 내거나 순위를 매기지 않습니다. 피드백을 우리 말로 요약하고, 수용·수정·기각과 그 이유를 적습니다. 최종 선정은 모둠이 합니다.</p>
   ${d.fb ? `<div class="tablewrap"><table style="min-width:900px"><thead><tr><th>모둠 대안</th><th>AI의 피드백</th><th>강점·약점(우리 말로)</th><th>판단과 이유</th></tr></thead><tbody>${d.fb.map((x, i) => `<tr>
    <td><span class="small">${esc(d.alts[i]?.actor)}</span><br>${esc(d.alts[i]?.txt)}</td>
    <td class="ai-ans"><b class="small">강점</b> ${x.s.map(esc).join(" / ")}<br><b class="small">약점</b> ${x.w.map(esc).join(" / ")}</td>
    <td><textarea id="s4-sum-${i}" data-bind="s4.fb.${i}.sum" data-red="s4-sum-${i}" data-st="4" aria-label="강점·약점 요약">${esc(x.sum)}</textarea>${redHtml("s4-sum-" + i, x.sum)}</td>
    <td><div class="judge" role="group" aria-label="판단">${["수용", "수정", "기각"].map(v => `<button data-act="s4j" data-i="${i}" data-v="${v}" aria-pressed="${x.j === v}">${v}</button>`).join("")}</div><input type="text" data-bind="s4.fb.${i}.why" value="${esc(x.why)}" placeholder="판단 이유(한 문장)" style="margin-top:6px" aria-label="판단 이유"></td></tr>`).join("")}</tbody></table></div>`
    : d.fbWait ? waitHtml({ since: d.fbSince }) : `<button class="btn primary" data-act="s4fb">대안 검토 도우미에 피드백 요청</button>`}
   ${d.fbErr ? `<div class="warnline">${esc(d.fbErr)}</div>` : ""}</div>`;
  const cmp = `<div class="block"><h3>대안 비교표 <span class="ws">4-5</span></h3><p class="hint">각자 1~3점을 매긴 뒤 모둠에서 비교해 모둠 점수를 입력합니다. 실현 가능성: 실행 주체가 실제로 해낼 수 있는가? · 원인 해결 정도: 핵심 원인을 얼마나 해결하는가? · 이해관계자 수용성: 영향을 받는 사람들이 받아들일 수 있는가?</p>
   ${d.fb ? `<div class="tablewrap"><table style="min-width:820px"><thead><tr><th>대안</th>${D.crit.map(c => `<th>${c}</th>`).join("")}<th>합계</th><th>점수의 근거 [선택]</th></tr></thead><tbody>${d.fb.map((x, i) => { const sum = x.r.reduce((a, b) => a + (b || 0), 0); return `<tr><td>${i + 1}. ${esc(d.alts[i]?.txt)}</td>${D.crit.map((c, k) => `<td><div class="scorebtns" role="group" aria-label="${c}">${[1, 2, 3].map(v => `<button data-act="score" data-i="${i}" data-k="${k}" data-v="${v}" aria-pressed="${x.r[k] === v}">${v}</button>`).join("")}</div></td>`).join("")}<td class="num"><b>${sum || "-"}</b></td><td><input type="text" data-bind="s4.fb.${i}.rw" value="${esc(x.rw)}" placeholder="[선택]" aria-label="점수의 근거"></td></tr>`; }).join("")}</tbody></table></div>` : ""}</div>`;
  const tot = d.fb ? d.fb.map(x => x.r.reduce((a, b) => a + (b || 0), 0)) : [];
  const first = `<div class="block"><h3>1순위 대안 정하기 <span class="ws">4-6</span></h3><p class="hint">비교표를 근거로 다른 대안보다 나은 이유를 쓰고, 피드백을 반영해 보완한 내용을 함께 씁니다.</p>
   <div class="checks" style="font-size:14px;gap:6px">${(d.fb || []).map((x, i) => `<label><input type="radio" name="s4first" data-act="first" data-i="${i}" ${d.first === i ? "checked" : ""}> ${esc(d.alts[i]?.txt)} <span class="small">(합계 ${tot[i] || "-"})</span></label>`).join("")}</div>
   ${d.first !== null && tot.length && tot[d.first] < Math.max(...tot) ? `<div class="warnline">합계가 가장 높은 대안이 아닙니다. 그래도 고른 이유를 아래에 함께 씁니다.</div>` : ""}
   <label class="small" for="s4-improve" style="display:block;margin-top:8px">모둠이 정한 1순위 대안, 고른 이유와 보완한 내용</label><textarea id="s4-improve" data-bind="s4.improve" data-red="s4-improve" data-st="4">${esc(d.improve)}</textarea>${redHtml("s4-improve", d.improve)}</div>`;
  return fl + pin + lockWrap(!d.pinned, "핵심 원인을 고정해야 열립니다.", cs + alt) + lockWrap(!(d.sealed && aiOpen(4)), "대안을 봉인하고 선생님이 단계를 열어야 피드백을 받을 수 있습니다.", fb) + lockWrap(!judged, "모든 피드백에 요약, 판단, 이유를 적어야 열립니다.", cmp) + lockWrap(!rated, "비교표 점수를 모두 매겨야 1순위를 고를 수 있습니다.", first);
}

/* ---------- 5단계 ---------- */
function s5() {
  const d = W.s5, fa = firstAltOf(W);
  const nIn = d.preds.filter(p => !p.ex).length, nEx = d.preds.filter(p => p.ex).length;
  const chosen = d.whySaved;
  const fl = flowList([["반응 예측 4'", d.sealed ? "ok" : "now"], ["AI 시나리오 2'", d.sealed && !d.scen ? "now" : d.scen ? "ok" : ""], ["고르기와 이유", d.scen && !chosen ? "now" : chosen ? "ok" : ""], ["예상하지 못한 문제", chosen && !d.newp.trim() ? "now" : d.newp.trim() ? "ok" : ""]]);
  const p = `<div class="block first"><h3>이해관계자 반응 예측하기 <span class="ws">5-1·5-2</span> <span class="mins">4'</span> <span class="chip N">AI 미사용</span> ${d.sealed ? `<span class="seal">봉인 ${hm(d.sealT)}</span>` : ""}</h3>
   <p class="small" style="margin:0 0 6px">우리 1순위 대안: <b>${esc(fa || "4단계에서 1순위 대안을 먼저 정합니다.")}</b></p>
   <p class="hint">AI 없이 먼저 모둠원들과 토의하여 예측합니다. 1순위 대안이 실행되면 영향을 받는 사람을 2명 이상 찾고, 각자 어떻게 반응할지 근거와 함께 씁니다. <span class="ws">5-1</span></p>
   <ul class="list">${d.preds.map((x, i) => `<li><span class="tag ${x.ex ? "off" : ""}">${esc(x.who)}${x.ex ? " · 목소리를 내기 어려움" : ""}</span><span class="txt">${esc(x.txt)}${x.reason ? `<br><span class="small">그렇게 예측한 이유: ${esc(x.reason)}</span>` : ""}${x.why ? `<br><span class="small">목소리를 내기 어려운 이유: ${esc(x.why)}</span>` : ""}${aftTag(x)}</span>${d.sealed ? "" : `<button class="x" data-act="del" data-k="s5.preds" data-i="${i}">삭제</button>`}</li>`).join("")}</ul>
   ${d.sealed ? "" : `<div class="addrow"><input type="text" id="s5-who" placeholder="이해관계자" style="flex:0 1 180px"><input type="text" id="s5-txt" placeholder="예측한 반응"><input type="text" id="s5-rsn" placeholder="그렇게 예측한 이유"><button class="btn" data-act="s5add">추가</button></div>
   ${helpVis("who") ? `<div class="exbox"><b class="small">선생님이 공개한 이해관계자 예시</b> <span class="small">누르면 이해관계자 칸에 들어갑니다. 반응은 모둠이 직접 예측합니다.</span><div class="chips">${D.whoEx.map(w => `<button class="chipbtn" data-act="whoex" data-v="${esc(w)}">${esc(w)}</button>`).join("")}</div></div>` : pendBox("이해관계자 예시")}
   <div class="exq"><b>목소리를 내기 어려운 이해관계자 <span class="ws">5-2</span></b><p class="small" style="margin:2px 0 8px">이 대안을 정하는 자리에 없었던 사람, 영향을 받지만 의견을 말하기 어려운 사람은 누구일까요? 한 명 이상 찾아 추가합니다.</p>
    <div class="altform"><input type="text" id="s5-exwho" placeholder="이해관계자"><input type="text" id="s5-exwhy" placeholder="왜 목소리를 내기 어려운가"><input type="text" id="s5-extxt" placeholder="예측한 반응과 이유"><button class="btn" data-act="s5exadd">추가</button></div></div>
   <div class="row"><button class="btn primary" data-act="s5seal" ${nIn >= 2 && nEx >= 1 && fa ? "" : "disabled"}>예측 확정 · 봉인</button><span class="small">이해관계자 ${nIn}/2명 이상 · 목소리를 내기 어려운 이해관계자 ${nEx}/1명 이상</span></div>`}
   ${gateBox(5, d.sealed, "반응 예측")}</div>`;
  const sc = d.scen;
  const scen = `<div class="block"><h3>시나리오 읽기 메모 <span class="ws">5-3</span> <span class="mins">2'</span></h3><p class="hint">대안이 실행된 뒤 일어날 수 있는 장면을 이야기로 보여 줍니다. 미래를 맞히는 예언이 아니라 가능한 전개 가운데 하나입니다. 이야기 속에서 우리 예측과 다른 점, 문제가 될 만한 장면을 직접 찾아봅시다.</p>
   ${sc ? `<div class="stories">${["A", "B", "C"].map(k => `<article class="story ${d.pick === k ? "sel" : ""}"><h4><span class="scen-l">시나리오 ${k}</span>${esc(sc[k].title)}</h4>${sc[k].story.map(x => `<p>${esc(x)}</p>`).join("")}<label class="small" style="display:flex;gap:6px;align-items:center;margin-top:8px;font-weight:600;color:var(--ink)"><input type="radio" name="s5pick" data-act="pick" data-v="${k}" ${d.pick === k ? "checked" : ""} ${chosen ? "disabled" : ""}> 시나리오 ${k}가 가장 개연성 있다</label></article>`).join("")}</div>
   ${ai.mode === "demo" ? `<p class="small">미리 넣은 예시 시나리오입니다. 대안 '인도적 체류 허가의 연장 기간을 늘린다'를 바탕으로 만들었으므로 우리 대안과 맞지 않을 수 있습니다.</p>` : ""}
   <div class="tablewrap" style="margin-top:12px"><table style="min-width:760px"><thead><tr><th>구분</th>${["A", "B", "C"].map(k => `<th>시나리오 ${k}</th>`).join("")}</tr></thead><tbody>
    <tr><td>요약(우리 말로)</td>${["A", "B", "C"].map(k => `<td><textarea data-bind="s5.sum.${k}" data-red="s5-sum-${k}" data-st="5" aria-label="${k} 요약">${esc(d.sum[k])}</textarea>${redHtml("s5-sum-" + k, d.sum[k])}</td>`).join("")}</tr>
    <tr><td>우리 예측과 다른 점</td>${["A", "B", "C"].map(k => `<td><textarea data-bind="s5.diff.${k}" aria-label="${k} 예측과 다른 점">${esc(d.diff[k])}</textarea></td>`).join("")}</tr></tbody></table></div>
   <h3 style="margin-top:16px">가장 개연성 있는 시나리오 고르기 <span class="ws">5-4</span></h3><label class="small" for="s5-why" style="display:block">${d.pick ? `모둠이 시나리오 ${d.pick}를 고른 이유를 우리 예측과 비교해 씁니다. (20자 이상)` : "시나리오 A, B, C 가운데 하나를 먼저 고르세요."}</label><textarea id="s5-why" data-bind="s5.why" data-red="s5-why" data-st="5" ${chosen || !d.pick ? "readonly" : ""} placeholder="우리 예측과의 일치·차이, 유사 사례의 실제 결과, 근거 자료를 들어 씁니다.">${esc(d.why)}</textarea>${redHtml("s5-why", d.why)}
   <div class="row">${chosen ? `<span class="seal">저장됨 ${hm(d.whyT)} · 시나리오 ${esc(d.pick)}</span><button class="btn" data-act="s5edit">고치기</button>` : `<button class="btn primary" data-act="s5why" id="s5-whybtn" ${d.pick && d.why.trim().length >= 20 ? "" : "disabled"}>저장</button><span class="small" id="s5-whycnt">${d.why.trim().length}자 · 20자 미만이면 저장되지 않습니다.</span>`}</div>`
    : d.wait ? waitHtml({ since: d.since }) : `<button class="btn primary" data-act="s5gen">시나리오 A·B·C 만들기</button>`}
   ${d.err ? `<div class="warnline">${esc(d.err)}</div>` : ""}</div>`;
  const np = `<div class="block"><h3>예상하지 못한 문제 찾기 <span class="ws">5-5</span></h3><p class="hint">시나리오에는 문제가 요약되어 있지 않습니다. 고른 이야기의 어느 장면에서 대안이 낳은 문제를 발견했나요? 그 장면에서 누가 어떤 어려움을 겪는지, 왜 그런 일이 생겼는지 우리 말로 씁니다.</p><textarea id="s5-newp" data-bind="s5.newp" data-red="s5-newp" data-st="5">${esc(d.newp)}</textarea>${redHtml("s5-newp", d.newp)}</div>`;
  return fl + p + lockWrap(!(d.sealed && aiOpen(5)), "반응 예측을 봉인하고 선생님이 단계를 열어야 시나리오가 열립니다.", scen) + lockWrap(!chosen, "시나리오를 고르고 이유를 저장해야 열립니다.", np);
}

/* ---------- 6단계 ---------- */
function s6() {
  const d = W.s6;
  const lvIdx = D.levels.indexOf(d.level), types = d.types;
  const self = types.length && types.every(t => t === "자기 실천");
  const mismatch = lvIdx === 2 && self ? "제도·국가 간 문제인데 자기 실천만 골랐습니다. 제도 제안·요청이나 설득도 생각해 볼까요?" : lvIdx === 1 && self ? "학교·지역 문제인데 자기 실천만 골랐습니다. 기관에 요청하거나 이해관계자를 설득하는 행동도 생각해 볼까요?" : "";
  const needProp = types.some(t => t !== "자기 실천");
  const opt = (arr, key, multi) => `<div class="opts">${arr.map(o => { const n = typeof o === "string" ? o : o.n; const on = multi ? d[key].includes(n) : d[key] === n; return `<button class="opt" data-act="${multi ? "tog" : "set"}" data-k="s6.${key}" data-v="${esc(n)}" aria-pressed="${on}">${esc(n)}${o.d || o.ex ? `<small>${esc(o.d || o.ex)}</small>` : ""}</button>`; }).join("")}</div>`;
  const fl = flowList([["수준·행동 유형 3'", d.level && types.length ? "ok" : "now"], ["행동계획표 6'", d.plans.some(p => p.target && p.content) && d.scope ? "ok" : d.level && types.length ? "now" : ""], ["제안서 [선택]", ""], ["제출 전 점검", d.tok ? "ok" : ""], ["결과 기록(6차시)", d.resOpen ? "ok" : ""]]);
  const tp = `<div class="block first"><h3>5단계에서 찾은 예상하지 못한 문제</h3><div class="corebox">${W.s5.newp.trim() ? esc(W.s5.newp) : '<span class="small">5단계에서 문제를 먼저 찾습니다.</span>'}</div></div>`;
  const lvl = `<div class="block"><h3>문제는 어느 수준에서 생기나요? <span class="ws">6-1</span> <span class="mins">3'</span> <span class="chip N">AI 미사용</span></h3><p class="hint">행동의 규모를 문제의 규모에 맞추기 위해 먼저 판단합니다.</p>${opt(D.levels, "level")}</div>`;
  const act = `<div class="block"><h3>어떤 행동을 할까요? <span class="ws">6-2</span></h3><p class="hint">문제 수준에 맞는 행동 유형을 고르고 이유를 씁니다. 여러 유형을 골라도 됩니다.</p>${opt(D.actTypes, "types", true)}
   <div class="field" style="margin-top:8px"><label for="s6-tw">이유</label><input type="text" id="s6-tw" data-bind="s6.typeWhy" value="${esc(d.typeWhy)}"></div>
   ${mismatch ? `<div class="warnline">${mismatch}</div>` : ""}</div>`;
  const plan = `<div class="block"><h3>행동계획표 <span class="ws">6-3</span> <span class="mins">6'</span></h3><p class="hint">대상, 내용, 방법, 제출 경로를 쓰고 실행 범위, 결과 확인 시점, 기대와 다를 때 돌아갈 단계를 정합니다. 실제로 제출하거나 전달하지 않아도 됩니다.</p>
   <div class="tablewrap"><table style="min-width:820px"><thead><tr><th></th><th>대상</th><th>내용</th><th>방법</th><th>제출 경로</th></tr></thead><tbody>${d.plans.map((p, i) => `<tr><td class="num">${i + 1}</td>${[["target", "대상"], ["content", "내용"], ["how", "방법"], ["channel", "제출 경로"]].map(([k, l]) => `<td><input type="text" data-bind="s6.plans.${i}.${k}" data-chk6="1" value="${esc(p[k])}" aria-label="${l}" ${k === "channel" ? 'placeholder="예: 국민신문고, 기관 누리집, 학교 누리집, 직접 전달"' : ""}></td>`).join("")}</tr>`).join("")}</tbody></table></div>
   <div class="row"><button class="btn" data-act="s6addplan">줄 추가</button></div><div id="s6-auto">${autoChk6()}</div>
   <div class="field" style="margin-top:12px"><span class="lab">실행 범위</span>${opt(D.scopes, "scope")}</div>
   <div class="grid2" style="margin-top:10px"><div class="field"><label for="s6-when">결과 확인 시점</label><input type="text" id="s6-when" data-bind="s6.when" value="${esc(d.when)}" placeholder="예: 제출 2주 뒤 학급 회의 시간"></div>
    <div class="field"><span class="lab">기대와 다를 때 돌아갈 단계</span>${opt(D.back, "back", true)}</div></div></div>`;
  const ev = W.s3.rows.filter(r => r.j === "수용").map(r => r.src.join(", ")).filter(Boolean);
  const ob = W.s5.preds.map(p => p.who + ": " + p.txt);
  const prop = `<div class="block"><h3>제안서·편지 쓰기 <span class="ws">6-4</span> <span class="small">[선택]</span></h3>${needProp ? `<p class="hint">6-2에서 제도 제안·요청이나 설득을 고른 모둠만 씁니다. 문제·근거·예상 반대 칸에는 앞 단계 내용이 자동으로 들어옵니다. 시간이 부족하면 건너뛰고 다음 시간 전까지 완성합니다.</p>
   <div class="propform">
    <div class="pf"><span class="pf-k">문제</span><div>${esc(W.s5.newp || "(5단계에서 아직 쓰지 않음)")}<span class="pf-src">5단계에서 발견한 문제</span></div></div>
    <div class="pf"><span class="pf-k">근거</span><div>${esc(coreTextOf(W) || "(핵심 원인 없음)")}${ev.length ? `<br><span class="small">검증한 자료: ${esc(ev.join(" / "))}</span>` : ""}<span class="pf-src">3단계 핵심 원인과 검증한 자료</span></div></div>
    <div class="pf"><span class="pf-k">제안</span><div><textarea data-bind="s6.prop.ask" placeholder="무엇을 바꿔 달라고, 또는 무엇을 함께하자고 할까요?" aria-label="제안">${esc(d.prop.ask)}</textarea></div></div>
    <div class="pf"><span class="pf-k">예상 반대와 대응</span><div>${ob.length ? `<ul class="pf-ul">${ob.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : '<span class="small">(5단계 반응 예측 없음)</span>'}<span class="pf-src">5단계 이해관계자 반응</span><textarea data-bind="s6.prop.reply" placeholder="반대하는 사람의 걱정에 어떻게 답할까요?" style="margin-top:6px" aria-label="예상 반대에 대한 대응">${esc(d.prop.reply)}</textarea></div></div>
    <div class="pf"><span class="pf-k">기대 효과</span><div><textarea data-bind="s6.prop.effect" placeholder="받아들여지면 무엇이 달라지나요?" aria-label="기대 효과">${esc(d.prop.effect)}</textarea></div></div>
   </div>` : `<div class="pend"><b>제안서 틀</b><span>6-2에서 제도 제안·요청이나 설득을 고르면 열립니다.</span></div>`}</div>`;
  const all = d.chk.every(Boolean);
  const check = `<div class="block"><h3>제출 전 점검 <span class="ws">6-5</span></h3><p class="hint">밖으로 보내려면 먼저 선생님의 확인을 받습니다.</p>
   <div class="checks" style="font-size:14px;gap:6px">${D.chk6.map((c, k) => `<label><input type="checkbox" data-bind="s6.chk.${k}" ${d.chk[k] ? "checked" : ""}> ${esc(c)}</label>`).join("")}</div>
   <div class="row">${d.tok ? `<span class="seal">선생님 확인 ${hm(d.tokT)}</span>${d.tnote ? `<span class="small">선생님: ${esc(d.tnote)}</span>` : ""}` : all ? `<span class="small">선생님 확인을 기다리는 중입니다.</span>${demoBtn('data-act="t6ok"', "리허설: 선생님 확인")}` : '<span class="small">두 항목을 모두 확인해야 선생님께 확인 요청이 갑니다.</span>'}</div></div>`;
  const r = d.res;
  const result = `<div class="block"><h3>결과 기록 <span class="ws">6-6</span></h3><p class="hint">결과 확인 시점에 씁니다. 결과를 함께 공유할 날짜는 6-3의 결과 확인 시점에 맞춰 선생님과 함께 정합니다.</p>
   ${d.resOpen ? `<div style="display:grid;gap:8px"><div class="field"><label for="s6-rh">언제 어떻게 실행했나요?</label><textarea id="s6-rh" data-bind="s6.res.how">${esc(r.how || "")}</textarea></div>
    <div class="field"><label for="s6-rw">무슨 일이 있었나요?</label><textarea id="s6-rw" data-bind="s6.res.what">${esc(r.what)}</textarea></div></div>`
    : `<div class="pend"><b>아직 결과 확인 시점이 아닙니다</b><span>6-3에서 정한 결과 확인 시점에 선생님이 엽니다.</span>${demoBtn('data-act="s6res"', "리허설: 6차시로 가정하기", "margin:6px 0 0;align-self:flex-start")}</div>`}</div>`;
  return fl + tp + lvl + act + plan + prop + check + result;
}
function autoChk6() { const d = W.s6; const t = [...d.plans.flatMap(p => [p.target, p.content, p.how]), d.prop.ask, d.prop.reply, d.typeWhy].join(" "); return (BIAS.test(t) ? `<div class="warnline r">특정 집단을 일반화하는 표현이 있는지 다시 확인합니다.</div>` : "") + (PI.test(t) ? `<div class="warnline r">전화번호나 이메일 같은 개인정보가 들어 있습니다.</div>` : ""); }

/* ---------- 7단계 ---------- */
// 다른 모둠 평가: 같은 수업에서 흐름을 정리한 모둠이 있으면 그 모둠을, 없으면 견본의 예시 모둠을 보여 준다.
function peerList() {
  const real = Object.entries(doc.groups).filter(([g]) => +g !== G).map(([g, x]) => ({ g: `${g}모둠`, flow: chainOf(x.work).map(c => c[1] || "") })).filter(p => p.flow.filter(Boolean).length >= 3);
  return real.length >= 2 ? real : D.peers.map(p => ({ ...p, g: p.g + " (예시)" }));
}
function s7() {
  const d = W.s7, ch = chainOf(W), P = D.persona;
  const share = `<div class="block first"><h3>문제 해결 흐름 정리 <span class="ws">7-1</span> <span class="mins">4'</span> <span class="small">[선택]</span></h3><p class="hint">문제 → 핵심 원인 → 대안 → 예상하지 못한 문제 → 행동계획의 흐름을 공유 게시판(패들렛)에 올립니다. '문제'는 모둠이 한 문장으로 쓰고, 나머지는 앞 단계 내용이 자동으로 들어옵니다.</p>
   <ul class="chain2"><li><span>문제</span><span><input type="text" data-bind="s7.problem" value="${esc(d.problem)}" placeholder="예: 전쟁을 피해 온 예멘 난민 신청자가 제주에서도 안정적으로 지내기 어렵다" aria-label="문제"></span></li>${ch.slice(1).map(([k, v]) => `<li><span>${esc(k)}</span><span>${v ? esc(v) : '<span class="small">아직 작성하지 않음</span>'}</span></li>`).join("")}</ul>
   <div class="row"><button class="btn" data-act="copy">게시판에 붙일 글 복사</button><span class="small" id="copy-note">${d.posted ? "복사했습니다. 공유 게시판에 붙여 넣으세요." : ""}</span></div></div>`;
  const PEERS = peerList();
  const peer = `<div class="block"><h3>다른 모둠의 문제 해결 과정 평가하기 <span class="ws">7-2</span></h3><p class="hint">다른 모둠 두 곳을 골라 네 가지 기준으로 평가하고 댓글을 남깁니다. 4: 매우 그렇다 · 3: 그렇다 · 2: 그렇지 않다 · 1: 전혀 그렇지 않다</p>
   <div class="opts" style="margin-bottom:10px">${PEERS.map(p => `<button class="opt" data-act="peerpick" data-v="${esc(p.g)}" aria-pressed="${d.peers.includes(p.g)}" ${!d.peers.includes(p.g) && d.peers.length >= 2 ? "disabled" : ""}>${esc(p.g)}</button>`).join("")}</div>
   <div class="grid2">${PEERS.filter(p => d.peers.includes(p.g)).map(p => { const sc = d.peer[p.g] || [0, 0, 0, 0]; return `<div class="peer"><h4>${esc(p.g)}</h4><ul class="chain2">${D.chain.map((c, i) => `<li><span>${c}</span><span>${esc(p.flow[i])}</span></li>`).join("")}</ul>
    <table class="scale"><thead><tr><th>#</th><th>기준</th><th>4</th><th>3</th><th>2</th><th>1</th></tr></thead><tbody>${D.peerCrit.map((c, k) => `<tr><td class="num">${k + 1}</td><td style="font-size:13px">${c}</td>${[4, 3, 2, 1].map(v => `<td><input type="radio" name="pr-${esc(p.g)}-${k}" data-act="peer" data-g="${esc(p.g)}" data-k="${k}" data-v="${v}" ${sc[k] === v ? "checked" : ""} aria-label="${v}점"></td>`).join("")}</tr>`).join("")}</tbody></table>
    <div class="field"><label>배울 점과 우리 모둠이 보완할 점<textarea data-bind="s7.note.${esc(p.g)}">${esc(d.note[p.g] || "")}</textarea></label></div></div>`; }).join("")}</div></div>`;
  const by = [1, 3, 4, 5].map(n => ({ n, seal: grp.logs.filter(l => l.stage === n && l.kind === "seal").length, ai: grp.logs.filter(l => l.stage === n && l.kind === "ai").length, red: grp.alerts.filter(a => a.stage === n && a.kind === "red").length }));
  const rec = `<div class="block"><h3>우리 모둠의 AI 사용 기록 <span class="small">7-3 작성 참고</span></h3><p class="hint">성찰은 이 기록에 근거합니다. 기록은 자동으로 모였고 고칠 수 없습니다.</p>
   <div class="tablewrap"><table style="min-width:420px"><thead><tr><th>단계</th><th>먼저 생각한 내용 봉인</th><th>AI 사용</th><th>Red 의심</th></tr></thead><tbody>${by.map(b => `<tr><td>${b.n}단계</td><td class="num">${b.seal}</td><td class="num">${b.ai}</td><td class="num">${b.red}</td></tr>`).join("")}</tbody></table></div></div>`;
  const refl = `<div class="block"><h3>AI 활용 성찰 체크리스트 (개인) <span class="ws">7-3</span> <span class="mins">3'</span> <span class="chip N">AI 미사용</span></h3><p class="hint">지난 시간과 오늘의 로그, 기록지를 보며 두 차시 동안 AI를 활용한 과정을 돌아봅니다.</p>
   <div class="tablewrap"><table class="scale" style="min-width:640px"><thead><tr><th>#</th><th>문항</th><th>영역</th><th>그렇다</th><th>보통</th><th>아니다</th></tr></thead><tbody>${D.refl.map((r, i) => `<tr><td class="num">${i + 1}</td><td style="text-align:left">${esc(r[1])}</td><td class="small">${esc(r[0])}</td>${["그렇다", "보통", "아니다"].map(v => `<td><input type="radio" name="refl${i}" data-act="refl" data-i="${i}" data-v="${v}" ${d.chk[i] === v ? "checked" : ""} aria-label="${v}"></td>`).join("")}</tr>`).join("")}</tbody></table></div>
   <h3 style="margin-top:16px">내 생각은 어떻게 달라졌나요? <span class="ws">7-4</span></h3><div class="grid2"><div class="field"><label for="s7-r1">처음 편지를 읽었을 때와 비교하여, 난민 신청자가 겪는 어려움의 원인에 대한 내 생각은 어떻게 달라졌나요?</label><textarea id="s7-r1" data-bind="s7.r1">${esc(d.r1)}</textarea></div>
    <div class="field"><label for="s7-r2">AI 피드백이나 시나리오 가운데 받아들이지 않은 것 하나와, 그렇게 판단한 이유는 무엇인가요?</label><textarea id="s7-r2" data-bind="s7.r2">${esc(d.r2)}</textarea></div></div></div>`;
  const end = `<div class="block"><h3>다시 읽는 ${esc(P.name)}의 편지</h3><div class="letter"><p>${esc(P.letter[P.letter.length - 1])}</p></div><p class="hint" style="margin-top:8px">${esc(P.name)}는 편지 끝에서 "너희라면 나를 어떻게 생각할지"를 물었습니다. 오늘 우리는 그 질문에 근거와 계획으로 답해 보았습니다. 실천의 결과는 6차시에 함께 확인합니다.</p></div>`;
  return share + peer + rec + refl + end;
}

/* ================= AI 호출 ================= */
const streamText = {};
async function personaReply(qText) {
  const d = W.s1; const first = d.first; d.first = false;
  const idx = d.chat.push({ r: "ai", x: "", wait: true, since: Date.now() }) - 1;
  flush(); render();
  let text = "";
  try {
    text = await ai.persona(qText, first, t => { streamText[idx] = t; const el = document.querySelector(`#m-${idx} .body`); if (el) el.textContent = t; });
  } catch (e) { text = ""; W.s1.chat.push({ r: "sys", x: "응답을 받지 못했습니다. 다시 시도해 보세요." }); }
  delete streamText[idx];
  const m = W.s1.chat[idx];
  if (m && m.wait) { m.x = text; m.wait = false; delete m.since; if (!text) W.s1.chat.splice(idx, 1); }
  flush();
  if (text) { log(1, "ai", `${D.persona.name} 응답`); if (BIAS.test(text)) alertAdd(1, "bias", "AI 응답에 일반화로 보이는 표현: " + text.slice(0, 50), "bias-" + idx); }
  render();
}
async function searchAsk(i, follow) {
  const r = W.s3.rows[i]; r.wait = true; r.err = ""; r.since = Date.now(); flush(); render();
  try {
    if (follow) r.fu = await ai.follow(r.q, r.ans);
    else { const o = await ai.search(r.q); r.ans = o.a; r.src = o.src; }
  } catch (e) { r.err = "응답을 받지 못했습니다. 다시 시도해 보세요."; }
  const rr = W.s3.rows[i]; if (rr) { Object.assign(rr, { ans: r.ans, src: r.src, fu: r.fu, err: r.err }); rr.wait = false; delete rr.since; }
  flush(); if (!r.err) log(3, "ai", (follow ? "근거 다시 묻기" : "자료 탐색 응답") + `(질문 ${i + 1})`); render();
}
async function feedback() {
  const d = W.s4; d.fbWait = true; d.fbErr = ""; d.fbSince = Date.now(); flush(); render();
  let fb = null;
  try { fb = (await ai.feedback(coreTextOf(W), d.alts)).map(x => ({ s: x.s, w: x.w, sum: "", j: "", why: "", r: [0, 0, 0], rw: "" })); }
  catch (e) { W.s4.fbErr = "응답을 받지 못했습니다. 다시 시도해 보세요."; }
  W.s4.fb = fb; W.s4.fbWait = false; delete W.s4.fbSince; flush();
  if (fb) log(4, "ai", "대안 검토 피드백"); render();
}
async function scenarios() {
  const d = W.s5; d.wait = true; d.err = ""; d.since = Date.now(); flush(); render();
  let sc = null;
  try { sc = await ai.scenarios(firstAltOf(W), d.preds); } catch (e) { W.s5.err = "응답을 받지 못했습니다. 다시 시도해 보세요."; }
  W.s5.scen = sc; W.s5.wait = false; delete W.s5.since; flush();
  if (sc) log(5, "ai", "시나리오 A·B·C 생성"); render();
}

/* ================= 1단계 시간 ================= */
setInterval(() => {
  if (!W || !code) return;
  const el = $("#s1-timer"), d = W.s1;
  if (el) { el.textContent = timerText(); el.classList.toggle("low", !!d.deadline && d.deadline - Date.now() < 60000); }
  if (d.deadline && Date.now() >= d.deadline) {
    flush();
    store.update(code, x => {
      const s = x.groups[G].work.s1;
      if (!s.deadline || Date.now() < s.deadline) return;
      s.deadline = null;
      if (s.phase === 1 && !s.chat.some(m => m.wait)) {
        s.phase = 2; s.chat.push({ r: "sys", x: "1차 대화 시간이 끝났습니다. 대화를 멈추고 모둠에서 더 필요한 질문을 합의합니다." }); s.deadline = Date.now() + 60000;
        pushLog(x.groups[G], 1, "seal", "1차 대화 종료(시간)");
      }
    });
  }
}, 500);

/* ================= 리허설용 예시(견본의 시연 예시와 같은 내용) ================= */
const DEMO = {
  1: () => { const d = W.s1; if (d.sealed) return; const a = !!helpVis("q1"); d.qs = [{ t: "말레이시아에서 왜 다른 나라가 아니라 제주로 오기로 했어?", type: 1 }, { t: "제주에 도착한 뒤 하루를 어떻게 보내고 있어?", type: 0 }, { t: "난민 신청을 한 뒤에 어떤 일을 기다리고 있어?", type: 1 }, { t: "제주 사람들은 너를 처음 만났을 때 어떻게 대했어?", type: 2 }, { t: "뉴스에 너희 이야기가 나온 뒤 달라진 점이 있어?", type: 2 }].map(q => ({ ...q, aft: a })); },
  2: () => {
    const d = W.s2;
    d.qa = d.qa.map((v, i) => v || (D.qa[i].type === "ox" ? D.qa[i].a : ["무사증 제도로 비자 없이 한 달 머물 수 있었고, 2017년 12월 쿠알라룸푸르–제주 직항이 생겼다.", "", "", " 2명, 후티 반군을 비판한 언론인이라 박해 가능성이 높다고 봄", "", "1년"][i].trim()));
    W.s1.chat.forEach((m, i) => { if (m.r === "ai" && !m.wait && !d.cls[i]) { d.cls[i] = /비자|비행기|제주 밖|섬 안/.test(m.x) ? { v: "확인된 이야기", art: "1" } : { v: "창작된 이야기", art: "" }; } });
    const L = d.life; L.same = L.same || "유수프도 대학에 가고 싶어 했고, 가족이 걱정할까 봐 연락을 자주 하려 한다."; L.place = L.place || "폭격 소리를 들으며 학교에 가지 못했을 것이다. 지금 내가 겪지 않는 것은 노력 때문이 아니라 사는 곳이 달라서다."; L.impact = L.impact || "같은 학교나 동네에서 만나 함께 지내는 이웃이 된다. 내가 가진 생각을 다시 보게 될 것이다."; L.act = L.act || "확인하지 않은 말이나 댓글을 퍼뜨리면 여론이 나빠지고, 그 여론이 유수프가 머물 수 있는지에도 영향을 줄 수 있다.";
    if (!helpVis("art")) mutate(x => revealHelp(x, D, "art", "all"));
    if (!d.guesses.length) d.guesses = [{ t: "난민 인정을 받기가 매우 어렵다" }, { t: "인정받지 못하면 1년마다 체류를 연장해야 해서 오래 계획을 세우기 어렵다" }, { t: "제주 밖으로 나갈 수 없어서 일자리를 구할 곳이 좁다" }, { t: "뉴스와 댓글 때문에 반대 여론이 커졌다" }];
    if (!W.s3.sealed && d.vq.length < NEED) { const Gs = d.guesses.map(g => g.t); d.vq = [{ q: "2018년 제주의 예멘인 신청자 가운데 난민으로 인정된 사람은 몇 명이고, 어떤 이유로 인정되었나?", cause: Gs[0] }, { q: "인도적 체류 허가를 받으면 한 번에 얼마 동안 머물 수 있고, 난민 인정자와 지원은 어떻게 다른가?", cause: Gs[1] }, { q: "출도 제한은 언제부터였고, 그동안 예멘인 신청자가 일할 수 있었던 업종은 무엇인가?", cause: Gs[2] }, { q: "2018년 여론조사에서 예멘 난민 수용에 찬성·반대한 비율은 얼마였나?", cause: Gs[3] || Gs[0] }]; }
  },
  3: () => {
    const d = W.s3; syncRows(); const who = nicks(); d.rows.forEach((r, i) => { if (!r.who && who.length) r.who = who[i % who.length]; });
    const SUM = ["심사를 끝까지 받은 사람 중 난민으로 받아들여진 건 단 두 명이다. 나머지 대다수는 1년짜리 인도적 체류에 그쳤다.", "인도적 체류는 1년이 최대라 해마다 연장해야 한다. 건강보험 조건은 AI도 확인하지 못했다.", "4월 30일부터 제주 밖으로 나갈 수 없었다. 일할 수 있는 업종은 AI가 답하지 못했다.", "6월 조사에서 반대가 찬성보다 10%p쯤 많았고, 폐지 청원에도 40만 명 넘게 참여했다."], RES = ["제주출입국·외국인청 게시글과 뉴시스 기사에서 숫자가 같음", "세계일보 2023 기사와 같음. 건강보험 조건은 찾지 못함", "출도 날짜는 뉴시스 기사와 같음. 업종은 서울신문 2018. 7. 23. 기사에서 1차 산업·요식업으로 확인", "뉴시스 2018. 6. 28. 기사와 수치가 같음"], WHY = ["제주출입국·외국인청 원문과 수치가 같다.", "세계일보 원문에서 1년 상한을 확인했다.", "출도 날짜가 기사와 같다. 업종은 따로 찾아 보완했다.", "기사 원문과 수치가 같다."];
    d.rows.forEach((r, i) => { if (!r.ans) return; r.sum = r.sum || SUM[i] || ""; r.res = r.res || RES[i] || ""; r.ck = [true, true, true, i !== 1]; r.j = r.j || "수용"; r.why = r.why || WHY[i] || ""; });
    const C = W.s2.guesses.map(g => g.t); if (C.length >= 3 && !d.links.length) d.links = [[C[0], C[1]], [C[3] || C[2], C[0]]]; d.root = d.root || C[0] || "";
    d.coreC = d.coreC || "난민 인정이 매우 적고 대부분 1년마다 연장해야 하는 인도적 체류 허가에 머무는 제도"; d.coreE = d.coreE || "484명 가운데 인정 2명, 인도적 체류 412명이고 인도적 체류는 1년이 상한(기사 3)";
  },
  4: () => {
    const d = W.s4; if (!d.pinned) d.coreEdit = d.coreEdit || coreTextOf(W) || "난민 인정이 매우 적고 대부분 1년마다 연장해야 하는 인도적 체류 허가에 머무는 제도 (근거: 기사 3)";
    if (!d.notes[0].idea) d.notes[0].idea = "직접 갈 수 없게 되자 온라인 모금과 물품 제작처럼 학생이 할 수 있는 방식으로 바꾸었다.";
    if (d.notes[1] && !d.notes[1].idea) d.notes[1].idea = "일할 수 있게 허가하고 설명회·통역으로 일자리를 이었지만, 한국어·직무 교육이 없어 40%가 그만두었다.";
    if (!d.sealed && !d.alts.length) { const a = helpAfter("case"); d.alts = [{ txt: "인도적 체류 허가의 연장 기간을 1년에서 3년으로 늘린다", actor: "국가", aft: a }, { txt: "지역 단체가 체류 연장 서류 준비와 한국어 상담을 돕는다", actor: "비정부 기구", aft: a }, { txt: "확인된 자료로 난민 제도를 설명하는 카드뉴스를 만들어 학교 누리집에 올린다", actor: "세계시민", aft: a }]; }
    if (d.fb) { const S0 = ["모두에게 한 번에 적용되지만 법을 바꾸려면 오래 걸리고 반대도 클 수 있다.", "당사자를 바로 도울 수 있지만 돈과 사람이 모자라면 오래 못 간다.", "지금 바로 할 수 있지만 효과가 작고 잘못 쓰면 오해를 키운다."], J = ["수정", "수용", "수용"], Wh = ["제안하는 절차를 대안에 넣기로 했다.", "예산 문제는 지자체 지원을 함께 요청해 보완한다.", "출처를 모두 밝히면 오해를 줄일 수 있다."], R = [[2, 3, 1], [3, 2, 3], [3, 1, 2]], RW = ["원인을 직접 바꾸지만 반대가 클 것이다.", "바로 할 수 있고 받아들이기 쉽지만 제도는 그대로다.", "쉽지만 핵심 원인과는 거리가 있다."]; d.fb.forEach((f, i) => { f.sum = f.sum || S0[i] || ""; f.j = f.j || J[i] || "수용"; f.why = f.why || Wh[i] || ""; if (!f.r.every(Boolean)) f.r = R[i] || [2, 2, 2]; f.rw = f.rw || RW[i] || ""; }); if (d.first === null) d.first = 0; d.improve = d.improve || "인도적 체류 허가의 연장 기간을 3년으로 늘리고, 이를 국민신문고 정책 제안으로 내는 절차를 정한다."; }
  },
  5: () => {
    const d = W.s5; if (!firstAltOf(W)) { const d4 = W.s4; if (!d4.alts.length) DEMO[4](); if (d4.first === null) d4.first = 0; d4.improve = d4.improve || "인도적 체류 허가의 연장 기간을 3년으로 늘리고, 이를 국민신문고 정책 제안으로 내는 절차를 정한다."; }
    if (!d.sealed) { if (!d.preds.length) { const a = !!helpVis("who"); d.preds = [{ who: "인도적 체류 허가자", txt: "1년마다 서류를 낼 걱정이 줄어 일자리를 오래 유지하려 한다.", reason: "편지와 대화에서 기다림이 가장 힘들다고 했다.", aft: a }, { who: "제주 지역 주민", txt: "정착이 늘까 봐 반대하는 사람과 일손이 생겨 반기는 사람으로 나뉜다.", reason: "기사 2에서 여론이 갈렸다." }, { who: "아직 심사를 기다리는 신청자", txt: "자신은 대상이 아니어서 소외감을 느낀다. 제도 밖에 남겨질까 걱정한다.", why: "제도를 바꾸는 논의에 참여할 통로가 없다", ex: true }]; } return; }
    if (d.scen) { d.sum = { A: d.sum.A || "허가 기간이 3년으로 늘자 유수프는 일하던 곳에서 계속 일할 수 있게 되었다. 같은 날 심사 중인 하산은 대상이 아니었다.", B: d.sum.B || "동네 게시판에서 찬반 논쟁이 커졌고, 의원 사무실에 반대 민원과 찬성 서명이 함께 들어왔다.", C: d.sum.C || "유수프는 일을 배우며 자리를 잡았지만, 아민은 아이의 보건 서비스를 받기 어려웠고 하산은 불인정 결정을 받았다." }; d.diff = { A: d.diff.A || "고용주 반응은 예측과 같았다. 심사 중인 사람이 빠진다는 점은 예측하지 못했다.", B: d.diff.B || "반대 여론은 예측했지만 댓글 삭제가 새 갈등을 만들 줄은 몰랐다.", C: d.diff.C || "체류 기간만 늘리면 생활이 안정될 것으로 예측했지만 다른 문제가 남았다." }; d.pick = d.pick || "C"; d.why = d.why || "체류 기간이 늘어도 인도적 체류라는 신분은 그대로이므로, 사회복지 지원에서 빠지는 일이 생길 수 있다고 본다(기사 3)."; d.newp = d.newp || "체류 기간을 늘려도 심사 중인 신청자는 대상에서 빠지고, 인도적 체류 허가자와 가족은 의료 같은 생활 지원을 받기 어려운 문제가 남는다."; }
  },
  6: () => {
    const d = W.s6; d.level = d.level || "제도·국가 간"; if (!d.types.length) d.types = ["제도 제안·요청", "자기 실천"]; d.typeWhy = d.typeWhy || "지원 안내는 제도의 문제이고, 잘못된 정보를 퍼뜨리지 않는 것은 우리가 할 수 있다."; d.scope = d.scope || "실행 준비"; d.when = d.when || "제출 2주 뒤 학급 회의 시간";
    d.prop = { ask: d.prop.ask || "인도적 체류 허가자와 그 가족이 받을 수 있는 의료·교육 지원을 한곳에 정리하고 여러 언어로 안내해 주세요.", reply: d.prop.reply || "지원을 새로 늘리자는 것이 아니라, 이미 있는 지원을 정확히 알리자는 제안입니다.", effect: d.prop.effect || "체류자가 받을 수 있는 지원을 몰라 놓치는 일이 줄고, 확인되지 않은 소문도 줄어듭니다." };
    if (!d.plans[0].target) d.plans = [{ target: "국민신문고(법무부)", content: "인도적 체류 허가자와 가족의 생활 지원 안내를 한곳에 정리해 달라는 정책 제안", how: "기사 3을 근거로 제안서 초안 작성, 6차시에 학급 의견을 받아 다듬기", channel: "국민신문고 정책 제안(교사 확인 후)" }, { target: "우리 반", content: "난민 관련 정보를 말할 때 출처를 함께 밝히기", how: "토의 규칙에 추가하고 한 달 동안 지켜보기", channel: "학급 회의" }]; if (!d.back.length) d.back = ["원인(2·3단계)"];
  },
  7: () => { const d = W.s7; d.problem = d.problem || "전쟁을 피해 온 예멘 난민 신청자가 제주에서도 안정적으로 지내기 어렵다"; const P = peerList(); if (!d.peers.length) d.peers = P.slice(0, 2).map(p => p.g); d.peers.forEach((g, i) => { d.peer[g] = d.peer[g] || [[3, 4, 3, 2], [3, 2, 4, 3]][i]; d.note[g] = d.note[g] || ["시나리오 C까지 보고 예상하지 못한 문제를 찾은 점을 배우고 싶다.", "카드뉴스에 출처를 모두 밝힌 점이 좋았다. 우리도 제안서에 근거 기사를 밝히겠다."][i]; }); d.chk = d.chk.map((v, i) => v || (i === 4 ? "보통" : "그렇다")); d.r1 = d.r1 || "처음에는 난민 신청자 개인의 사정 때문이라고 생각했는데, 인정 절차와 체류 제도, 여론이 함께 영향을 준다는 것을 알게 되었다."; d.r2 = d.r2 || "대안 1에서 '절차가 드러나 있지 않다'는 지적은 받아들였지만, 반대 여론 때문에 어렵다는 지적은 기각했다. 여론이 바뀌는 것도 우리가 할 수 있는 일이라고 보았다."; }
};

/* ================= 이벤트 ================= */
const val = id => { const el = document.getElementById(id); return el ? el.value.trim() : ""; };
function setPath(p, v) { const ks = p.split("."); let o = W; for (let i = 0; i < ks.length - 1; i++) { if (o[ks[i]] === undefined || o[ks[i]] === null) o[ks[i]] = {}; o = o[ks[i]]; } o[ks[ks.length - 1]] = v; }
function getPath(p) { return p.split(".").reduce((o, k) => o == null ? o : o[k], W); }

document.addEventListener("click", e => {
  const t = e.target.closest("[data-top]"); if (!t) return;
  if (t.dataset.top === "out") { if (confirm("로그아웃할까요? 같은 이름과 비밀번호로 다시 들어올 수 있습니다.")) leave(); }
  if (t.dataset.top === "help") $("#helpdlg").showModal();
});
let pdown = false, pendR = false;
document.addEventListener("pointerdown", () => { pdown = true; }, true);
document.addEventListener("pointerup", () => { setTimeout(() => { pdown = false; if (pendR) { pendR = false; render(); } }, 0); }, true);
function softRender() { if (pdown) pendR = true; else render(); }

app.addEventListener("submit", async e => {
  if (e.target.id !== "joinf") return; e.preventDefault();
  const c = val("j-code").toUpperCase(), g = +$("#j-g").value, nick = val("j-nick"), pw = val("j-pw");
  if (!/^\d{4}$/.test(pw)) { toast("비밀번호는 숫자 4자리예요.", true); return; }
  try { await join(c, g, nick, pw); } catch (err) { toast(err.message, true); }
});
app.addEventListener("click", e => {
  const b = e.target.closest("button,input[type=radio][data-act]"); if (!b || b.disabled || !W) return;
  if (b.dataset.stage) { stage = +b.dataset.stage; beat(); render(false); window.scrollTo(0, 0); return; }
  const a = b.dataset.act; if (!a) return;
  const i = +b.dataset.i, n = +b.dataset.n, v = b.dataset.v;
  const d1 = W.s1, d2 = W.s2, d3 = W.s3, d4 = W.s4, d5 = W.s5, d6 = W.s6;
  switch (a) {
    case "demo": DEMO[n] && DEMO[n](); break;
    case "del": getPath(b.dataset.k).splice(i, 1); break;
    case "s1add": { const t = val("s1-new"); const ty = +$("#s1-type").value; if (!t || d1.qs.length >= 5) return; d1.qs.push({ t, type: ty, aft: !!helpVis("q1") }); break; }
    case "s1seal": d1.sealed = true; d1.sealT = now(); flush(); mutate((x, g) => { if (x.session.req[G]) delete x.session.req[G][1]; pushLog(g, 1, "seal", `질문 목록 봉인 (${d1.qs.length}개)`); }); break;
    case "tOpen": flush(); mutate(x => openAI(x, G, n)); return;
    case "unseal": { ({ 1: d1, 3: d3, 4: d4, 5: d5 })[n].sealed = false; flush(); mutate((x, g) => { if (x.session.req[G]) delete x.session.req[G][n]; pushLog(g, n, "seal", `${n}단계 봉인 해제(보완 요청)`); }); break; }
    case "s1send": case "s1send2": { const two = a === "s1send2"; const sel = $(two ? "#s1-pick2" : "#s1-pick"); if (!sel || sel.value === "") return; const q = (two ? d1.qs2 : d1.qs)[+sel.value]; q.sent = true; d1.chat.push({ r: "me", x: q.t }); flush(); log(1, "ai", `질문 보냄: ${q.t}`); personaReply(q.t); return; }
    case "s1pause": d1.phase = 2; d1.chat.push({ r: "sys", x: "대화를 멈췄습니다. 1분 동안 더 필요한 질문을 합의합니다." }); d1.deadline = Date.now() + 60000; flush(); log(1, "seal", "1차 대화 멈춤"); break;
    case "s1add2": { const t = val("s1-new2"); if (!t || d1.qs2.length >= 2) return; d1.qs2.push({ t }); break; }
    case "s1seal2": d1.sealed2 = true; d1.sealT2 = now(); if (d1.qs2.length) { d1.phase = 3; d1.chat.push({ r: "sys", x: "2차 대화를 시작합니다. 2분입니다." }); d1.deadline = Date.now() + 120000; } else { d1.phase = 4; d1.endT = now(); d1.deadline = null; } flush(); log(1, "seal", `추가 질문 봉인 (${d1.qs2.length}개)`); if (!d1.qs2.length) log(1, "ai", "대화 로그 제출"); break;
    case "s1end": d1.phase = 4; d1.endT = now(); d1.deadline = null; d1.chat.push({ r: "sys", x: "대화를 마쳤습니다. 1·2차 대화 로그가 제출되었습니다." }); flush(); log(1, "ai", "1·2차 대화 로그 제출"); break;
    case "report": { const m = d1.chat[i]; m.flag = true; d1.halted = true; d1.chat.push({ r: "sys", x: "신고한 응답을 표시하고 대화를 멈췄습니다. 선생님께 알림이 갔습니다." }); flush(); mutate((x, g) => { pushAlert(g, 1, "report", "이상 응답 신고: " + m.x.replace(D.persona.pre, "").slice(0, 60), "rep-" + i); pushLog(g, 1, "report", "이상 응답 신고"); }); break; }
    case "ox": d2.qa[i] = v; break;
    case "cls": { const c = d2.cls[i] || {}; d2.cls[i] = { v, art: v === "확인된 이야기" ? (c.art || "") : "" }; break; }
    case "s2g": { const t = val("s2-g"); if (!t) return; d2.guesses.push({ t }); if (BIAS.test(t)) alertAdd(2, "bias", `원인 추측에 일반화 표현: "${t}" — 되묻기 필요`, "bias-g-" + t); break; }
    case "s2v": { const vc = $("#s2-vc"), t = val("s2-v"); if (!t || d2.vq.length >= d2.guesses.length || !vc.value || d2.vq.some(x => x.cause === vc.value)) { if (vc && !vc.value) vc.focus(); return; } d2.vq.push({ q: t, cause: vc.value, who: "", aft: !!helpVis("q2") }); break; }
    case "s3seal": d3.sealed = true; d3.sealT = now(); syncRows(); flush(); mutate((x, g) => { if (x.session.req[G]) delete x.session.req[G][3]; pushLog(g, 3, "seal", "원인 확인 질문 봉인(2-5)"); }); break;
    case "s3ask": searchAsk(i, false); return;
    case "s3fu": searchAsk(i, true); return;
    case "s3j": d3.rows[i].j = v; break;
    case "s3link": { const x = $("#s3-la").value, y = $("#s3-lb").value; if (!x || !y || x === y) return; d3.links.push([x, y]); break; }
    case "s3done": d3.done = true; d3.doneT = now(); flush(); log(3, "seal", "핵심 원인 공유 · 로그 제출"); break;
    case "s4pin": d4.pinned = true; d4.pinT = now(); flush(); log(4, "seal", "핵심 원인 고정"); break;
    case "s4add": { const t = val("s4-txt"); if (!t) return; d4.alts.push({ txt: t, actor: $("#s4-actor").value, aft: helpAfter("case") }); break; }
    case "s4seal": d4.sealed = true; d4.sealT = now(); flush(); mutate((x, g) => { if (x.session.req[G]) delete x.session.req[G][4]; pushLog(g, 4, "seal", `대안 봉인 (${d4.alts.length}개)`); }); break;
    case "s4fb": feedback(); return;
    case "s4j": d4.fb[i].j = v; break;
    case "score": d4.fb[i].r[+b.dataset.k] = +v; break;
    case "first": d4.first = i; break;
    case "s5add": { const w = val("s5-who"), t = val("s5-txt"); if (!w || !t) return; d5.preds.push({ who: w, txt: t, reason: val("s5-rsn"), aft: !!helpVis("who") }); break; }
    case "s5exadd": { const w = val("s5-exwho"), t = val("s5-extxt"); if (!w || !t) return; d5.preds.push({ who: w, why: val("s5-exwhy"), txt: t, ex: true, aft: !!helpVis("who") }); break; }
    case "whoex": { const el = $("#s5-who"); if (el) { el.value = v; el.focus(); } return; }
    case "s5seal": d5.sealed = true; d5.sealT = now(); flush(); mutate((x, g) => { if (x.session.req[G]) delete x.session.req[G][5]; pushLog(g, 5, "seal", "반응 예측 봉인"); }); break;
    case "s5gen": scenarios(); return;
    case "pick": d5.pick = v; break;
    case "s5why": if (d5.why.trim().length < 20) return; d5.whySaved = true; d5.whyT = now(); flush(); log(5, "seal", `시나리오 ${d5.pick} 선택 저장`); break;
    case "s5edit": d5.whySaved = false; break;
    case "set": setPath(b.dataset.k, v); break;
    case "tog": { const arr = getPath(b.dataset.k); const k = arr.indexOf(v); if (k >= 0) arr.splice(k, 1); else arr.push(v); break; }
    case "s6addplan": d6.plans.push({ target: "", content: "", how: "", channel: "" }); break;
    case "s6res": d6.resOpen = true; break;
    case "t6ok": flush(); mutate(x => teacherCheck6(x, G, "")); return;
    case "help": flush(); mutate(x => revealHelp(x, D, b.dataset.k, b.dataset.m, G)); return;
    case "copy": { const txt = `[${G}모둠] ${D.meta.title}\n` + chainOf(W).map(([k, x]) => `${k}: ${x || "-"}`).join("\n"); W.s7.posted = true; flush(); const note = m => { const n0 = $("#copy-note"); if (n0) n0.textContent = m; }; try { navigator.clipboard.writeText(txt).then(() => note("복사했습니다. 공유 게시판에 붙여 넣으세요."), () => note("복사가 막혔습니다. 위 흐름을 직접 선택해 복사하세요.")); } catch (err) { note("복사가 막혔습니다. 위 흐름을 직접 선택해 복사하세요."); } return; }
    case "peerpick": { const p = W.s7.peers; const k = p.indexOf(v); if (k >= 0) p.splice(k, 1); else if (p.length < 2) p.push(v); break; }
    case "peer": { const g = b.dataset.g; W.s7.peer[g] = W.s7.peer[g] || [0, 0, 0, 0]; W.s7.peer[g][+b.dataset.k] = +v; break; }
    case "refl": W.s7.chk[i] = v; break;
    case "bcread": { let seen = []; try { seen = JSON.parse(localStorage.getItem("aieps.v2.seen." + code) || "[]"); } catch { } seen.push(v); localStorage.setItem("aieps.v2.seen." + code, JSON.stringify(seen.slice(-50))); break; }
  }
  flush(); render();
});
app.addEventListener("input", e => {
  const el = e.target, p = el.dataset.bind; if (!p || !W || el.type === "checkbox" || el.type === "radio") return;
  setPath(p, el.value); queueFlush();
  if (el.dataset.red) {
    let key = el.dataset.red, v = el.value;
    if (key === "s3-coreC" || key === "s3-coreE") { key = "s3-core"; v = W.s3.coreC + " " + W.s3.coreE; }
    const box = document.getElementById("rb-" + key); if (box) box.outerHTML = redHtml(key, v);
    checkRed(key, v, +el.dataset.st);
  }
  if (p === "s5.why") { const c = $("#s5-whycnt"), btn = $("#s5-whybtn"); if (c) c.textContent = W.s5.why.trim().length + "자 · 20자 미만이면 저장되지 않습니다."; if (btn) btn.disabled = !(W.s5.pick && W.s5.why.trim().length >= 20); }
  if (el.dataset.chk6 || p.startsWith("s6.prop")) { const box = $("#s6-auto"); if (box) box.innerHTML = autoChk6(); }
});
app.addEventListener("change", e => {
  const el = e.target; if (!W) return;
  if (el.id === "s1-type") { sessionStorage.setItem("aieps.v2.qtype", el.value); return; }
  if (el.dataset.actChange === "role") { const r = el.value; mutate((x, g) => { if (g.members[me]) g.members[me].role = r; }); return; }
  const p = el.dataset.bind; if (!p) return;
  setPath(p, el.type === "checkbox" ? el.checked : el.value); flush();
  if (el.dataset.chk6 || p.startsWith("s6.prop")) { const t = autoChk6(); if (/개인정보/.test(t)) alertAdd(6, "pi", "행동계획에 개인정보로 보이는 내용", "pi6"); if (/일반화/.test(t)) alertAdd(6, "bias", "행동계획에 일반화로 보이는 표현", "bias6"); }
  if (el.tagName === "SELECT" || el.type === "checkbox") render();
  else if (["s4.coreEdit", "s4.improve", "s5.newp", "s7.r1"].includes(p) || /^s3\.rows\.\d+\.(sum|res)|^s4\.fb\.\d+\.(sum|why|rw)|^s3\.core/.test(p)) softRender();
});
app.addEventListener("paste", e => {
  const el = e.target; if (!el.dataset || !el.dataset.red) return;
  let id = el.dataset.red; if (id === "s3-coreC" || id === "s3-coreE") id = "s3-core"; const st = +el.dataset.st;
  setTimeout(() => mutate((x, g) => { pushAlert(g, st, "paste", `${fieldName(id)}에 붙여넣기`, "paste-" + id + "-" + g.alerts.length); pushLog(g, st, "red", "붙여넣기 감지: " + fieldName(id)); }), 0);
});
app.addEventListener("keydown", e => {
  if (e.key !== "Enter" || e.target.tagName !== "INPUT" || e.isComposing) return;
  const m = { "s1-new": "s1add", "s1-new2": "s1add2", "s2-g": "s2g", "s2-v": "s2v", "s4-txt": "s4add", "s5-txt": "s5add", "s5-rsn": "s5add", "s5-extxt": "s5exadd" }[e.target.id];
  if (m) { e.preventDefault(); const btn = document.querySelector(`[data-act="${m}"]`); if (btn) btn.click(); }
});
window.addEventListener("online", renderTop); window.addEventListener("offline", renderTop);

/* ================= 시작 ================= */
(async () => {
  try { D = await loadLesson(); } catch (e) { app.innerHTML = `<div class="panel">${esc(e.message)}</div>`; return; }
  BIAS = new RegExp(D.detect.bias); PI = new RegExp(D.detect.pi);
  let last = null; try { last = JSON.parse(sessionStorage.getItem(LOGIN) || "null"); } catch { }
  if (last && store.get(last.code)?.groups[last.g]?.members[last.uid]) enter(last.code, last.g, last.uid);
  else render(false);
})();
