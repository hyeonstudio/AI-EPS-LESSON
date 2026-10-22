// 교사용. 수업 만들기 → 코드·QR로 학생 입장 → 단계 개방, 선제 사고 확인·AI 열기, 도움 자료 공개, 알림 처리, 평가 지표.
// 교사 화면의 판단 기준과 문구는 견본 high/index.html의 교사 화면을 따른다.
import {
  $, esc, now, hm, toast, netChip, loadLesson, store, newSession, emptyGroup, helpVisFor, stageDone, redFields,
  aiTexts, overlapWith, openAI, requestFix, revealHelp, resolveAlert, teacherCheck6, pushLog, chainOf, prompts
} from "./core.js";

const app = $("#app"), top = $("#top");
const TKEY = "aieps.v2.teacher";
let D, P, teacher = localStorage.getItem(TKEY) || "";
let view = "list", ltab = "mine", code = null, tab = "prog", selG = 1, big = false;
const subscribed = new Set();

/* ================= 렌더 ================= */
let wantRender = false;
function requestRender() {
  const a = document.activeElement;
  if (a && app.contains(a) && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.type !== "checkbox" && a.type !== "radio") { wantRender = true; return; }
  render();
}
app.addEventListener("focusout", () => setTimeout(() => { if (wantRender && !app.contains(document.activeElement)) { wantRender = false; render(); } }, 0));

function render(keepScroll) {
  const y = window.scrollY;
  top.innerHTML = `<div class="topbar"><div class="topin"><a class="logo" href="./"><span class="mark">EPS</span><span><b>AI-EPS<small>교사용</small></b><span>확장된 경험 기반 문제해결학습 모형</span></span></a>${teacher ? `${netChip()}<span class="meta">${esc(teacher)}</span><button class="tbtn" data-act="logout">로그아웃</button>` : ""}</div></div>`;
  try {
    if (!teacher) app.innerHTML = loginView();
    else if (view === "session" && store.get(code)) app.innerHTML = sessionView();
    else { view = "list"; app.innerHTML = listView(); }
  } catch (err) { console.error(err); app.innerHTML = `<div class="panel"><b>화면을 그리는 중 문제가 생겼습니다.</b><p class="small">${esc(err.message)}</p></div>`; }
  document.querySelectorAll(".overlay").forEach(o => o.remove());
  if (big && view === "session") document.body.insertAdjacentHTML("beforeend", bigView());
  drawQR();
  if (keepScroll !== false) window.scrollTo(0, y);
}
const joinURL = c => new URL(`student.html?code=${c}`, location.href).href;
function drawQR() {
  document.querySelectorAll(".qr[data-url]").forEach(el => {
    if (el.dataset.done) return; el.dataset.done = "1";
    if (window.QRCode) { try { new window.QRCode(el, { text: el.dataset.url, width: 240, height: 240, correctLevel: window.QRCode.CorrectLevel.M }); } catch { el.textContent = "QR"; } }
    else el.innerHTML = `<span class="small" style="color:#333">QR을 불러오지 못했습니다</span>`;
  });
}

/* ---------- 로그인 ---------- */
function loginView() {
  return `<div class="panel join"><h2>교사 로그인</h2><p class="small" style="margin:0 0 16px">허용된 교사 계정으로 로그인합니다.</p>
   <button class="btn primary" disabled style="width:100%;padding:12px">구글로 로그인 <span class="small" style="color:inherit;opacity:.8">· Firebase 연결 후 사용</span></button>
   <p class="small" style="margin:16px 0 8px;text-align:center">또는 시연용으로 이름만 넣고 들어가기</p>
   <form id="loginf"><div class="field"><label for="t-name">이름 또는 이메일</label><input id="t-name" required maxlength="40"></div><button class="btn" type="submit" style="width:100%;padding:12px">시연용으로 들어가기</button></form>
   <p class="small" style="margin-top:14px">시연판은 이 브라우저 안에서만 저장됩니다. 학생 화면도 같은 브라우저의 다른 탭에서 열어야 실시간으로 이어집니다.</p></div>`;
}

/* ---------- 수업 목록 / 인물·자료 점검 ---------- */
function listView() {
  const tabs = `<div class="tabs" role="tablist">${[["mine", "내 수업"], ["check", "인물·자료 점검"]].map(([k, l]) => `<button role="tab" data-ltab="${k}" aria-selected="${ltab === k}">${l}</button>`).join("")}</div>`;
  if (ltab === "check") return tabs + checkView();
  const docs = store.list().map(c => store.get(c)).filter(Boolean);
  const card = d => { const s = d.session, n = Object.values(d.groups).reduce((a, g) => a + Object.keys(g.members).length, 0); return `<div class="vcard"><h4>${esc(s.title)} <span class="status ${s.status}">${s.status === "open" ? "진행 중" : "닫힘"}</span>${s.rehearsal ? `<span class="vbadge wait">리허설 모드</span>` : ""}</h4><div class="small">코드 <b class="num">${esc(s.code)}</b> · ${s.groups}모둠 · 학생 ${n}명 · ${new Date(s.createdAt).toLocaleString("ko-KR")}</div><div class="row"><button class="btn primary sm" data-act="openS" data-v="${esc(s.code)}">열기</button><button class="btn sm danger" data-act="delS" data-v="${esc(s.code)}">삭제</button></div></div>`; };
  return tabs + `<section class="panel"><h2 style="margin:0 0 4px;font-size:20px">새 수업 만들기</h2><p class="small" style="margin:0 0 12px">${esc(D.meta.level)} · ${esc(D.meta.subject)} · ${esc(D.meta.unit)} · ${esc(D.meta.sessions)} · ${esc(D.meta.plan)}</p>
   <form id="newf" class="addrow"><input id="n-title" value="${esc(D.meta.title)}" aria-label="수업 제목"><select id="n-g" class="narrow" aria-label="모둠 수">${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${i + 1 === 7 ? "selected" : ""}>${i + 1}모둠</option>`).join("")}</select><button class="btn primary" type="submit">수업 만들기</button></form></section>
   <section class="panel" style="margin-top:16px"><p class="sec-title">내 수업</p>${docs.length ? `<div class="grid2">${docs.map(card).join("")}</div>` : `<p class="empty">아직 만든 수업이 없습니다.</p>`}</section>`;
}
const RCK = () => `aieps.v2.recheck.${D.id}`;
const rechecks = () => { try { return JSON.parse(localStorage.getItem(RCK()) || "{}"); } catch { return {}; } };
function checkView() {
  const rc = rechecks(), Pn = D.persona;
  const badge = (it, id) => `<span class="vbadge ${it.checked ? "" : "wait"}">${it.checked ? `원문 대조 완료 ${esc(it.checked)}` : "확인 대기 · 학생에게 보이지 않음"}</span><label class="small" style="margin-left:auto;display:flex;gap:5px;align-items:center"><input type="checkbox" data-act="recheck" data-v="${id}" ${rc[id] ? "checked" : ""}> 수업 전 다시 확인함</label>`;
  return `<section class="panel"><h2 style="margin:0 0 6px;font-size:20px">인물·자료 점검</h2><p class="small" style="margin:0 0 12px">수업 전에 원문 링크를 열어 수치와 날짜를 다시 확인합니다. 원문 대조를 마치지 않은 자료는 학생에게 보이지 않습니다(리허설 모드에서는 보입니다).</p>
   <div class="memo"><b>교사 메모</b><ul style="margin:6px 0 0;padding-left:18px">${D.teacherMemo.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div></section>
   <section class="panel" style="margin-top:16px"><p class="sec-title">1단계 AI 페르소나 · 학생에게는 편지와 대화만 보입니다</p>
    <div class="vcard"><h4>${esc(Pn.name)} <span class="small">${esc(Pn.setting)}</span><span class="vbadge">가상 인물</span></h4>
     <p class="small" style="margin:0"><b>2단계에서 '확인된 이야기'로 대조할 편지 속 사실</b></p><ul class="small" style="margin:0;padding-left:18px">${Pn.letterFacts.map(x => `<li>${esc(x)}</li>`).join("")}</ul>
     <p class="small" style="margin:6px 0 0"><b>학생에게 보이는 편지</b></p><div class="letter">${Pn.letter.map(p => `<p>${esc(p)}</p>`).join("")}</div>
     <details class="pd"><summary>응답 지시문(서버에서 쓸 것)</summary><pre class="prompt">${esc(P.persona())}</pre></details>
     <details class="pd"><summary>시연용 미리 넣은 응답 ${Pn.canned.length}개</summary><ul class="small" style="padding-left:18px">${Pn.canned.map(c => `<li><code>${esc(c.re)}</code> → ${esc(c.a)}</li>`).join("")}<li>그 밖의 질문 → ${esc(Pn.def)}</li></ul></details></div></section>
   <section class="panel" style="margin-top:16px"><p class="sec-title">2단계 실제 사건 기사 · 3단계 검증 자료 목록</p><div class="flags">${D.articles.map((a, i) => `<div class="vcard"><h4>${esc(a.tag)} ${badge(a, "art" + i)}</h4><b>${esc(a.title)}</b>${a.body.map(x => `<p class="small" style="margin:0">${esc(x)}</p>`).join("")}${a.note ? `<p class="small" style="margin:0">${esc(a.note)}</p>` : ""}<ul class="small" style="margin:0;padding-left:18px">${a.src.map(s => `<li>${s.u ? `<a href="${esc(s.u)}" target="_blank" rel="noopener">${esc(s.t)}</a>` : esc(s.t)}</li>`).join("")}</ul></div>`).join("")}</div></section>
   <section class="panel" style="margin-top:16px"><p class="sec-title">4단계 유사 사례 (1번 전체 공개, 2~5번 요청한 모둠에 차례로)</p><div class="flags">${D.cases.map((c, i) => `<div class="vcard"><h4>사례 ${i + 1} · ${esc(c.title)} ${badge(c, "case" + i)}</h4><p class="small" style="margin:0">${esc(c.actor)} · 겨냥한 어려움: ${esc(c.aim)}</p><p class="small" style="margin:0">${esc(c.body)}</p><p class="small" style="margin:0">출처: ${esc(c.src)}</p></div>`).join("")}</div></section>
   <section class="panel" style="margin-top:16px"><p class="sec-title">AI 기능별 지시문</p>
    <details class="pd"><summary>자료 탐색 도우미 (3단계)</summary><pre class="prompt">${esc(P.search("(모둠의 원인 확인 질문)"))}</pre></details>
    <details class="pd"><summary>대안 검토 도우미 (4단계)</summary><pre class="prompt">${esc(P.feedback("(고정한 핵심 원인)", [{ txt: "(대안)", actor: "(실행 주체)" }]))}</pre></details>
    <details class="pd"><summary>시나리오 생성기 (5단계)</summary><pre class="prompt">${esc(P.scenario("(1순위 대안과 보완 내용)", [{ who: "(이해관계자)", txt: "(예측한 반응)", reason: "(그렇게 예측한 이유)" }]))}</pre></details></section>`;
}

/* ---------- 수업 상세 ---------- */
function sessionView() {
  const doc = store.get(code), s = doc.session;
  if (!doc.groups[selG]) selG = +Object.keys(doc.groups)[0];
  const hero = `<section class="panel"><div class="hero"><div><button class="btn sm" data-act="back">← 수업 목록</button>
    <p class="small" style="margin:14px 0 0">${esc(D.meta.subject)} · ${esc(D.meta.unit)}</p><h1>${esc(s.title)}</h1>
    <div class="codewrap"><span class="codebig">${esc(s.code)}</span><div class="qr" data-url="${esc(joinURL(s.code))}" aria-label="학생 입장 QR"></div></div></div>
    <div style="display:flex;flex-direction:column;gap:12px;align-items:flex-end"><div class="actions">${s.status === "open" ? `<button class="btn danger" data-act="close">수업 닫기</button>` : `<button class="btn" data-act="reopen">다시 열기</button>`}<button class="btn soft" data-act="big">크게 띄우기</button><button class="btn soft" data-act="copycode">코드 복사</button><button class="btn" data-act="csv">기록 CSV</button></div>
    <div class="small"><span class="status ${s.status}">${s.status === "open" ? "진행 중" : "닫힘"}</span> ${s.status === "open" ? "끝나면 '수업 닫기'" : ""}</div>
    ${s.rehearsal ? `<div class="warnline" style="margin:0">리허설 모드: 확인 전 자료와 리허설 버튼이 학생에게 보입니다. 실제 수업 전에 수업 설정에서 꺼 주세요.</div>` : ""}</div></div></section>`;
  const tabs = `<div class="tabs" role="tablist" style="margin-top:16px">${[["prog", "진행 현황"], ["help", "도움 자료"], ["set", "수업 설정"]].map(([k, l]) => `<button role="tab" data-tab="${k}" aria-selected="${tab === k}">${l}</button>`).join("")}</div>`;
  const body = tab === "help" ? helpTab(doc) : tab === "set" ? setTab(doc) : progTab(doc);
  return hero + tabs + body;
}
const gsel = doc => `<label class="small" style="display:inline-flex;gap:6px;align-items:center">살펴볼 모둠 <select data-act-change="selG" style="width:auto">${Object.keys(doc.groups).map(g => `<option value="${g}" ${+g === selG ? "selected" : ""}>${g}모둠</option>`).join("")}</select></label>`;
const online = m => Date.now() - (m.last || 0) < 60000;
const PRESETS = ["5분 남았어요", "잠깐 앞을 봐 주세요", "모둠에서 먼저 이야기해 보세요", "다음 단계를 열었어요"];

function progTab(doc) {
  const s = doc.session, G = Object.entries(doc.groups);
  const members = G.flatMap(([, g]) => Object.values(g.members));
  const allLogs = G.flatMap(([, g]) => g.logs), allAlerts = G.flatMap(([, g]) => g.alerts);
  const aiCalls = allLogs.filter(l => l.kind === "ai" && /응답|피드백|시나리오|근거 다시/.test(l.text)).length;
  const stat = (ic, n, l, al) => `<div class="stat ${al && n ? "alert" : ""}"><span class="ic" aria-hidden="true">${ic}</span><div><b>${n}${l[1]}</b><span>${l[0]}</span></div></div>`;
  const bc = `<section class="panel"><p class="sec-title">학생에게 한마디</p><div class="presets">${PRESETS.map(p => `<button class="chipbtn" data-act="preset" data-v="${esc(p)}">${esc(p)}</button>`).join("")}</div>
   <div class="sendrow"><input type="text" id="bc-text" placeholder="예) 5분 남았어요" aria-label="학생에게 보낼 말"><select id="bc-to" aria-label="받는 모둠"><option value="all">모든 모둠</option>${G.map(([g]) => `<option value="${g}">${g}모둠</option>`).join("")}</select><button class="btn primary" data-act="send">보내기</button></div>
   ${s.broadcasts.length ? `<p class="small" style="margin:8px 0 0">최근: ${s.broadcasts.slice(-3).reverse().map(b => `${hm(b.t)} ${b.to === "all" ? "전체" : b.to + "모둠"} · ${esc(b.text)}`).join(" / ")}</p>` : ""}</section>`;
  const stats = `<section class="panel" style="margin-top:16px"><div class="stats">${stat("●", members.filter(online).length, ["접속 중", "명"])}${stat("◎", members.length, ["참여 학생", "명"])}${stat("AI", aiCalls, ["AI 호출", "회"])}${stat("!", allAlerts.filter(a => a.kind === "red").length, ["Red 의심", "건"], true)}${stat("⚑", allAlerts.filter(a => a.kind === "report").length, ["이상 응답 신고", "건"], true)}${stat("Ⅱ", G.filter(([, g]) => g.work.s1.halted).length, ["대화 멈춤", "모둠"], true)}</div></section>`;
  const gates = `<section class="panel" style="margin-top:16px"><div class="row" style="margin-top:0;justify-content:space-between"><div><b>단계 개방</b><p class="small" style="margin:2px 0 0">여기까지 열린 단계만 학생이 들어갈 수 있습니다. 1/2차시 1~3단계, 2/2차시 4~7단계.</p></div>
   <div class="gates">${D.stages.map(st => `<button data-act="openTo" data-n="${st.n}" class="${st.n <= s.open ? "open" : ""}" aria-pressed="${st.n <= s.open}">${st.n} <span class="chip ${st.g}" style="padding:0 5px">${st.g === "Y" ? "Y" : "–"}</span></button>`).join("")}</div></div></section>`;
  const rows = G.map(([g, x]) => {
    const W = x.work, cur = Object.values(x.members).filter(online).map(m => m.stage);
    const cells = D.stages.map(st => stageDone(W, st.n) ? "d" : x.alerts.some(a => a.stage === st.n && !a.done && (a.kind === "red" || a.kind === "report")) ? "f" : cur.includes(st.n) ? "p" : "w");
    const nm = Object.values(x.members).map(m => m.nick);
    return `<tr class="${+g === selG ? "sel" : ""}"><td><button data-act="selG" data-v="${g}">${g}모둠</button> <span class="small">${nm.length ? esc(nm.slice(0, 2).join(", ")) + (nm.length > 2 ? ` 외 ${nm.length - 2}` : "") : "입장 전"}</span></td>${cells.map((c, i) => `<td><span class="cell ${c}">${i + 1}</span></td>`).join("")}<td class="num">${x.alerts.filter(a => a.kind === "red").length}</td></tr>`;
  }).join("");
  const prog = `<section class="panel"><p class="sec-title">모둠 진행 현황</p>
    <div class="tablewrap"><table class="prog" style="min-width:560px"><thead><tr><th>모둠</th>${D.stages.map(x => `<th>${x.n}</th>`).join("")}<th>Red</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="legend"><span><span class="cell d">✓</span> 완료</span><span><span class="cell p">·</span> 진행 중</span><span><span class="cell f">!</span> 확인 필요</span><span><span class="cell w">·</span> 대기</span><span>모둠 이름을 누르면 아래에서 자세히 봅니다.</span></div></section>`;
  const grp = doc.groups[selG], W = grp.work, ai = s.ai[selG] || {};
  const Q = D.qtypes;
  const items = [
    { n: 1, what: "질문 목록", sealed: W.s1.sealed, t: W.s1.sealT, body: W.s1.qs.map(q => `[${Q[q.type]}] ${q.t}${q.aft ? " (공개 후)" : ""}`), ck: [["질문 4~5개", W.s1.qs.length >= 4 && W.s1.qs.length <= 5], ["세 유형이 고루 들어감", Q.every((t, i) => W.s1.qs.some(q => q.type === i))], ["원인·해결책을 묻지 않음", !W.s1.qs.some(q => /해결|원인|정책|어떻게 하면/.test(q.t))]] },
    { n: 3, what: "원인 확인 질문(2-5)", sealed: W.s3.sealed, t: W.s3.sealT, body: W.s2.vq.map(v => v.q + (v.aft ? " (공개 후)" : "")), ck: [["원인마다 질문 1개", W.s2.vq.length === W.s2.guesses.length], ["합의한 원인 3개 이상", W.s2.guesses.length >= 3], ["원인이 겹치지 않음", new Set(W.s2.vq.map(v => v.cause)).size === W.s2.vq.length], ["질문마다 확인할 원인이 연결됨", W.s2.vq.every(v => v.cause)]] },
    { n: 4, what: "대안표", sealed: W.s4.sealed, t: W.s4.sealT, body: W.s4.alts.map(a => `[${a.actor}] ${a.txt}${a.aft ? " (공개 후)" : ""}`), ck: [["대안 3개 이상", W.s4.alts.length >= 3], ["실행 주체 2종 이상", new Set(W.s4.alts.map(a => a.actor)).size >= 2]] },
    { n: 5, what: "반응 예측", sealed: W.s5.sealed, t: W.s5.sealT, body: W.s5.preds.map(p => `${p.who}${p.ex ? "(목소리 내기 어려움)" : ""}: ${p.txt}${p.reason ? " / 이유: " + p.reason : ""}`), ck: [["이해관계자 2명 이상", W.s5.preds.filter(p => !p.ex).length >= 2], ["목소리를 내기 어려운 이해관계자 포함", W.s5.preds.some(p => p.ex)]] }
  ];
  const req = s.req[selG] || {};
  const review = `<section class="panel"><div class="row" style="margin:0 0 10px;justify-content:space-between"><p class="sec-title" style="margin:0">선제 사고 산출물 확인 · AI 열기</p>${gsel(doc)}</div><div class="flags">${items.map(it => `<div class="review"><h4>${it.n}단계 · ${esc(it.what)} ${it.sealed ? `<span class="seal">봉인 ${hm(it.t)}</span>` : `<span class="small">아직 봉인 전</span>`} ${ai[it.n] ? `<span class="chip G">AI 열림</span>` : req[it.n] ? `<span class="chip Y">보완 요청함</span>` : ""}</h4>
    ${it.sealed ? `<ul>${it.body.map(x => `<li>${esc(x)}</li>`).join("")}</ul><div class="ck">${it.ck.map(([l, v]) => `<span class="${v ? "y" : "n"}">${esc(l)}</span>`).join("")}</div>
    ${ai[it.n] ? "" : `<div class="row"><button class="btn sm primary" data-act="tOpen" data-n="${it.n}">AI 열기</button><input type="text" id="req-${it.n}" placeholder="보완 발문 (예: 이동 과정·제도를 묻는 질문을 더해 볼까?)" style="flex:1 1 220px;font-size:13px;padding:5px 8px" aria-label="보완 발문"><button class="btn sm" data-act="tReq" data-n="${it.n}">보완 요청</button></div>`}` : ""}</div>`).join("")}</div></section>`;
  const lg = grp.logs.length ? grp.logs.slice().reverse().map(l => `<div><span>${hm(l.t)}</span><span>${l.stage ? l.stage + "단" : "-"}</span><span class="k-${l.kind}">${esc(l.text)}</span></div>`).join("") : `<div><span>—</span><span></span><span>학생이 활동하면 기록이 쌓입니다.</span></div>`;
  const logs = `<section class="panel"><p class="sec-title">${selG}모둠 활동 기록</p><div class="log">${lg}</div><p class="small" style="margin:8px 0 0">로그는 전수 확인하지 않고 모둠별 1~2건의 표본과 붙여넣기 표시 건을 점검합니다.</p></section>`;
  const nm = { red: "Red 의심", paste: "붙여넣기", report: "이상 응답 신고", bias: "일반화 표현", pi: "개인정보" };
  const al = G.flatMap(([g, x]) => x.alerts.map(a => ({ ...a, g }))).sort((a, b) => (a.done - b.done) || b.t.localeCompare(a.t));
  const flags = `<section class="panel"><p class="sec-title">확인이 필요한 알림</p><div class="flags">${al.length ? al.map(a => `<div class="flag ${a.done ? "done" : a.kind === "paste" || a.kind === "bias" ? "y" : ""}"><b>${a.g}모둠 · ${a.stage}단계 · ${hm(a.t)} · ${esc(nm[a.kind] || a.kind)}</b>${esc(a.text)}
    ${a.done ? `<div class="small">${esc(a.res || "처리함")}</div>` : a.kind === "red" || a.kind === "paste" ? `<div class="row"><span class="small">"이 문장을 자기 말로 설명해 볼래?"</span><button class="btn sm" data-act="aDone" data-g="${a.g}" data-i="${a.id}" data-v="구두 설명 확인 · 인정">설명함 · 인정</button><button class="btn sm warn" data-act="aDone" data-g="${a.g}" data-i="${a.id}" data-v="구두 설명 못 함 · 다시 쓰기 요청">불인정</button></div>` : a.kind === "report" ? `<div class="row"><button class="btn sm" data-act="aDone" data-g="${a.g}" data-i="${a.id}" data-v="학급 공통 오류로 공유 · 대화 재개" data-resume="1">전자칠판 공유 · 대화 재개</button></div>` : `<div class="row"><button class="btn sm" data-act="aDone" data-g="${a.g}" data-i="${a.id}" data-v="확인함">확인함</button></div>`}</div>`).join("") : `<p class="empty" style="padding:12px">아직 알림이 없습니다.</p>`}</div>
    <p class="sec-title" style="margin-top:20px">수업 전 점검</p>
    <ul class="list">${D.preClass.map(([st, t]) => `<li><span class="tag ${st === "대기" ? "off" : ""}">${esc(st)}</span><span class="txt">${esc(t)}</span></li>`).join("")}</ul></section>`;
  const six = `<section class="panel" style="margin-top:18px"><p class="sec-title">6단계 행동계획 현황</p>
   <div class="tablewrap"><table style="min-width:760px"><thead><tr><th>모둠</th><th>문제 수준</th><th>행동 유형</th><th>실행 범위</th><th>제출 전 점검</th><th>확인</th></tr></thead><tbody>
    ${G.map(([g, x]) => { const d6 = x.work.s6, all = d6.chk.every(Boolean); return `<tr><td>${g}모둠</td><td>${esc(d6.level || "-")}</td><td>${esc(d6.types.join(", ") || "-")}</td><td>${esc(d6.scope || "-")}</td><td>${all ? "완료" : "-"}</td><td>${d6.tok ? `<span class="chip G">확인함</span>${d6.tnote ? ` <span class="small">${esc(d6.tnote)}</span>` : ""}` : all ? `<div class="addrow" style="min-width:260px"><input type="text" id="t6-note-${g}" placeholder="실천 가능성 코멘트(선택)" aria-label="코멘트"><button class="btn primary sm" data-act="t6ok" data-g="${g}">확인</button></div>` : '<span class="small">점검 전</span>'}</td></tr>`; }).join("")}
   </tbody></table></div>
   <p class="small" style="margin:8px 0 0">학생이 밖으로 내기 전에 낙인·일반화 표현과 개인정보를 확인합니다. 실행 범위는 모둠이 고르며 실제 실행은 필수가 아닙니다.</p></section>`;
  return bc + stats + gates + `<div class="tgrid" style="margin-top:18px"><div class="tcol">${prog}${review}${logs}</div><div class="tcol">${flags}</div></div>` + six + evalPanel(doc);
}
function evalPanel(doc) {
  const s = doc.session, grp = doc.groups[selG], W = grp.work;
  const firstAI = n => { const l = grp.logs.find(x => x.stage === n && x.kind === "ai"); return l ? l.t : ""; };
  const seals = [[1, W.s1.sealT], [3, W.s3.sealT], [4, W.s4.sealT], [5, W.s5.sealT]].filter(([n, t]) => t || firstAI(n));
  const ord = seals.length ? seals.every(([n, t]) => t && (!firstAI(n) || t <= firstAI(n))) : null;
  const avgQ = W.s1.qs.length ? W.s1.qs.reduce((x, q) => x + q.t.length, 0) / W.s1.qs.length : 0;
  const A = aiTexts(W), ov = redFields(W).map(f => overlapWith(f[2], A)).filter(v => v !== null), mx = ov.length ? Math.max(...ov) : null;
  const rep = grp.alerts.some(a => a.kind === "report"), bad = grp.alerts.some(a => a.kind === "pi" || a.kind === "bias");
  const rows = [
    ["① 선제 사고 산출물의 봉인 시각이 해당 AI 사용보다 앞선다.", ord === null ? ["u", "AI 사용 전"] : ord ? ["y", "모든 단계에서 봉인이 먼저"] : ["n", "봉인 전 AI 사용 기록 있음"]],
    ["② 질의가 사전에 만든 질문·대안·예측의 범위 안에서 이루어졌다.", seals.length ? ["y", "앱이 자유 입력을 막음"] : ["u", "AI 사용 전"]],
    ["③ 질문에 대상·시점·필요한 정보가 구체적으로 드러난다.", W.s1.qs.length ? [avgQ >= 18 ? "y" : "n", `1단계 질문 평균 ${Math.round(avgQ)}자 · 내용은 교사 판단`] : ["u", "질문 없음"]],
    ["④ AI 응답에 대해 출처나 근거를 다시 묻는 후속 질의가 있다.", W.s3.rows.some(r => r.ans) ? (W.s3.rows.some(r => r.fu) ? ["y", "근거 다시 묻기 있음"] : ["n", "후속 질의 없음"]) : ["u", "3단계 전"]],
    ["⑤ 페르소나 대화의 멈춤 후 추가 질문이 앞선 응답의 빈틈을 겨냥한다.", W.s1.sealed2 ? (W.s1.qs2.length ? ["y", `추가 질문 ${W.s1.qs2.length}개 · 내용은 교사 판단`] : ["n", "추가 질문 없음"]) : ["u", "멈춤 전"]],
    ["⑥ 웹앱 입력과 AI 응답의 일치율이 주의 기준(35%) 미만이다.", mx === null ? ["u", "입력 전"] : mx < D.detect.warn ? ["y", `최고 ${Math.round(mx * 100)}%`] : ["n", `최고 ${Math.round(mx * 100)}%`]],
    ["⑦ AI 응답의 오류나 편향을 지적하거나 이의를 제기한 기록이 있다.", rep ? ["y", "이상 응답 신고 있음"] : ["n", "기록 없음"]],
    ["⑧ 개인정보나 일반화·비하 표현을 입력하지 않았다.", bad ? ["n", "감지 기록 있음"] : ["y", "감지 없음"]]
  ];
  const sel = (s.evalSel || {})[selG] || [];
  return `<section class="panel" style="margin-top:18px"><div class="row" style="margin:0 0 8px;justify-content:space-between"><p class="sec-title" style="margin:0">생성형 AI 분석 평가 도구 · ${selG}모둠 자동 지표</p>${gsel(doc)}</div><p class="small" style="margin:0 0 8px">앱이 로그에서 계산한 참고 지표입니다. 성취수준(◎/○/△)은 교사가 표본 로그와 함께 판단합니다.</p>
   <div class="tablewrap"><table class="evalt" style="min-width:640px"><thead><tr><th style="width:56%">평가 항목</th><th>자동 지표</th><th>성취수준</th></tr></thead><tbody>${rows.map((r, i) => `<tr><td>${esc(r[0])}</td><td><span class="ind ${r[1][0]}">${r[1][0] === "y" ? "충족" : r[1][0] === "n" ? "확인 필요" : "자료 없음"}</span> <span class="small">${esc(r[1][1])}</span></td><td><select aria-label="항목 ${i + 1} 성취수준" data-act-change="eval" data-i="${i}"><option value="">-</option>${["◎", "○", "△"].map(v => `<option ${sel[i] === v ? "selected" : ""}>${v}</option>`).join("")}</select></td></tr>`).join("")}</tbody></table></div></section>`;
}
function helpTab(doc) {
  const s = doc.session;
  return `<section class="panel"><div class="row" style="margin:0 0 6px;justify-content:space-between"><b>도움 자료 공개</b>${gsel(doc)}</div><p class="small" style="margin:2px 0 10px">기본은 숨김입니다. 모둠이 먼저 생각한 뒤 필요한 때에 전체 또는 특정 모둠에만 공개합니다. 공개 시각이 기록되고, 공개 뒤 학생이 만든 항목에는 '공개 후' 표시가 붙습니다. 유사 사례는 4단계 시작 때 사례 1을 전체에 공개하고, 요청한 모둠에 다음 사례를 차례로 공개합니다. 실제 사건 기사 3건은 도움 자료가 아니라 2단계 시작 때 전체에 공개하는 자료입니다.</p>
   <div class="tablewrap"><table style="min-width:640px"><thead><tr><th>단계</th><th>자료</th><th>상태</th><th></th></tr></thead><tbody>${D.help.map(h => {
    const r = s.rev[h.k], gs = Object.entries(r.g || {}).filter(([, v]) => v);
    if (h.seq) { const mine = helpVisFor(s, h.k, selG); return `<tr><td class="num">${h.stage}</td><td>${esc(h.name)}</td><td>${r.all || gs.length ? `<span class="chip ${r.all ? "G" : "Y"}">전체 ${r.all}건 · ${selG}모둠 ${mine}건 / ${D.cases.length}</span>` : '<span class="chip N">숨김</span>'}</td><td><div class="gates"><button data-act="case" data-m="all" ${r.all >= D.cases.length ? "disabled" : ""}>다음 사례 전체 공개</button><button data-act="case" data-m="g" ${mine >= D.cases.length ? "disabled" : ""}>${selG}모둠에 다음 사례</button><button data-act="help" data-k="case" data-m="hide">숨기기</button></div></td></tr>`; }
    return `<tr><td class="num">${h.stage}</td><td>${esc(h.name)}</td><td>${r.all ? `<span class="chip G">전체 공개 ${hm(r.t)}</span>` : gs.length ? `<span class="chip Y">${gs.map(([g]) => g).join("·")}모둠만 ${hm(r.t)}</span>` : '<span class="chip N">숨김</span>'}</td><td><div class="gates"><button data-act="help" data-k="${h.k}" data-m="all">전체 공개</button><button data-act="help" data-k="${h.k}" data-m="g">${selG}모둠만</button><button data-act="help" data-k="${h.k}" data-m="hide">숨기기</button></div></td></tr>`;
  }).join("")}</tbody></table></div></section>`;
}
function setTab(doc) {
  const s = doc.session;
  return `<section class="panel"><div class="grid2">
   <div class="field"><label for="st-title">수업 제목</label><input type="text" id="st-title" value="${esc(s.title)}"></div>
   <div class="field"><span class="lab">모둠 수</span><div class="row" style="margin:0"><span class="num">${s.groups}모둠</span><button class="btn sm" data-act="addG">모둠 하나 더</button></div><span class="small">학생 기록이 생긴 모둠은 지우지 않습니다.</span></div>
   <div class="field"><span class="lab">리허설 모드</span><div class="opts"><button class="opt" data-act="rehearsal" data-v="on" aria-pressed="${!!s.rehearsal}">켜기<small>확인 전 자료와 리허설 버튼(예시 넣기 등)이 학생에게 보임</small></button><button class="opt" data-act="rehearsal" data-v="off" aria-pressed="${!s.rehearsal}">끄기<small>실제 수업</small></button></div></div>
   <div class="field"><span class="lab">AI 응답</span><div class="opts"><button class="opt" aria-pressed="true">미리 넣은 예시<small>견본의 시연 응답</small></button><button class="opt" disabled>서버(Claude)<small>Firebase Cloud Functions 연결 후</small></button></div></div>
   </div><div class="row"><button class="btn primary" data-act="saveSet">저장</button><button class="btn danger" data-act="delS" data-v="${esc(s.code)}" style="margin-left:auto">이 수업 삭제</button></div></section>`;
}
function bigView() {
  const s = store.get(code).session;
  return `<div class="overlay" role="dialog" aria-label="수업 코드 크게 보기"><p>${esc(s.title)}</p><span class="codebig">${esc(s.code)}</span><div class="qr" data-url="${esc(joinURL(s.code))}"></div><p>학생 화면에서 코드를 넣거나 QR을 찍어 들어오세요 · ${s.open}단계까지 열림</p><button class="tbtn" data-act="unbig">닫기</button></div>`;
}

/* ================= 동작 ================= */
function watch(c) { if (subscribed.has(c)) return; subscribed.add(c); store.subscribe(c, () => { if (code === c) requestRender(); }); }
const upd = fn => { try { store.update(code, fn); } catch (e) { toast(e.message, true); } };
const val = id => { const el = document.getElementById(id); return el ? el.value.trim() : ""; };
function csv() {
  const doc = store.get(code), q = x => `"${String(x ?? "").replace(/"/g, '""')}"`;
  const lines = [["모둠", "구분", "시각", "단계", "종류", "내용", "처리"].map(q).join(",")];
  Object.entries(doc.groups).forEach(([g, x]) => {
    x.logs.forEach(l => lines.push([g, "기록", l.t, l.stage, l.kind, l.text, ""].map(q).join(",")));
    x.alerts.forEach(a => lines.push([g, "알림", a.t, a.stage, a.kind, a.text, a.done ? a.res : "미처리"].map(q).join(",")));
    chainOf(x.work).forEach(([k, v]) => lines.push([g, "흐름", "", 7, k, v, ""].map(q).join(",")));
  });
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `AI-EPS_${doc.session.code}_${new Date().toISOString().slice(0, 10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
}
document.addEventListener("click", e => {
  const b = e.target.closest("button,input[type=checkbox][data-act]"); if (!b || b.disabled) return;
  if (b.dataset.ltab) { ltab = b.dataset.ltab; render(false); return; }
  if (b.dataset.tab) { tab = b.dataset.tab; render(false); return; }
  const a = b.dataset.act; if (!a) return;
  const n = +b.dataset.n, v = b.dataset.v;
  switch (a) {
    case "logout": if (confirm("로그아웃할까요?")) { teacher = ""; localStorage.removeItem(TKEY); view = "list"; } break;
    case "openS": code = v; view = "session"; tab = "prog"; selG = 1; watch(v); window.scrollTo(0, 0); break;
    case "delS": if (!confirm(`수업 ${v}와 학생 기록을 모두 지울까요? 되돌릴 수 없습니다. 먼저 '기록 CSV'로 받아 두세요.`)) return; store.remove(v); if (code === v) { code = null; view = "list"; } break;
    case "back": view = "list"; code = null; big = false; break;
    case "close": if (!confirm("수업을 닫을까요? 학생 화면이 잠깁니다.")) return; upd(d => { d.session.status = "closed"; }); break;
    case "reopen": upd(d => { d.session.status = "open"; }); break;
    case "big": big = true; break;
    case "unbig": big = false; break;
    case "copycode": navigator.clipboard?.writeText(`${store.get(code).session.code}  ${joinURL(code)}`).then(() => toast("코드와 입장 주소를 복사했습니다."), () => toast("복사가 막혔습니다.", true)); return;
    case "csv": csv(); return;
    case "preset": { const el = $("#bc-text"); if (el) { el.value = v; el.focus(); } return; }
    case "send": { const t = val("bc-text"), to = $("#bc-to").value; if (!t) return; upd(d => { d.session.broadcasts.push({ id: Date.now().toString(36), t: now(), text: t, to }); }); toast("보냈습니다."); break; }
    case "openTo": upd(d => { d.session.open = n; Object.values(d.groups).forEach(g => pushLog(g, n, "open", `${n}단계까지 개방`)); }); break;
    case "selG": selG = +v; break;
    case "tOpen": upd(d => openAI(d, selG, n)); break;
    case "tReq": { const m = val("req-" + n); upd(d => requestFix(d, selG, n, m)); break; }
    case "aDone": upd(d => resolveAlert(d, b.dataset.g, +b.dataset.i, v, !!b.dataset.resume)); break;
    case "t6ok": { const g = b.dataset.g; const note = val("t6-note-" + g); upd(d => teacherCheck6(d, g, note)); break; }
    case "help": upd(d => revealHelp(d, D, b.dataset.k, b.dataset.m, selG)); break;
    case "case": upd(d => revealHelp(d, D, "case", b.dataset.m, selG)); break;
    case "rehearsal": upd(d => { d.session.rehearsal = v === "on"; }); break;
    case "addG": upd(d => { d.session.groups += 1; d.groups[d.session.groups] = emptyGroup(D); }); break;
    case "saveSet": { const t = val("st-title"); upd(d => { if (t) d.session.title = t; }); toast("저장했습니다."); break; }
    case "recheck": { const rc = rechecks(); rc[v] = b.checked; localStorage.setItem(RCK(), JSON.stringify(rc)); return; }
  }
  render();
});
document.addEventListener("change", e => {
  const el = e.target, k = el.dataset.actChange; if (!k) return;
  if (k === "selG") { selG = +el.value; render(); }
  if (k === "eval") { const i = +el.dataset.i; upd(d => { const s = d.session; s.evalSel = s.evalSel || {}; (s.evalSel[selG] = s.evalSel[selG] || [])[i] = el.value; }); }
});
document.addEventListener("submit", e => {
  e.preventDefault();
  if (e.target.id === "loginf") { teacher = val("t-name"); if (!teacher) return; localStorage.setItem(TKEY, teacher); render(false); }
  if (e.target.id === "newf") { const d = newSession(D, { title: val("n-title"), groups: +$("#n-g").value, teacher }); code = d.session.code; view = "session"; tab = "prog"; selG = 1; watch(code); render(false); toast(`수업 ${code}을 만들었습니다. 리허설 모드로 시작합니다.`); }
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && big) { big = false; render(); } if (e.key === "Enter" && e.target.id === "bc-text" && !e.isComposing) { e.preventDefault(); document.querySelector('[data-act="send"]')?.click(); } });
window.addEventListener("online", () => render()); window.addEventListener("offline", () => render());
setInterval(() => { if (view === "session") requestRender(); }, 15000); // 접속 중 표시 갱신

(async () => {
  try { D = await loadLesson(); } catch (e) { app.innerHTML = `<div class="panel">${esc(e.message)}</div>`; return; }
  P = prompts(D);
  render(false);
})();
