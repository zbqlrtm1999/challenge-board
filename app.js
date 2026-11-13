'use strict';
/*
 * 취업 준비 챌린지보드
 * - 정적 페이지(GitHub Pages). 기록은 같은 저장소의 data/ 와 records/ 에 저장한다.
 * - 저장은 "보드 열쇠"(이 저장소 전용 fine-grained 토큰)로 GitHub API에 직접 커밋한다.
 * - 열쇠는 sessionStorage에만 두고 [잠그기] 또는 창 닫기로 지운다.
 * 구조와 규칙은 docs/AGENTS.md 참고.
 */

// ───────── 작은 도구 ─────────
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = (o) => JSON.parse(JSON.stringify(o ?? null));
const safe = (fn, fb) => { try { return fn(); } catch { return fb; } };
const ss = {
  get: (k) => safe(() => sessionStorage.getItem(k), null),
  set: (k, v) => safe(() => sessionStorage.setItem(k, v)),
  del: (k) => safe(() => sessionStorage.removeItem(k)),
};
const ls = {
  get: (k) => safe(() => localStorage.getItem(k), null),
  set: (k, v) => safe(() => localStorage.setItem(k, v)),
  del: (k) => safe(() => localStorage.removeItem(k)),
  keys: () => safe(() => Object.keys(localStorage), []),
};
const isNarrow = () => safe(() => matchMedia('(max-width: 640px)').matches, false);

// ───────── 날짜 (모두 한국 시간 기준 'YYYY-MM-DD' 문자열) ─────────
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const todayKST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
const pd = (s) => new Date(s + 'T00:00:00Z');
const fd = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = pd(s); d.setUTCDate(d.getUTCDate() + n); return fd(d); };
const dayNum = (s) => { const w = pd(s).getUTCDay(); return w === 0 ? 7 : w; }; // 월=1 … 일=7
const mondayOf = (s) => addDays(s, 1 - dayNum(s));
const diffDays = (a, b) => Math.round((pd(b) - pd(a)) / 864e5);
const monthIdx = (s) => Number(s.slice(0, 4)) * 12 + Number(s.slice(5, 7)) - 1;
const md = (s) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;
const longDate = (s) => `${Number(s.slice(5, 7))}월 ${Number(s.slice(8, 10))}일 ${WD[pd(s).getUTCDay()]}요일`;
const wdName = (n) => WD[n % 7];

// ───────── 상태 ─────────
const DEFAULT_SETTINGS = {
  title: '취업 준비 챌린지보드',
  subtitle: '게임운영 지망생의 매일 CS·운영 연습 기록',
  startDate: '2026-11-16',
  pack: 'game-ops',
  owner: 'zbqlrtm1999', repo: 'challenge-board', branch: 'main',
  dailyItems: [
    { id: 'vitamin', name: '아침 비타민', note: '' },
    { id: 'jobs', name: '공고 확인', note: '공고판에서 새 공고 보기' },
    { id: 'job', name: '직무능력준비', type: 'job', note: 'CS 3개 + 활동 1개' },
    { id: 'walk', name: '운동', note: '산책 30분' },
  ],
  gameRotation: [], extraGames: [], busyLimitPerWeek: 2,
};
const S = {
  settings: clone(DEFAULT_SETTINGS), pack: null, acts: { menus: [] }, realGames: [], missions: [],
  records: {}, feedback: {}, excelIndex: { weeks: [] }, excelCache: {},
  token: null, dir: null, today: todayKST(), date: null, view: 'today',
  draft: null, draftDate: null, draftRestored: false, form: null, busy: false,
  ui: { keyOpen: false, rview: 'cs', rset: null, qopen: null, open: {}, cmp: [], cmpShow: null,
        mfilter: 'all', mopen: null, mform: null, mcmp: [], mcmpShow: null, mini: {}, gscreen: 'today', gblock: null, refl: {} },
};

// ───────── 저장소 연결 ─────────
function repoInfo() {
  const h = location.hostname;
  if (h.endsWith('.github.io')) {
    const owner = h.split('.')[0];
    const seg = location.pathname.split('/').filter(Boolean)[0];
    return { owner, repo: seg || `${owner}.github.io`, branch: S.settings.branch || 'main' };
  }
  return { owner: S.settings.owner, repo: S.settings.repo, branch: S.settings.branch || 'main' };
}
const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

async function gh(path, opts = {}) {
  const r = await fetch('https://api.github.com' + path, {
    ...opts,
    headers: {
      Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28',
      ...(S.token ? { Authorization: 'Bearer ' + S.token } : {}),
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.headers || {}),
    },
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    const err = new Error(`GitHub ${r.status}: ${t.slice(0, 160)}`);
    err.status = r.status;
    throw err;
  }
  return r.status === 204 ? null : r.json();
}

async function readRepoText(path) {
  const { owner, repo, branch } = repoInfo();
  const r = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${encPath(path)}?ref=${branch}`, {
    headers: { Accept: 'application/vnd.github.raw+json', Authorization: 'Bearer ' + S.token },
    cache: 'no-store',
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  return r.text();
}

async function loadJSON(path, fallback) {
  try {
    let txt;
    if (S.token) txt = await readRepoText(path);
    else {
      const r = await fetch(path + '?t=' + Date.now(), { cache: 'no-store' });
      txt = r.ok ? await r.text() : null;
    }
    return txt == null ? fallback : JSON.parse(txt);
  } catch (e) {
    console.warn('불러오기 실패', path, e);
    return fallback;
  }
}

// 여러 파일을 커밋 하나로 저장 (Git Data API)
async function commitFiles(files, message) {
  const { owner, repo, branch } = repoInfo();
  const base = `/repos/${owner}/${repo}/git`;
  const ref = await gh(`${base}/ref/heads/${branch}`);
  const parent = await gh(`${base}/commits/${ref.object.sha}`);
  const tree = await gh(`${base}/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: parent.tree.sha, tree: files.map((f) => ({ path: f.path, mode: '100644', type: 'blob', content: f.content })) }),
  });
  const commit = await gh(`${base}/commits`, { method: 'POST', body: JSON.stringify({ message, tree: tree.sha, parents: [ref.object.sha] }) });
  await gh(`${base}/refs/heads/${branch}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) });
  for (const f of files) await writeLocal(f.path, f.content);
}

// ───────── 내 폴더 (File System Access API, PC Chrome·Edge) ─────────
function idb() {
  return new Promise((res, rej) => {
    const q = indexedDB.open('challenge-board', 1);
    q.onupgradeneeded = () => q.result.createObjectStore('kv');
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}
async function idbGet(k) { try { const db = await idb(); return await new Promise((res) => { const t = db.transaction('kv').objectStore('kv').get(k); t.onsuccess = () => res(t.result); t.onerror = () => res(null); }); } catch { return null; } }
async function idbSet(k, v) { try { const db = await idb(); await new Promise((res) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = res; t.onerror = res; }); } catch { /* 무시 */ } }
async function idbDel(k) { try { const db = await idb(); await new Promise((res) => { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').delete(k); t.oncomplete = res; t.onerror = res; }); } catch { /* 무시 */ } }

async function dirReady(ask) {
  if (!S.dir) return false;
  try {
    let p = await S.dir.queryPermission({ mode: 'readwrite' });
    if (p !== 'granted' && ask) p = await S.dir.requestPermission({ mode: 'readwrite' });
    return p === 'granted';
  } catch { return false; }
}
async function writeLocal(path, content) {
  if (!(await dirReady(true))) return;
  try {
    const parts = path.split('/');
    let d = S.dir;
    for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
    const fh = await d.getFileHandle(parts[parts.length - 1], { create: true });
    const w = await fh.createWritable();
    await w.write(content);
    await w.close();
  } catch (e) { console.warn('폴더 저장 실패', path, e); }
}
async function connectFolder() {
  if (!window.showDirectoryPicker) { toast('이 브라우저는 폴더 연결을 지원하지 않아요. PC의 Chrome이나 Edge에서 해 주세요.'); return; }
  try {
    S.dir = await window.showDirectoryPicker({ mode: 'readwrite' });
    await idbSet('dir', S.dir);
    toast('폴더를 연결했어요. 이제 저장할 때 이 폴더에도 파일이 생겨요.');
    render();
  } catch { /* 취소 */ }
}
async function importAll() {
  if (!(await dirReady(true))) { toast('먼저 폴더를 연결해 주세요.'); return; }
  const { owner, repo, branch } = repoInfo();
  try {
    toast('저장소 파일을 가져오는 중이에요…');
    const tree = await gh(`/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`);
    const blobs = tree.tree.filter((t) => t.type === 'blob');
    let n = 0;
    for (const b of blobs) {
      const r = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${encPath(b.path)}`, { cache: 'no-store' });
      if (!r.ok) continue;
      await writeLocal(b.path, await r.blob());
      n++;
    }
    toast(`${n}개 파일을 내 폴더로 가져왔어요.`);
  } catch (e) { toast('가져오기에 실패했어요. 잠시 뒤 다시 해 주세요. (' + e.message + ')'); }
}

// ───────── 팩·게임·세트 ─────────
const start = () => S.settings.startDate;
const isPractice = (d) => d < start();
// 한 달 세트 = 원래 세트(기본 · 불만·항의 · 까다로운 상황)에서 요일마다 하나씩 섞은 것.
// k번째 달: 원래 세트 j의 그 요일 문의 중 (k + j) % 개수 번째. 세트 수만큼 달이 지나면 모든 문의를 한 번씩 쓴다.
let mixCache = null;
function mixedSets() {
  if (mixCache && mixCache.pack === S.pack) return mixCache.list;
  const sets = S.pack?.sets || [];
  const list = sets.map((_, k) => {
    const inquiries = {};
    for (let d = 1; d <= 7; d++) inquiries[String(d)] = sets.map((s, j) => { const l = s.inquiries?.[String(d)] || []; return l.length ? l[(k + j) % l.length] : null; }).filter(Boolean);
    const events = {};
    for (const g of S.pack?.fictionalGames || []) events[g.id] = sets.flatMap((s) => s.events?.[g.id] || []);
    return { id: `mix${k + 1}`, name: `${k + 1}번째 달 세트`, theme: sets.map((s) => s.name.split('·').pop().trim()).join(' + ') + ' 하루에 하나씩', inquiries, events };
  });
  mixCache = { pack: S.pack, list };
  return list;
}
function setFor(date) {
  const sets = mixedSets();
  if (!sets.length) return null;
  const i = Math.max(0, monthIdx(date) - monthIdx(start()));
  return sets[i % sets.length];
}
const gameFor = (date) => (S.pack?.fictionalGames || []).find((g) => g.day === dayNum(date));
const inquiriesFor = (date) => setFor(date)?.inquiries?.[String(dayNum(date))] || [];
const levelOf = (qid) => (S.pack?.sets || []).find((s) => qid.startsWith(s.id + '-'))?.name.split('·').pop().trim() || '';
function findInquiry(qid) {
  for (const set of S.pack?.sets || []) for (const [day, list] of Object.entries(set.inquiries || {})) {
    const q = list.find((x) => x.id === qid);
    if (q) return { q, set, day: Number(day), game: (S.pack.fictionalGames || []).find((g) => g.day === Number(day)) };
  }
  return null;
}
const allGames = () => [...S.realGames, ...(S.settings.extraGames || [])];
const gameById = (id) => allGames().find((g) => g.id === id);
function rotationList() {
  const ids = (S.settings.gameRotation && S.settings.gameRotation.length) ? S.settings.gameRotation : allGames().map((g) => g.id);
  return ids.map(gameById).filter(Boolean);
}
function rotationGame(date) {
  const list = rotationList();
  if (!list.length) return null;
  const w = Math.max(0, Math.floor(diffDays(mondayOf(start()), mondayOf(date)) / 7));
  return { game: list[w % list.length], index: w % list.length, n: list.length, next: list[(w + 1) % list.length], from: mondayOf(date) };
}
const menus = () => S.acts.menus || [];
const menuById = (id) => menus().find((m) => m.id === id);

// ───────── 기록 계산 ─────────
const sortedDates = () => Object.keys(S.records).sort();
const graded = (date) => !!S.feedback[date];
function canEdit(date) {
  if (graded(date) || date > S.today) return false;
  return date === S.today || date === addDays(S.today, -1) || !!S.records[date];
}
function blankRecord(date) {
  const rot = rotationGame(date);
  return { date, daily: {}, busy: false, cs: { answers: {} }, activity: { menu: null, game: rot?.game?.id || '', fields: {}, body: '' }, missionManual: {}, memo: '', reflect: {} };
}
function csCount(rec, date) {
  if (!rec?.cs?.answers) return 0;
  return inquiriesFor(date).filter((q) => (rec.cs.answers[q.id] || '').trim()).length;
}
function activityDone(rec) {
  const a = rec?.activity;
  if (!a?.menu) return false;
  if (a.menu === 'excel') return !!(a.excel && (Object.values(a.excel.answers || {}).some((v) => String(v).trim()) || (a.excel.reason || '').trim()));
  const tpl = (menuById(a.menu)?.template || '').trim();
  const body = (a.body || '').trim();
  return !!body && body !== tpl;
}
function jobState(rec, date) {
  const cs = csCount(rec, date), act = activityDone(rec);
  if (rec?.busy) return cs >= 1 ? 'light' : 'none';
  if (cs >= 3 && act) return 'done';
  return cs > 0 || act ? 'half' : 'none';
}
function itemDone(item, rec, date) {
  if (!rec) return false;
  if (item.type === 'job') return ['done', 'light'].includes(jobState(rec, date));
  return !!rec.daily?.[item.id];
}
function dayLevel(date, rec = S.records[date]) {
  const items = S.settings.dailyItems;
  const done = items.filter((it) => itemDone(it, rec, date)).length;
  return { done, total: items.length, light: !!rec?.busy && done === items.length };
}
const dayComplete = (date) => { const l = dayLevel(date); return l.total > 0 && l.done === l.total; };
function currentStreak() {
  let d = S.today, n = 0;
  if (!dayComplete(d)) d = addDays(d, -1);
  while (d >= start() && dayComplete(d)) { n++; d = addDays(d, -1); }
  return n;
}
function itemStreaks(item) {
  let cur = 0, best = 0, run = 0;
  for (let d = start(); d <= S.today; d = addDays(d, 1)) {
    if (itemDone(item, S.records[d], d)) { run++; best = Math.max(best, run); } else if (d !== S.today) run = 0;
  }
  let d = S.today;
  if (!itemDone(item, S.records[d], d)) d = addDays(d, -1);
  while (d >= start() && itemDone(item, S.records[d], d)) { cur++; d = addDays(d, -1); }
  return { cur, best };
}
function busyUsed(date) {
  const mon = mondayOf(date);
  return sortedDates().filter((d) => d !== date && mondayOf(d) === mon && S.records[d].busy).length;
}
function missionEntries(m) {
  const out = [];
  for (const d of sortedDates()) {
    if (d < (m.createdAt || start())) continue;
    const r = S.records[d];
    if (m.menu && r.activity?.menu === m.menu && activityDone(r)) out.push({ date: d, rec: r });
    if (!m.menu && r.missionManual && Object.prototype.hasOwnProperty.call(r.missionManual, m.id)) out.push({ date: d, rec: r, note: r.missionManual[m.id] });
  }
  return out;
}
const missionDone = (m) => missionEntries(m).length >= Number(m.target || 1);
function weeklyCsAvg() {
  const by = {};
  for (const [d, fb] of Object.entries(S.feedback)) {
    if (isPractice(d)) continue;
    for (const v of Object.values(fb.cs || {})) {
      if (typeof v.score !== 'number') continue;
      (by[mondayOf(d)] ||= []).push(v.score);
    }
  }
  return Object.keys(by).sort().map((w) => ({ week: w, avg: by[w].reduce((a, b) => a + b, 0) / by[w].length }));
}
function monthRate() {
  const from = [start(), S.today.slice(0, 8) + '01'].sort()[1];
  let sum = 0, days = 0;
  for (let d = from; d <= S.today; d = addDays(d, 1)) {
    if (d === S.today && !S.records[d]) continue;
    const l = dayLevel(d);
    sum += l.total ? l.done / l.total : 0; days++;
  }
  return days ? Math.round((sum / days) * 100) : null;
}

// ───────── 엑셀 과제 ─────────
function normAnswer(s) {
  let t = String(s ?? '').replace(/[\s,명건원%회개분]/g, '');
  if (/^-?\d+(\.\d+)?$/.test(t)) {
    const n = Number(t);
    if (Number.isInteger(n)) return String(n);
    const r = Math.round(n * 10) / 10;
    return Number.isInteger(r) ? String(r) : r.toFixed(1);
  }
  return t;
}
async function sha256(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function excelEntry(date) {
  const mon = mondayOf(date);
  const weeks = [...(S.excelIndex.weeks || [])].sort((a, b) => (a.week < b.week ? 1 : -1));
  return weeks.find((w) => w.week === mon) || weeks.find((w) => w.week <= mon) || null;
}
async function ensureExcel(week) {
  if (S.excelCache[week] !== undefined) return;
  S.excelCache[week] = null;
  S.excelCache[week] = await loadJSON(`data/excel/${week}.json`, false);
  render();
}
function decodeReveal(b64) {
  return safe(() => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))), null);
}

// ───────── 작성 중 내용 (이 브라우저에만 임시 저장) ─────────
let draftTimer = null;
function draftFor(date) {
  if (S.draftDate === date && S.draft) return S.draft;
  S.draftDate = date;
  S.draftRestored = false;
  const saved = ls.get('cb_draft_' + date);
  const base = S.records[date] ? clone(S.records[date]) : blankRecord(date);
  const parsed = saved ? safe(() => JSON.parse(saved), null) : null;
  if (parsed && canEdit(date)) { S.draft = { ...base, ...parsed }; S.draftRestored = true; }
  else S.draft = base;
  S.draft.cs ||= { answers: {} }; S.draft.cs.answers ||= {};
  S.draft.activity ||= { menu: null, fields: {}, body: '' }; S.draft.activity.fields ||= {};
  S.draft.daily ||= {}; S.draft.missionManual ||= {};
  return S.draft;
}
function saveDraftSoon() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(() => { if (S.draftDate) ls.set('cb_draft_' + S.draftDate, JSON.stringify(S.draft)); }, 400);
}
function clearDrafts() { for (const k of ls.keys()) if (k.startsWith('cb_draft_')) ls.del(k); S.draft = null; S.draftDate = null; }

// ───────── 마크다운 기록 파일 ─────────
function toMarkdown(rec) {
  const date = rec.date, set = setFor(date), game = gameFor(date);
  const L = [`# ${date} (${WD[pd(date).getUTCDay()]})${rec.late ? ' · ⏱ 늦은 기록' : ''}${isPractice(date) ? ' · 연습 기간' : ''}`, ''];
  L.push('## 일일 항목');
  for (const it of S.settings.dailyItems) L.push(`- [${itemDone(it, rec, date) ? 'x' : ' '}] ${it.name}`);
  if (rec.busy) L.push('- 바쁜 날 모드');
  L.push('', `## 💬 CS 답변 (${set?.name || ''} · ${game?.name || ''})`);
  for (const q of inquiriesFor(date)) {
    const a = (rec.cs?.answers?.[q.id] || '').trim();
    if (!a) continue;
    L.push(`### ${q.type}: ${q.text}`, '', a, '');
  }
  const act = rec.activity;
  if (act?.menu && activityDone(rec)) {
    const m = menuById(act.menu), g = gameById(act.game);
    L.push(`## 📚 오늘의 활동: ${m?.name || act.menu}${g ? ' · ' + g.name : ''}`, '');
    for (const f of m?.fields || []) if ((act.fields?.[f.id] || '').trim()) L.push(`- ${f.label}: ${act.fields[f.id]}`);
    if (act.menu === 'excel' && act.excel) {
      L.push(`- 과제 주차: ${act.excel.week}`);
      for (const [k, v] of Object.entries(act.excel.answers || {})) L.push(`- ${k}: ${v}${act.excel.correct?.[k] === true ? ' ✓' : act.excel.correct?.[k] === false ? ' ✗' : ''}`);
      if (act.excel.reason) L.push('', '### 추론', act.excel.reason);
      if (act.excel.report) L.push('', '### 보고서', act.excel.report);
    } else L.push('', act.body || '');
    L.push('');
  }
  const mm = Object.entries(rec.missionManual || {});
  if (mm.length) {
    L.push('## 🎯 미션 진행');
    for (const [id, note] of mm) L.push(`- ${S.missions.find((m) => m.id === id)?.name || id}${note ? ': ' + note : ''}`);
    L.push('');
  }
  if ((rec.memo || '').trim()) L.push('## 메모', rec.memo.trim(), '');
  return L.join('\n');
}

// ───────── 저장 ─────────
function needKey() {
  if (isNarrow()) { toast('휴대폰에서는 보기만 할 수 있어요. PC에서 저장해 주세요.'); return true; }
  if (!S.token) { S.ui.keyOpen = true; render(); toast('저장하려면 먼저 보드 열쇠를 넣어 주세요.'); return true; }
  return false;
}
async function freshRecords() { return JSON.parse((await readRepoText('data/records.json')) || '{}'); }

async function saveToday() {
  if (needKey() || S.busy) return;
  const date = S.date;
  if (!canEdit(date)) { toast('이 날짜는 더 이상 고칠 수 없어요.'); return; }
  const rec = clone(S.draft);
  const prev = S.records[date];
  rec.date = date;
  rec.savedAt = new Date().toISOString();
  rec.late = prev ? !!prev.late : date !== S.today;
  rec.setId = setFor(date)?.id || null;
  rec.csGame = gameFor(date)?.id || null;
  for (const [k, v] of Object.entries(rec.cs.answers)) if (!String(v).trim()) delete rec.cs.answers[k];
  if (rec.activity && !activityDone(rec)) rec.activity = { menu: null, game: rec.activity.game, fields: {}, body: '' };
  S.busy = true; render();
  try {
    const latest = await freshRecords();
    if (latest[date]?.reflect) rec.reflect = { ...latest[date].reflect, ...(rec.reflect || {}) };
    latest[date] = rec;
    await commitFiles([
      { path: 'data/records.json', content: JSON.stringify(latest, null, 1) + '\n' },
      { path: `records/${date}.md`, content: toMarkdown(rec) },
    ], `기록: ${date}`);
    S.records = latest;
    ls.del('cb_draft_' + date);
    S.draft = null; S.draftDate = null;
    toast('저장했어요. 공개 보드에는 1~2분 뒤에 반영돼요.');
  } catch (e) {
    toast(saveError(e));
  } finally { S.busy = false; render(); }
}
function saveError(e) {
  if (e.status === 401) return '열쇠가 맞지 않거나 만료됐어요. 설정 탭의 안내대로 새 열쇠를 만들어 주세요.';
  if (e.status === 403 || e.status === 404) return '이 열쇠로는 저장소에 쓸 수 없어요. 열쇠의 저장소와 권한(Contents: Read and write)을 확인해 주세요.';
  if (e.status === 409 || e.status === 422) return '다른 저장과 겹쳤어요. 잠시 뒤 다시 저장해 주세요.';
  return '저장하지 못했어요. 인터넷 연결을 확인하고 다시 눌러 주세요. (' + e.message + ')';
}
async function saveJSONFile(path, data, msg) {
  if (needKey() || S.busy) return false;
  S.busy = true; render();
  try { await commitFiles([{ path, content: JSON.stringify(data, null, 2) + '\n' }], msg); toast('저장했어요.'); return true; }
  catch (e) { toast(saveError(e)); return false; }
  finally { S.busy = false; render(); }
}
async function saveReflection(date, qid) {
  if (needKey() || S.busy) return;
  const text = S.ui.refl[date + '|' + qid] ?? S.records[date]?.reflect?.[qid] ?? '';
  S.busy = true; render();
  try {
    const latest = await freshRecords();
    if (!latest[date]) throw new Error('기록을 찾을 수 없어요');
    latest[date].reflect = { ...(latest[date].reflect || {}), [qid]: text };
    await commitFiles([{ path: 'data/records.json', content: JSON.stringify(latest, null, 1) + '\n' }], `다음엔 이렇게: ${date}`);
    S.records = latest;
    toast('"다음엔 이렇게"를 저장했어요.');
  } catch (e) { toast(saveError(e)); } finally { S.busy = false; render(); }
}

// ───────── 공통 조각 ─────────
const check = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="var(--surface)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
function scoreBar(n, max = 5) {
  if (typeof n !== 'number') return '<span class="sub">채점 대기</span>';
  return `<span class="score" aria-label="${max}점 중 ${n}점">${Array.from({ length: max }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span><span class="num">${n}/${max}</span>`;
}
function checksHtml(fb, prevFb) {
  const rub = S.pack?.rubric || [];
  if (!fb?.checks) return '';
  return `<div class="checks">${rub.map((r) => {
    const on = !!fb.checks[r.id], gain = on && prevFb?.checks && !prevFb.checks[r.id];
    return `<span class="${gain ? 'gain' : on ? 'on' : ''}">${on ? '✓' : '·'} ${esc(r.name)}</span>`;
  }).join('')}${fb.violation ? `<span class="viol">⚠ ${esc(S.pack?.violation?.name || '정책 위반')} −${S.pack?.violation?.penalty ?? 1}</span>` : ''}</div>`;
}
function aiBlock(fb, kind = 'cs') {
  if (!fb) return `<div class="ai"><span class="pill">🤖 AI 코치</span><span>채점 대기 · 일요일 23:50</span></div>`;
  if (kind === 'cs') return `<div class="ai"><span class="pill">🤖 AI 코치</span><span>${scoreBar(fb.score)}</span></div>${checksHtml(fb)}
    ${fb.comment ? `<p class="ai"><span>${esc(fb.comment)}</span></p>` : ''}${fb.change ? `<p class="ai"><span class="pill">달라진 점</span><span>${esc(fb.change)}</span></p>` : ''}`;
  return `<div class="ai"><span class="pill">🤖 AI 코치</span></div>
    ${fb.good ? `<p class="ai"><span class="pill">잘한 점</span><span>${esc(fb.good)}</span></p>` : ''}
    ${fb.fix ? `<p class="ai"><span class="pill">고칠 점</span><span>${esc(fb.fix)}</span></p>` : ''}
    ${fb.change ? `<p class="ai"><span class="pill">달라진 점</span><span>${esc(fb.change)}</span></p>` : ''}`;
}
function rubricDetails() {
  const rub = S.pack?.rubric || [];
  return `<details class="policy" style="border:0;padding:0"><summary>ℹ️ 채점 기준</summary>
    <ul>${rub.map((r) => `<li><b>${esc(r.name)}</b>: ${esc(r.desc)}</li>`).join('')}
    <li><b>${esc(S.pack?.violation?.name || '정책 위반')}</b>: ${esc(S.pack?.violation?.desc || '')} (−${S.pack?.violation?.penalty ?? 1})</li>
    <li>활동 글은 점수 없이 잘한 점·고칠 점 두 줄, 엑셀 숫자 문제는 정답 일치 여부로 봐요.</li></ul></details>`;
}
function eventsHtml(set, game) {
  const evs = set?.events?.[game?.id] || [];
  const pol = [...(S.pack?.commonPolicy || []), ...(game?.policy || [])];
  return `<div class="game-box">
    <div class="game-row"><span class="label">${wdName(game?.day ?? 0)}요일 가상 게임</span><span class="gname">${esc(game?.name || '')}</span>
      <span class="meta">${esc(game?.genre || '')} · ${esc(game?.platform || '')} · 유료 재화 '${esc(game?.currency || '')}'</span></div>
    ${evs.length ? `<div class="events">${evs.map((e) => `<div class="event"><span class="event-kind">${esc(e.kind || '이벤트')}</span>
      <div class="event-top"><strong>${esc(e.name)}</strong><span class="when">${esc(e.period || '')}</span></div>
      <p>${esc(e.rule || '')}${e.key ? ` <span class="key">${esc(e.key)}</span>` : ''}</p></div>`).join('')}</div>` : ''}
    ${pol.length ? `<details class="policy"><summary>운영 정책 요약 보기</summary><ul>${pol.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></details>` : ''}
  </div>`;
}
function dday(deadline) {
  if (!deadline) return '<span class="dday">마감 없음</span>';
  const n = diffDays(S.today, deadline);
  return `<span class="dday num ${n < 0 ? 'over' : n <= 21 ? 'near' : ''}">${n < 0 ? `D+${-n}` : n === 0 ? 'D-DAY' : `D-${n}`}</span>`;
}
function missionItem(m) {
  const done = missionEntries(m).length, target = Number(m.target || 1);
  return `<li><div class="m-row"><strong>${esc(m.name)}</strong>${dday(m.deadline)}</div>
    <div class="bar"><span style="width:${Math.min(100, Math.round((done / target) * 100))}%"></span></div>
    <div class="m-foot"><span class="num">${done}/${target}</span><span>${esc(m.unit || '')}${m.menu ? ' · ' + esc(menuById(m.menu)?.name || '') : ''}</span></div></li>`;
}
const activeMissions = () => S.missions.filter((m) => !missionDone(m)).sort((a, b) => (a.deadline || '9999') < (b.deadline || '9999') ? -1 : 1);

// ───────── 머리·탭 ─────────
const TABS = [['today', '오늘'], ['missions', '미션'], ['records', '기록'], ['stats', '통계'], ['settings', '설정'], ['guide', '사용법']];
function renderHeader() {
  const st = currentStreak();
  $('#top').innerHTML = `
    <div class="brand"><h1>${esc(S.settings.title)}</h1><p>${esc(S.settings.subtitle)}</p></div>
    <div class="top-right">
      <span class="chip pink"><span class="spark" aria-hidden="true">✦</span><span class="num">${st}</span>일 연속 기록</span>
      ${S.dir ? '<span class="chip ok edit-only"><span class="dot"></span>폴더 연결됨</span>' : ''}
      ${S.token
        ? '<span class="chip ok edit-only"><span class="dot"></span>열쇠 연결됨</span><button class="btn small edit-only" type="button" data-act="lock">잠그기</button>'
        : '<button class="btn small edit-only" type="button" data-act="key-open">열쇠 넣기</button>'}
    </div>
    ${S.ui.keyOpen && !S.token ? `<div class="keypanel edit-only">
      <input type="password" id="key-input" placeholder="github_pat_ 로 시작하는 보드 열쇠를 붙여 넣으세요" autocomplete="off" aria-label="보드 열쇠">
      <button class="btn primary small" type="button" data-act="key-save">연결</button>
      <button class="btn small ghost" type="button" data-act="key-close">닫기</button>
      <span class="sub">창을 닫거나 [잠그기]를 누르면 이 컴퓨터에서 지워져요. 열쇠 만드는 법은 설정 탭에 있어요.</span></div>` : ''}`;
  $('#tabs').innerHTML = TABS.map(([id, name]) => `<a class="tab" role="tab" href="#${id}" aria-selected="${S.view === id}">${name}</a>`).join('');
  $('#foot').innerHTML = `기록은 GitHub 저장소에 저장돼요 · <a href="#summary">공유용 요약 보기</a> · <a href="#guide">사용법</a>`;
}

// ───────── 오늘 ─────────
function viewToday() {
  if (!S.pack) return `<div class="empty">연습 팩을 불러오지 못했어요. 잠시 뒤 새로고침해 주세요.</div>`;
  const date = S.date || S.today;
  const d = draftFor(date);
  const ed = canEdit(date) && !isNarrow();
  const set = setFor(date), game = gameFor(date), qs = inquiriesFor(date), rot = rotationGame(date);
  const lvl = dayLevel(date, d);
  const yday = addDays(S.today, -1);
  const otherDates = sortedDates().filter((x) => x !== S.today && x !== yday && canEdit(x)).reverse().slice(0, 7);

  const banners = [];
  if (isPractice(date)) banners.push(`<p class="banner info">연습 기간이에요. 이 기간 기록은 통계에 들어가지 않아요. 챌린지는 ${longDate(start())}에 시작해요.</p>`);
  if (graded(date)) banners.push('<p class="banner">이 날은 일요일 채점이 끝나서 더 고칠 수 없어요. 결과는 아래와 기록 탭에서 볼 수 있어요.</p>');
  else if (!canEdit(date)) banners.push('<p class="banner">이 날짜는 새로 기록할 수 없어요. 새 기록은 오늘과 어제만 쓸 수 있어요.</p>');
  else if (date !== S.today && !S.records[date]) banners.push('<p class="banner pink">어제 기록이에요. 저장하면 "⏱ 늦은 기록"으로 표시되고, 연속 기록은 그대로 이어져요.</p>');
  if (S.draftRestored) banners.push('<p class="banner info edit-only">저장하지 않은 작성 내용을 불러왔어요. <button class="linkbtn" data-act="draft-clear">작성 내용 버리기</button></p>');

  const daily = S.settings.dailyItems.map((it) => {
    if (it.type === 'job') {
      const js = jobState(d, date);
      const cls = js === 'done' ? 'done' : js === 'light' ? 'light' : js === 'half' ? 'half' : '';
      return `<button class="daily-item ${cls}" type="button" disabled>
        <span class="box">${js === 'done' || js === 'light' ? check : ''}</span>
        <div><strong>${esc(it.name)}</strong><span class="small">${js === 'light' ? '가볍게 완료 (바쁜 날)' : `CS <span class="num">${csCount(d, date)}/3</span> · 활동 <span class="num">${activityDone(d) ? 1 : 0}/1</span>`}</span></div></button>`;
    }
    const on = !!d.daily[it.id];
    return `<button class="daily-item ${on ? 'done' : ''}" type="button" data-act="daily" data-id="${esc(it.id)}" ${ed ? '' : 'disabled'} aria-pressed="${on}">
      <span class="box">${on ? check : ''}</span><div><strong>${esc(it.name)}</strong><span class="small">${esc(it.note || '')}</span></div></button>`;
  }).join('');

  const used = busyUsed(date), limit = Number(S.settings.busyLimitPerWeek ?? 2), busyOk = d.busy || used < limit;
  const csCards = qs.map((q, i) => {
    const ans = d.cs.answers[q.id] || '';
    const prev = sortedDates().filter((x) => x < date && (S.records[x].cs?.answers?.[q.id] || '').trim()).pop();
    const pfb = prev ? S.feedback[prev]?.cs?.[q.id] : null;
    const fb = S.feedback[date]?.cs?.[q.id];
    return `<article class="q ${ans.trim() ? '' : 'active'}">
      <div class="q-top"><span class="q-no">문의 ${i + 1}</span><span class="tag">${esc(q.type)}</span><span class="tag sky">${esc(levelOf(q.id))}</span>
        <span class="state ${ans.trim() ? 'done' : ''}">${ans.trim() ? '작성함' : '아직'}</span></div>
      <p class="inquiry">${esc(q.text)}</p>
      <dl class="facts">${(q.facts || []).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      ${ed
        ? `<div class="answer-label"><span>✍️ 내 답변</span></div><textarea id="cs-${esc(q.id)}" data-bind="cs:${esc(q.id)}" aria-label="문의 ${i + 1} 답변" placeholder="유저에게 보낼 답변을 써 보세요.">${esc(ans)}</textarea>`
        : ans.trim() ? `<span class="mine">✍️ 내 답변</span><p class="written">${esc(ans)}</p>` : '<p class="sub">작성한 답변이 없어요.</p>'}
      ${S.records[date]?.cs?.answers?.[q.id] ? aiBlock(fb) : ''}
      ${prev ? `<div class="last">
        <span>지난 답변 <span class="num">${md(prev)}</span></span><span class="v">${pfb ? scoreBar(pfb.score) : '<span class="sub">채점 대기</span>'} ${esc((S.records[prev].cs.answers[q.id] || '').slice(0, 140))}${(S.records[prev].cs.answers[q.id] || '').length > 140 ? '…' : ''}</span>
        ${pfb?.comment ? `<span>🤖 AI 코치</span><span class="v">${esc(pfb.comment)}</span>` : ''}
        ${S.records[prev].reflect?.[q.id] ? `<span>다음엔 이렇게</span><span class="v">${esc(S.records[prev].reflect[q.id])}</span>` : ''}
        <span></span><span><button class="linkbtn" data-act="goq" data-qid="${esc(q.id)}">이 문의의 성장 기록 보기 →</button></span></div>` : ''}
    </article>`;
  }).join('');

  // 오늘의 활동
  const a = d.activity;
  const menu = a.menu ? menuById(a.menu) : null;
  let actBody = '';
  if (menu?.type === 'excel') actBody = excelHtml(date, d, ed);
  else if (menu) {
    const games = rotationList();
    actBody = `${ed ? `<div class="act-grid">
        <label class="field"><span>게임</span><select data-bind="act:game" id="act-game">${games.map((g) => `<option value="${esc(g.id)}" ${a.game === g.id ? 'selected' : ''}>${esc(g.name)}${rot && g.id === rot.game.id ? ' (이번 주 게임)' : ''}</option>`).join('')}</select></label>
        ${(menu.fields || []).map((f) => `<label class="field"><span>${esc(f.label)}</span><input type="text" id="act-f-${esc(f.id)}" data-bind="act:field:${esc(f.id)}" value="${esc(a.fields[f.id] || '')}" placeholder="${esc(f.placeholder || '')}"></label>`).join('')}
      </div>
      <label class="field"><span>내용</span><textarea id="act-body" rows="9" data-bind="act:body">${esc(a.body || '')}</textarea></label>`
      : `<p class="sub">${esc(gameById(a.game)?.name || '')}</p><p class="written">${esc(a.body || '')}</p>`}
      ${S.records[date] && activityDone(S.records[date]) ? aiBlock(S.feedback[date]?.activity, 'act') : ''}`;
  }
  const linked = menu ? S.missions.filter((m) => m.menu === menu.id && !missionDone(m)) : [];
  const counted = (m) => missionEntries(m).some((e) => e.date === date);
  const linkedHtml = linked.map((m) => {
    const n = missionEntries(m).length, plus = activityDone(d) && !counted(m) ? 1 : 0;
    return `<p class="sub">연결된 미션 <b class="disp" style="color:var(--ink)">${esc(m.name)}</b> <span class="num">${plus ? `${n} → ${n + 1}` : n}/${m.target}</span></p>`;
  }).join('');

  const manual = S.missions.filter((m) => !m.menu && !missionDone(m));
  const manualHtml = manual.length ? `<section class="card"><div class="card-head"><h2>미션 진행</h2><span class="sub">연결 메뉴가 없는 미션은 여기서 체크해요</span></div>
    ${manual.map((m) => {
      const on = Object.prototype.hasOwnProperty.call(d.missionManual, m.id);
      return `<div class="row"><label class="toggle"><input type="checkbox" data-act="mm-toggle" data-id="${esc(m.id)}" ${on ? 'checked' : ''} ${ed ? '' : 'disabled'}> ${esc(m.name)}</label>
        ${on && ed ? `<input type="text" style="flex:1 1 200px" data-bind="mm:${esc(m.id)}" value="${esc(d.missionManual[m.id] || '')}" placeholder="한 일 메모 (선택)">` : on ? `<span class="sub">${esc(d.missionManual[m.id] || '')}</span>` : ''}</div>`;
    }).join('')}</section>` : '';

  return `
  <section class="stack">
    <div class="day-head">
      <h2>${longDate(date)}</h2>
      <div class="row">
        <div class="seg" role="group" aria-label="날짜 고르기">
          <button type="button" data-act="date" data-date="${S.today}" aria-pressed="${date === S.today}">오늘</button>
          <button type="button" data-act="date" data-date="${yday}" aria-pressed="${date === yday}">어제</button>
        </div>
        ${otherDates.length ? `<select style="width:auto" data-act-change="date" aria-label="고칠 수 있는 지난 기록"><option value="">지난 기록 고치기</option>${otherDates.map((x) => `<option value="${x}" ${x === date ? 'selected' : ''}>${md(x)}</option>`).join('')}</select>` : ''}
        <span class="sub">오늘 <span class="num">${lvl.done}/${lvl.total}</span> 완료${set ? ' · CS 문의 ' + esc(set.name) : ''}</span>
      </div>
    </div>
    ${banners.join('')}
    <div class="daily">${daily}</div>
  </section>

  <div class="grid">
    <section class="card">
      <div class="card-head"><h2>오늘의 CS 문의</h2>
        <div class="row"><span class="sub"><span class="num">${csCount(d, date)}/3</span> 작성</span>
        <label class="toggle edit-only" title="CS 1개만 해도 가볍게 완료로 인정돼요"><input type="checkbox" data-act="busy" ${d.busy ? 'checked' : ''} ${ed && busyOk ? '' : 'disabled'}> 바쁜 날 모드 <span class="sub num">(이번 주 ${used + (d.busy ? 1 : 0)}/${limit})</span></label></div>
      </div>
      ${rubricDetails()}
      ${eventsHtml(set, game)}
      ${csCards || '<div class="empty">이 날의 문의가 없어요.</div>'}
    </section>
    <aside class="side">
      ${rot ? `<section class="card"><div class="card-head"><h2>이번 주 게임</h2><span class="sub"><span class="num">${rot.index + 1}/${rot.n}</span>주차</span></div>
        <div class="week-game"><strong>${esc(rot.game.name)}</strong><span class="sub">${esc(rot.game.genre || '')} · ${esc(rot.game.platform || '')} · <span class="num">${md(rot.from)} – ${md(addDays(rot.from, 6))}</span></span></div>
        <div class="rot" style="--n:${rot.n}" aria-label="로테이션 ${rot.n}주 중 ${rot.index + 1}주차">${Array.from({ length: rot.n }, (_, i) => `<span class="${i < rot.index ? 'past' : i === rot.index ? 'now' : ''}"></span>`).join('')}</div>
        <p class="sub">다음 주 ${esc(rot.next.name)}</p></section>` : ''}
      <section class="card"><div class="card-head"><h2>메인 미션</h2><a class="sub" href="#missions">전체 보기</a></div>
        ${activeMissions().length ? `<ul class="missions">${activeMissions().slice(0, 4).map(missionItem).join('')}</ul>` : '<p class="sub">진행 중인 미션이 없어요. 미션 탭에서 등록해요.</p>'}</section>
    </aside>
  </div>

  <section class="card">
    <div class="card-head"><h2>오늘의 활동</h2><span class="sub">하나 골라서 하기</span></div>
    <div class="menu" role="group" aria-label="활동 고르기">${menus().map((m) => `<button type="button" data-act="menu" data-id="${esc(m.id)}" aria-pressed="${a.menu === m.id}" ${ed ? '' : 'disabled'}>${esc(m.name)}</button>`).join('')}</div>
    ${menu ? actBody : '<p class="sub">메뉴를 고르면 작성 칸이 나와요.</p>'}
    ${linkedHtml}
  </section>

  ${manualHtml}

  <section class="card">
    <div class="card-head"><h2>메모</h2><span class="sub">공개돼요. 개인 정보는 쓰지 않아요.</span></div>
    ${ed ? `<textarea id="memo" data-bind="memo" rows="2" placeholder="오늘 한 줄">${esc(d.memo || '')}</textarea>` : `<p class="written">${esc(d.memo || '') || '<span class="sub">메모 없음</span>'}</p>`}
  </section>

  ${ed ? `<div class="savebar edit-only">
    <p>${S.token ? '저장하면 GitHub에 바로 기록돼요. 다 쓰고 나면 [잠그기]를 눌러 주세요.' : '저장하려면 먼저 위의 [열쇠 넣기]로 보드 열쇠를 넣어 주세요.'}</p>
    <button class="btn primary" type="button" data-act="save" ${S.busy ? 'disabled' : ''}>${S.busy ? '저장하는 중…' : `${date === S.today ? '오늘' : md(date)} 기록 저장`}</button></div>` : ''}`;
}

function excelHtml(date, d, ed) {
  const ent = excelEntry(date);
  if (!ent) return '<div class="empty">아직 엑셀 과제가 없어요. 매주 월요일 0시에 자동으로 만들어져요.</div>';
  const task = S.excelCache[ent.week];
  if (task === undefined) { ensureExcel(ent.week); return '<p class="sub">과제를 불러오는 중…</p>'; }
  if (!task) return '<p class="sub">과제를 불러오는 중…</p>';
  const ex = d.activity.excel || {};
  const saved = S.records[date]?.activity?.excel;
  const reveal = saved && (Object.keys(saved.answers || {}).length || saved.reason) ? decodeReveal(task.reveal) : null;
  return `<div class="game-box">
      <div class="game-row"><span class="label">${md(task.week)} 주 과제 · ${esc(task.type)}</span><span class="gname">${esc(task.title)}</span><span class="meta">${esc(task.game)}</span></div>
      <div class="event"><p style="color:var(--ink)">${esc(task.situation)}</p>
      <div class="row" style="margin-top:6px"><a class="btn small" href="${esc(task.file)}" download>엑셀 과제 내려받기</a><span class="sub">상황 · 데이터 · 문제 · 보고서 틀 · 힌트가 들어 있어요</span></div></div>
    </div>
    ${(task.questions || []).map((q, i) => q.kind === 'number' ? `<div class="excelq">
        <label for="ex-${esc(q.id)}"><b class="disp">Q${i + 1}.</b> ${esc(q.text)}</label>
        <input type="text" id="ex-${esc(q.id)}" data-bind="excel:${esc(q.id)}" value="${esc(ex.answers?.[q.id] || '')}" placeholder="답 (${esc(q.unit || '숫자')})" ${ed ? '' : 'readonly'}>
        ${ex.correct?.[q.id] === true ? '<span class="res ok">✓ 정답이에요</span>' : ex.correct?.[q.id] === false ? '<span class="res no">✗ 다시 확인해 보세요</span>' : ''}
      </div>` : `<label class="field"><span><b class="disp" style="color:var(--ink)">Q${i + 1}.</b> ${esc(q.text)}</span>
        <textarea id="ex-reason" data-bind="excel:reason" rows="4" ${ed ? '' : 'readonly'}>${esc(ex.reason || '')}</textarea></label>`).join('')}
    <label class="field"><span>보고서 (요약 / 주요 수치 / 원인 추정과 근거 / 제안)</span><textarea id="ex-report" data-bind="excel:report" rows="5" ${ed ? '' : 'readonly'}>${esc(ex.report || '')}</textarea></label>
    ${ed ? '<div class="row"><button class="btn small" type="button" data-act="excel-check">숫자 정답 확인</button><span class="sub">저장하면 정답과 숨은 원인이 공개돼요.</span></div>' : ''}
    ${reveal ? `<div class="banner info"><b class="disp">정답과 숨은 원인</b><br>${Object.entries(reveal.answers || {}).map(([k, v]) => `${esc(k.toUpperCase())}: ${esc(v)}`).join(' · ')}<br>${esc(reveal.cause || '')}${(reveal.evidence || []).length ? `<br><span class="sub">근거: ${reveal.evidence.map(esc).join(' / ')}</span>` : ''}</div>` : ''}
    ${S.feedback[date]?.excel ? aiBlock(S.feedback[date].excel, 'act') : ''}`;
}

// ───────── 미션 ─────────
function viewMissions() {
  const f = S.ui.mfilter;
  const usedGames = [...new Set(sortedDates().map((d) => S.records[d].activity?.game).filter(Boolean))].map(gameById).filter(Boolean);
  const filt = (e) => f === 'all' || e.rec.activity?.game === f;
  const form = S.ui.mform;
  const card = (m) => {
    const ents = missionEntries(m), shown = ents.filter(filt), open = S.ui.mopen === m.id;
    const pct = Math.min(100, Math.round((ents.length / Number(m.target || 1)) * 100));
    return `<section class="card">
      <div class="card-head"><h2>${esc(m.name)}</h2>${dday(m.deadline)}</div>
      <div class="bar"><span style="width:${pct}%"></span></div>
      <div class="m-foot"><span class="num">${ents.length}/${m.target} ${esc(m.unit || '')}</span><span>${m.menu ? '연결 메뉴: ' + esc(menuById(m.menu)?.name || m.menu) : '직접 체크'}${m.deadline ? ' · 마감 ' + md(m.deadline) : ''}</span></div>
      <div class="row">
        <button class="btn small" type="button" data-act="mopen" data-id="${esc(m.id)}">${open ? '결과물 접기' : `결과물 보기 (${shown.length})`}</button>
        <span class="spacer"></span>
        <button class="btn small ghost edit-only" type="button" data-act="m-edit" data-id="${esc(m.id)}">수정</button>
        <button class="btn small ghost danger edit-only" type="button" data-act="m-del" data-id="${esc(m.id)}">삭제</button>
      </div>
      ${open ? outputsHtml(m, shown) : ''}
    </section>`;
  };
  const act = S.missions.filter((m) => !missionDone(m)), fin = S.missions.filter(missionDone);
  return `
  <div class="card-head"><h2 style="font-size:22px">메인 미션</h2><button class="btn small primary edit-only" type="button" data-act="m-new">새 미션</button></div>
  <div class="menu" role="group" aria-label="게임별 보기"><button type="button" data-act="mfilter" data-id="all" aria-pressed="${f === 'all'}">전체</button>
    ${usedGames.map((g) => `<button type="button" data-act="mfilter" data-id="${esc(g.id)}" aria-pressed="${f === g.id}">${esc(g.name)}</button>`).join('')}</div>
  ${form ? missionForm(form) : ''}
  ${act.length ? act.map(card).join('') : '<div class="empty">진행 중인 미션이 없어요. [새 미션]으로 등록해요.</div>'}
  ${fin.length ? `<h2 style="font-size:19px">완료한 미션</h2>${fin.map(card).join('')}` : ''}`;
}
function outputsHtml(m, ents) {
  if (!ents.length) return '<p class="sub">아직 결과물이 없어요.</p>';
  const latest = ents[ents.length - 1].date;
  const keyOf = (e) => `m:${m.id}:${e.date}`;
  let cmpHtml = '';
  if (S.ui.mcmpShow?.id === m.id) {
    const [a, b] = S.ui.mcmpShow.keys.map((k) => ents.find((e) => keyOf(e) === k)).filter(Boolean);
    if (a && b) cmpHtml = `<div class="compare">${[a, b].map((e) => `<div class="col"><b class="disp">${md(e.date)} · ${esc(gameById(e.rec.activity?.game)?.name || '')}</b>
      <p class="written">${esc(e.note ?? outputText(e.rec))}</p>${aiBlock(S.feedback[e.date]?.activity, 'act')}</div>`).join('')}</div>
      <button class="btn small" type="button" data-act="mcmp-close">비교 닫기</button>`;
  }
  return `<div class="row"><button class="btn small" type="button" data-act="mcmp-go" data-id="${esc(m.id)}" ${ents.length < 2 ? 'disabled' : ''}>⇄ 비교하기</button>
      <span class="sub">${S.ui.mcmp.length === 2 ? '고른 두 개를 비교해요' : '체크하지 않으면 첫 결과물과 최근 결과물을 비교해요'}</span></div>
    ${cmpHtml}
    <div>${[...ents].reverse().map((e) => {
      const k = keyOf(e), open = S.ui.open[k] ?? e.date === latest;
      return `<div class="acc ${open ? 'open' : ''}">
        <div class="acc-head" role="button" tabindex="0" data-act="acc" data-key="${esc(k)}">
          <input type="checkbox" data-act="mcmp-pick" data-key="${esc(k)}" ${S.ui.mcmp.includes(k) ? 'checked' : ''} aria-label="비교할 결과물로 고르기">
          <span class="num">${md(e.date)}</span><span class="peek">${esc(gameById(e.rec.activity?.game)?.name || '')} · ${esc((e.note ?? outputText(e.rec)).split('\n')[0])}</span><span class="chev">›</span></div>
        ${open ? `<div class="acc-body"><span class="mine">✍️ 내 결과물</span><p class="written">${esc(e.note ?? outputText(e.rec))}</p>${m.menu ? aiBlock(S.feedback[e.date]?.activity || S.feedback[e.date]?.excel, 'act') : ''}</div>` : ''}
      </div>`;
    }).join('')}</div>`;
}
function outputText(rec) {
  const a = rec.activity || {};
  const m = menuById(a.menu);
  if (a.menu === 'excel') return [`엑셀 과제 ${a.excel?.week || ''}`, ...Object.entries(a.excel?.answers || {}).map(([k, v]) => `${k.toUpperCase()}: ${v}`), a.excel?.reason ? '추론: ' + a.excel.reason : '', a.excel?.report ? '보고서: ' + a.excel.report : ''].filter(Boolean).join('\n');
  const fields = (m?.fields || []).map((f) => (a.fields?.[f.id] ? `${f.label}: ${(m.prefix && f.id === 'title' ? m.prefix : '')}${a.fields[f.id]}` : '')).filter(Boolean);
  return [...fields, a.body || ''].join('\n');
}
function missionForm(f) {
  return `<section class="card edit-only"><div class="card-head"><h2>${f.id ? '미션 수정' : '새 미션'}</h2></div>
    <div class="form-grid">
      <label class="field"><span>이름</span><input type="text" id="mf-name" data-bind="mf:name" value="${esc(f.name || '')}" placeholder="예: 가상 게임 운영 보고서 작성"></label>
      <label class="field"><span>연결 메뉴 (고르면 그 활동을 할 때 자동 +1)</span><select id="mf-menu" data-bind="mf:menu"><option value="">없음 (오늘 탭에서 직접 체크)</option>${menus().map((m) => `<option value="${esc(m.id)}" ${f.menu === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></label>
      <label class="field"><span>목표 횟수</span><input type="number" min="1" id="mf-target" data-bind="mf:target" value="${esc(f.target || 1)}"></label>
      <label class="field"><span>단위</span><input type="text" id="mf-unit" data-bind="mf:unit" value="${esc(f.unit || '개')}"></label>
      <label class="field"><span>마감일 (선택)</span><input type="date" id="mf-deadline" data-bind="mf:deadline" value="${esc(f.deadline || '')}"></label>
    </div>
    <div class="row"><button class="btn primary" type="button" data-act="m-save" ${S.busy ? 'disabled' : ''}>저장</button><button class="btn ghost" type="button" data-act="m-cancel">취소</button></div></section>`;
}

// ───────── 기록 ─────────
function csEntries(qid) {
  return sortedDates().filter((d) => (S.records[d].cs?.answers?.[qid] || '').trim())
    .map((d) => ({ date: d, text: S.records[d].cs.answers[qid], fb: S.feedback[d]?.cs?.[qid], rec: S.records[d] }));
}
function viewRecords() {
  const head = `<div class="seg" role="group" aria-label="기록 보기">
      <button type="button" data-act="rview" data-id="cs" aria-pressed="${S.ui.rview === 'cs'}">CS 성장 기록</button>
      <button type="button" data-act="rview" data-id="date" aria-pressed="${S.ui.rview === 'date'}">날짜별 기록</button></div>`;
  if (S.ui.rview === 'date') return head + dateView();
  if (S.ui.qopen) return head + qDetail(S.ui.qopen);
  const sets = mixedSets();
  const cur = setFor(S.today);
  const set = sets.find((s) => s.id === S.ui.rset) || cur;
  if (!set) return head + '<div class="empty">문의 세트가 없어요.</div>';
  const todayIds = inquiriesFor(S.today).map((q) => q.id);
  const cards = [];
  for (let day = 1; day <= 7; day++) {
    const g = (S.pack.fictionalGames || []).find((x) => x.day === day);
    for (const q of set.inquiries?.[String(day)] || []) {
      const ents = csEntries(q.id), scored = ents.filter((e) => typeof e.fb?.score === 'number');
      const first = scored[0]?.fb.score, last = scored[scored.length - 1]?.fb.score;
      cards.push(`<button class="qcard ${set.id === cur?.id && todayIds.includes(q.id) ? 'today' : ''}" type="button" data-act="qopen" data-qid="${esc(q.id)}">
        <span class="row"><span class="tag">${esc(q.type)}</span><span class="tag sky">${esc(levelOf(q.id))}</span><span class="sub">${wdName(day)} · ${esc(g?.name || '')}</span></span>
        <span class="qt">${esc(q.text)}</span>
        <span class="qm"><span>${ents.length}회 답변</span><span class="num">${scored.length ? `${first} → ${last}` : '채점 전'} ${scored.length > 1 ? (last > first ? '<span class="trend up">📈</span>' : '─') : ''}</span></span></button>`);
    }
  }
  return `${head}
    <div class="row"><label class="sub" for="rset">세트</label><select id="rset" style="width:auto" data-act-change="rset">${sets.map((s) => `<option value="${esc(s.id)}" ${s.id === set.id ? 'selected' : ''}>${esc(s.name)}${s.id === cur?.id ? ' (이번 달)' : ''}</option>`).join('')}</select>
      <span class="sub">${esc(set.theme || '')}</span></div>
    <div class="qcards">${cards.join('')}</div>`;
}
function qDetail(qid) {
  const info = findInquiry(qid);
  if (!info) { S.ui.qopen = null; return ''; }
  const { q, set, game } = info;
  const ents = csEntries(qid);
  const keyOf = (e) => `q:${qid}:${e.date}`;
  const latest = ents[ents.length - 1]?.date;
  let cmp = '';
  if (S.ui.cmpShow) {
    const [a, b] = S.ui.cmpShow.map((k) => ents.find((e) => keyOf(e) === k)).filter(Boolean);
    if (a && b) cmp = `<div class="compare">${[a, b].map((e, i) => `<div class="col">
        <b class="disp">${md(e.date)} ${i === 0 ? '(이전)' : '(최근)'}</b><div>${scoreBar(e.fb?.score)}</div>
        ${checksHtml(e.fb, i === 1 ? a.fb : null)}
        <p class="written">${esc(e.text)}</p>${e.fb?.comment ? `<p class="ai"><span class="pill">🤖 AI 코치</span><span>${esc(e.fb.comment)}</span></p>` : ''}</div>`).join('')}</div>
      <div class="row"><button class="btn small" type="button" data-act="cmp-close">비교 닫기</button><span class="sub">오른쪽에서 초록색 항목이 새로 생긴 점이에요.</span></div>`;
  }
  return `<div class="row"><button class="btn small ghost" type="button" data-act="qback">← 문의 카드</button></div>
    <section class="card">
      <div class="q-top"><span class="tag">${esc(q.type)}</span><span class="tag sky">${esc(levelOf(qid))}</span><span class="sub">${wdName(game?.day ?? 0)}요일 · ${esc(game?.name || '')}</span></div>
      <p class="inquiry">${esc(q.text)}</p>
      <dl class="facts">${(q.facts || []).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      <div class="row"><button class="btn small" type="button" data-act="cmp-go" data-qid="${esc(qid)}" ${ents.length < 2 ? 'disabled' : ''}>⇄ 비교하기</button>
        <span class="sub">${S.ui.cmp.length === 2 ? '고른 두 답변을 비교해요' : '체크하지 않으면 첫 답변과 최근 답변을 비교해요'}</span></div>
      ${cmp}
      ${ents.length ? [...ents].reverse().map((e, i) => {
        const k = keyOf(e), open = S.ui.open[k] ?? e.date === latest;
        const rk = e.date + '|' + qid, rv = S.ui.refl[rk] ?? e.rec.reflect?.[qid] ?? '';
        return `<div class="acc ${open ? 'open' : ''}">
          <div class="acc-head" role="button" tabindex="0" data-act="acc" data-key="${esc(k)}">
            <input type="checkbox" data-act="cmp-pick" data-key="${esc(k)}" ${S.ui.cmp.includes(k) ? 'checked' : ''} aria-label="비교할 답변으로 고르기">
            <span class="num">${ents.length - i}주차 ${md(e.date)}</span><span class="peek">${scoreBar(e.fb?.score)} ${esc(e.text.split('\n')[0])}</span><span class="chev">›</span></div>
          ${open ? `<div class="acc-body"><span class="mine">✍️ 내 답변${e.rec.late ? ' · ⏱ 늦은 기록' : ''}${isPractice(e.date) ? ' · 연습' : ''}</span><p class="written">${esc(e.text)}</p>
            ${aiBlock(e.fb)}
            ${e.fb ? `<label class="field"><span>💭 다음엔 이렇게 (선택)</span>
              <div class="row"><input type="text" style="flex:1 1 220px" data-bind="refl:${esc(rk)}" value="${esc(rv)}" placeholder="피드백을 보고 다음에 바꿀 점" ${isNarrow() ? 'readonly' : ''}>
              <button class="btn small edit-only" type="button" data-act="refl-save" data-date="${e.date}" data-qid="${esc(qid)}">저장</button></div></label>` : ''}</div>` : ''}
        </div>`;
      }).join('') : '<div class="empty">아직 이 문의에 쓴 답변이 없어요.</div>'}
    </section>`;
}
function dateView() {
  const dates = sortedDates().reverse();
  if (!dates.length) return '<div class="empty">아직 저장한 기록이 없어요.</div>';
  return `<div>${dates.map((d, i) => {
    const r = S.records[d], k = 'd:' + d, open = S.ui.open[k] ?? i === 0, l = dayLevel(d);
    const qs = inquiriesFor(d).filter((q) => (r.cs?.answers?.[q.id] || '').trim());
    return `<div class="acc ${open ? 'open' : ''}" id="rec-${d}">
      <div class="acc-head" role="button" tabindex="0" data-act="acc" data-key="${esc(k)}">
        <span class="num">${md(d)} ${WD[pd(d).getUTCDay()]}</span><span class="tag sky num">${l.done}/${l.total}</span>
        <span class="peek">${r.busy ? '바쁜 날 · ' : ''}${r.late ? '⏱ 늦은 기록 · ' : ''}${isPractice(d) ? '연습 · ' : ''}${esc(menuById(r.activity?.menu)?.name || '')}${r.memo ? ' · ' + esc(r.memo) : ''}</span><span class="chev">›</span></div>
      ${open ? `<div class="acc-body">
        <div class="checks">${S.settings.dailyItems.map((it) => `<span class="${itemDone(it, r, d) ? 'on' : ''}">${itemDone(it, r, d) ? '✓' : '·'} ${esc(it.name)}</span>`).join('')}</div>
        ${qs.map((q) => `<div class="stack" style="gap:4px"><span class="sub"><span class="tag">${esc(q.type)}</span> ${esc(q.text)}</span>
          <p class="written">${esc(r.cs.answers[q.id])}</p>
          <div class="row"><span>${S.feedback[d]?.cs?.[q.id] ? scoreBar(S.feedback[d].cs[q.id].score) : '<span class="sub">채점 대기</span>'}</span>
          <button class="linkbtn" data-act="goq" data-qid="${esc(q.id)}">성장 기록 보기 →</button></div></div>`).join('')}
        ${activityDone(r) ? `<div class="stack" style="gap:4px"><b class="disp">${esc(menuById(r.activity.menu)?.name || '')} · ${esc(gameById(r.activity.game)?.name || '')}</b><p class="written">${esc(outputText(r))}</p>${aiBlock(S.feedback[d]?.activity || S.feedback[d]?.excel, 'act')}</div>` : ''}
        ${r.memo ? `<p class="sub">메모: ${esc(r.memo)}</p>` : ''}
      </div>` : ''}</div>`;
  }).join('')}</div>`;
}

// ───────── 통계 ─────────
function bigNums() {
  const wk = weeklyCsAvg();
  const rate = monthRate();
  return `<div class="bignums">
    <div class="bignum"><span class="label">연속 기록</span><b>${currentStreak()}일</b><span class="sub">일일 항목을 모두 끝낸 날</span></div>
    <div class="bignum"><span class="label">이번 달 달성률</span><b>${rate == null ? '–' : rate + '%'}</b><span class="sub">일일 항목 기준</span></div>
    <div class="bignum"><span class="label">CS 평균 점수</span><b>${wk.length ? `${wk[0].avg.toFixed(1)} → ${wk[wk.length - 1].avg.toFixed(1)}` : '–'}</b><span class="sub">${wk.length ? '첫 주 → 최근 주' : '첫 채점 뒤에 보여요'}</span></div>
  </div>`;
}
function grassHtml(weeks = 16) {
  const endMon = mondayOf(S.today);
  let from = addDays(endMon, -7 * (weeks - 1));
  const cells = [];
  for (let d = from; d <= addDays(endMon, 6); d = addDays(d, 1)) {
    if (d > S.today) { cells.push('<span class="cell pad"></span>'); continue; }
    if (d < start()) { cells.push(`<span class="cell pre" title="${md(d)} 시작 전"></span>`); continue; }
    const l = dayLevel(d);
    const lv = l.done === 0 ? '' : l.light ? 'lt' : l.done === l.total ? 'l4' : 'l' + Math.max(1, Math.min(3, Math.ceil((l.done / l.total) * 3)));
    cells.push(`<button class="cell ${lv}" type="button" data-act="grass" data-date="${d}" title="${md(d)} · ${l.done}/${l.total}" aria-label="${md(d)} ${l.done}/${l.total} 완료"></button>`);
  }
  return `<div class="grass-wrap"><div class="grass">${cells.join('')}</div></div>
    <div class="legend"><span><i style="background:var(--g4)"></i>모두 함</span><span><i style="background:var(--g2)"></i>일부</span><span><i style="background:var(--glight)"></i>바쁜 날</span><span><i style="background:var(--g0)"></i>안 함</span><span>칸을 누르면 그날 기록으로 가요</span></div>`;
}
function chartHtml() {
  const wk = weeklyCsAvg();
  if (!wk.length) return '<div class="empty">첫 일요일 채점이 끝나면 점수 추이가 그려져요.</div>';
  const W = 880, H = 220, L = 30, R = 16, T = 14, B = 28;
  const x = (i) => L + (wk.length === 1 ? (W - L - R) / 2 : (i * (W - L - R)) / (wk.length - 1));
  const y = (v) => T + ((5 - v) * (H - T - B)) / 5;
  const pts = wk.map((w, i) => `${x(i).toFixed(1)},${y(w.avg).toFixed(1)}`).join(' ');
  return `<div class="chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="주별 CS 평균 점수">
    ${[0, 1, 2, 3, 4, 5].map((v) => `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)" stroke-width="1"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
    <polyline points="${pts}" fill="none" stroke="var(--sky-deep)" stroke-width="2.2" stroke-linejoin="round"/>
    ${wk.map((w, i) => `<circle cx="${x(i)}" cy="${y(w.avg)}" r="${i === wk.length - 1 ? 5 : 3.5}" fill="${i === wk.length - 1 ? 'var(--blush)' : 'var(--sky-deep)'}" stroke="var(--surface)" stroke-width="1.5"/>
      <text x="${x(i)}" y="${H - 8}" text-anchor="middle">${md(w.week)}</text>`).join('')}
  </svg></div>`;
}
function viewStats() {
  const items = S.settings.dailyItems.map((it) => ({ it, ...itemStreaks(it) }));
  const top = items.reduce((a, b) => (b.cur > (a?.cur ?? -1) ? b : a), null);
  const rot = rotationList();
  const counts = Object.fromEntries(rot.map((g) => [g.id, 0]));
  for (const d of sortedDates()) { const r = S.records[d]; if (!isPractice(d) && activityDone(r) && r.activity.game in counts) counts[r.activity.game]++; }
  const usedN = Object.values(counts).filter((n) => n > 0).length;
  const maxC = Math.max(1, ...Object.values(counts));
  // 엑셀 정답률
  const byType = {};
  let ok = 0, all = 0;
  for (const d of sortedDates()) {
    const ex = S.records[d].activity?.excel;
    if (!ex?.correct || isPractice(d)) continue;
    const type = (S.excelIndex.weeks || []).find((w) => w.week === ex.week)?.type || '기타';
    for (const v of Object.values(ex.correct)) { all++; if (v) ok++; (byType[type] ||= [0, 0])[1]++; if (v) byType[type][0]++; }
  }
  const mini = (key, title, head, body) => `<div class="mini"><span class="label">${title}</span><b>${head}</b>
    <button class="linkbtn" type="button" data-act="mini" data-id="${key}" aria-expanded="${!!S.ui.mini[key]}">${S.ui.mini[key] ? '접기 ▴' : '펼치기 ▾'}</button>${S.ui.mini[key] ? body : ''}</div>`;
  const hbar = (lbl, n, max, txt) => `<div class="hbar"><span class="lbl">${esc(lbl)}</span><span class="t"><span style="width:${Math.round((n / max) * 100)}%"></span></span><span class="n num">${txt ?? n}</span></div>`;
  return `${bigNums()}
  <section class="card"><div class="card-head"><h2>잔디</h2><span class="sub">최근 16주</span></div>${grassHtml()}</section>
  <section class="card"><div class="card-head"><h2>CS 점수 추이</h2><span class="sub">주별 AI 코치 평균 (5점 만점)</span></div>${chartHtml()}</section>
  <div class="minis">
    ${mini('streak', '항목별 연속일', top && top.cur ? `${esc(top.it.name)} ${top.cur}일` : '–', items.map((x) => hbar(x.it.name, x.cur, Math.max(1, ...items.map((y) => y.best)), `${x.cur}/${x.best}`)).join('') + '<span class="sub">지금 연속 / 최고 기록</span>')}
    ${mini('games', '게임별 활동', `${rot.length}개 중 ${usedN}개`, rot.map((g) => hbar(g.name, counts[g.id], maxC)).join(''))}
    ${mini('excel', '엑셀 정답률', all ? Math.round((ok / all) * 100) + '%' : '–', Object.keys(byType).length ? Object.entries(byType).map(([t, [o, n]]) => hbar(t, o, n, Math.round((o / n) * 100) + '%')).join('') : '<span class="sub">아직 푼 과제가 없어요</span>')}
  </div>`;
}

// ───────── 설정 ─────────
function viewSettings() {
  const f = S.form ||= clone(S.settings);
  if (!f.gameRotation?.length) f.gameRotation = allGames().map((g) => g.id);
  const gName = (id) => [...S.realGames, ...(f.extraGames || [])].find((g) => g.id === id);
  const { owner, repo } = repoInfo();
  return `
  <section class="card"><div class="card-head"><h2>기본 정보</h2></div>
    <div class="form-grid">
      <label class="field"><span>보드 제목</span><input type="text" id="s-title" data-bind="set:title" value="${esc(f.title)}"></label>
      <label class="field"><span>챌린지 시작일 (월요일 추천)</span><input type="date" id="s-start" data-bind="set:startDate" value="${esc(f.startDate)}"></label>
      <label class="field" style="grid-column:1/-1"><span>한 줄 소개</span><input type="text" id="s-sub" data-bind="set:subtitle" value="${esc(f.subtitle)}"></label>
      <label class="field"><span>바쁜 날 모드 (한 주에 쓸 수 있는 횟수)</span><input type="number" min="0" max="7" id="s-busy" data-bind="set:busyLimitPerWeek" value="${esc(f.busyLimitPerWeek ?? 2)}"></label>
      <label class="field"><span>직무 팩</span><input type="text" value="${esc(S.pack?.name || f.pack)} (packs/${esc(f.pack)})" readonly></label>
    </div>
    <p class="sub">시작일을 바꾸면 게임 로테이션, 문의 세트, 연습 기간, 통계가 그 날짜 기준으로 다시 계산돼요.</p></section>

  <section class="card"><div class="card-head"><h2>일일 항목</h2><button class="btn small edit-only" type="button" data-act="item-add">항목 추가</button></div>
    <div class="list-edit">${f.dailyItems.map((it, i) => `<div class="li">
      <input type="text" data-bind="item:${i}:name" value="${esc(it.name)}" aria-label="항목 이름" ${it.type === 'job' ? 'readonly' : ''}>
      <input type="text" data-bind="item:${i}:note" value="${esc(it.note || '')}" aria-label="설명" placeholder="설명 (선택)">
      ${it.type === 'job' ? '<span class="sub">고정</span>' : `<button class="btn small ghost danger edit-only" type="button" data-act="item-del" data-i="${i}">삭제</button>`}</div>`).join('')}</div></section>

  <section class="card"><div class="card-head"><h2>게임 목록 · 로테이션 순서</h2><span class="sub">매주 월요일 다음 게임으로 바뀌어요</span></div>
    <div class="list-edit">${f.gameRotation.map((id, i) => { const g = gName(id); return g ? `<div class="li g"><span class="num sub">${i + 1}</span>
      <span>${esc(g.name)} <span class="sub">${esc(g.genre || '')} · ${esc(g.platform || '')}</span></span>
      <span class="row edit-only"><button class="btn small ghost" type="button" data-act="game-up" data-i="${i}" aria-label="위로">↑</button><button class="btn small ghost" type="button" data-act="game-down" data-i="${i}" aria-label="아래로">↓</button><button class="btn small ghost danger" type="button" data-act="game-del" data-i="${i}">빼기</button></span></div>` : ''; }).join('')}</div>
    ${S.realGames.filter((g) => !f.gameRotation.includes(g.id)).length ? `<div class="row edit-only"><span class="sub">뺀 게임 다시 넣기:</span>${S.realGames.filter((g) => !f.gameRotation.includes(g.id)).map((g) => `<button class="btn small ghost" type="button" data-act="game-readd" data-id="${esc(g.id)}">${esc(g.name)}</button>`).join('')}</div>` : ''}
    <div class="form-grid edit-only">
      <label class="field"><span>게임 추가 (가고 싶은 회사의 게임 등)</span><input type="text" id="ng-name" placeholder="게임 이름"></label>
      <label class="field"><span>장르 · 플랫폼</span><input type="text" id="ng-genre" placeholder="예: MMORPG · PC"></label>
    </div>
    <div class="row edit-only"><button class="btn small" type="button" data-act="game-add">게임 추가</button></div></section>

  <div class="savebar edit-only"><p>설정은 저장소의 data/settings.json에 저장돼요.</p>
    <div class="row"><button class="btn ghost" type="button" data-act="settings-reset">되돌리기</button><button class="btn primary" type="button" data-act="settings-save" ${S.busy ? 'disabled' : ''}>설정 저장</button></div></div>

  <section class="card"><div class="card-head"><h2>보드 열쇠</h2><span class="sub">${S.token ? '연결됨' : '연결 안 됨'}</span></div>
    <p>보드 열쇠는 <b>이 저장소(${esc(owner)}/${esc(repo)})에만 쓸 수 있는 GitHub 토큰</b>이에요. 비밀번호와 달리 다른 저장소나 계정 설정에는 손댈 수 없어요.</p>
    <ol class="sub" style="margin:0;padding-left:18px">
      <li>GitHub → Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate new token</li>
      <li>Repository access: <b>Only select repositories</b> → ${esc(repo)}</li>
      <li>Permissions → Repository permissions → <b>Contents: Read and write</b> (나머지는 그대로)</li>
      <li>만료일을 정하고 만든 뒤, 열쇠를 <b>잠금 있는 휴대폰 메모</b>에 보관해요. 이 컴퓨터에 파일로 저장하지 않아요.</li>
    </ol>
    <div class="row edit-only">${S.token ? '<button class="btn small" type="button" data-act="lock">잠그기 (이 컴퓨터에서 지우기)</button>' : '<button class="btn small" type="button" data-act="key-open">열쇠 넣기</button>'}</div></section>

  <section class="card edit-only"><div class="card-head"><h2>내 폴더</h2><span class="sub">${S.dir ? '연결됨' : '연결 안 됨'}</span></div>
    <p class="sub">집 PC의 Chrome·Edge에서 폴더를 연결하면 저장할 때 그 폴더에도 같은 파일이 생겨요. 공용 컴퓨터에서는 연결하지 마세요.</p>
    <div class="row">
      <button class="btn small" type="button" data-act="folder-connect">${S.dir ? '다른 폴더로 바꾸기' : '📁 폴더 연결'}</button>
      <button class="btn small" type="button" data-act="folder-import" ${S.dir ? '' : 'disabled'}>가져오기 (저장소 전체 받기)</button>
      ${S.dir ? '<button class="btn small ghost danger" type="button" data-act="folder-forget">연결 끊기</button>' : ''}
    </div></section>

  <section class="card"><div class="card-head"><h2>다른 사람과 함께 쓰기</h2></div>
    <p class="sub">이 저장소는 GitHub 템플릿이에요. 다른 사람은 저장소에서 [Use this template]을 눌러 기록 없이 빈 보드를 복사하고, 이 설정 화면에서 시작일과 항목을 바꿔 쓸 수 있어요. 자세한 방법은 <a href="https://github.com/${esc(owner)}/${esc(repo)}/blob/main/docs/README.md" target="_blank" rel="noopener">docs/README.md</a>에 있어요.</p></section>`;
}

// ───────── 사용법 ─────────
const GUIDE = {
  today: { name: '오늘', blocks: [
    ['head', '머리 영역', '연속 기록 · 열쇠 · 잠그기', 'span3', '연속 기록은 일일 항목을 모두 끝낸 날이 며칠째 이어지는지예요. 저장하려면 PC에서 [열쇠 넣기]로 보드 열쇠를 붙여 넣어요. 공용 컴퓨터에서는 다 쓴 뒤 꼭 [잠그기]를 눌러요.'],
    ['daily', '일일 항목', '날짜 고르기 · 체크', 'span3', '눌러서 체크해요. 직무능력준비는 CS 3개와 활동 1개를 모두 하면 자동으로 완료돼요. 새 기록은 오늘과 어제만 쓸 수 있고, 어제 기록은 "늦은 기록"으로 표시돼요.'],
    ['cs', '오늘의 CS 문의', '가상 게임 · 이벤트 · 지난 답변', 'span2', '요일마다 가상 게임 하나의 문의 3개가 와요. 이벤트 칸과 상황 정보를 읽고 답변을 써요. 아래에는 지난주 같은 문의에 쓴 내 답변과 AI 코치 피드백이 보여요.'],
    ['side', '이번 주 게임 · 메인 미션', '오른쪽 칸', '', '오늘의 활동에 쓰는 실제 게임은 매주 월요일 바뀌어요. 미션은 마감이 가까운 순서로 보여요.'],
    ['activity', '오늘의 활동 · 바쁜 날 모드', '메뉴 4개 중 하나', 'span2', '패치노트 분석, 커뮤니티 보고서, 공지 작성, 엑셀·데이터 중 하나를 골라 써요. 연결된 미션이 자동으로 +1 돼요. 바쁜 날 모드를 켜면 CS 1개만 해도 가볍게 완료로 인정돼요 (한 주 2번까지).'],
    ['save', '저장', '맨 아래', '', '[기록 저장]을 누르면 GitHub에 바로 기록돼요. 같은 날 기록은 그 주 일요일 채점 전까지 다시 저장해서 고칠 수 있어요.'],
  ] },
  missions: { name: '미션', blocks: [
    ['filter', '게임별 보기', '맨 위 버튼', 'span3', '게임을 고르면 그 게임으로 한 결과물만 모여요. 게임별 포트폴리오로 쓸 수 있어요.'],
    ['list', '미션 목록', '진행 막대 · D-day', 'span2', '목표까지 얼마나 했는지와 마감까지 남은 날이 보여요. 목표에 도달하면 "완료한 미션"으로 내려가요.'],
    ['new', '새 미션', '수정 · 삭제', '', '이름, 목표 횟수, 마감일, 연결 메뉴를 정해 등록해요. 연결 메뉴가 없는 미션은 오늘 탭의 "미션 진행"에서 직접 체크해요.'],
    ['outputs', '미션 결과물', '날짜순으로 접힘', 'span2', '[결과물 보기]를 누르면 그 미션으로 쓴 글이 날짜순으로 나와요. 줄을 누르면 펼쳐지고 다시 누르면 접혀요.'],
    ['compare', '비교하기', '두 개 나란히', '', '결과물 두 개를 체크하고 [비교하기]를 누르면 나란히 보여요. 체크하지 않으면 첫 결과물과 최근 결과물을 비교해요.'],
  ] },
  records: { name: '기록', blocks: [
    ['switch', 'CS 성장 기록 · 날짜별 기록', '위쪽 버튼', 'span3', '두 보기를 오가요. CS 성장 기록은 같은 문의에 대한 답변을, 날짜별 기록은 그날 한 일 전체를 보여 줘요.'],
    ['sets', '세트 고르기', '매달 1일 바뀜', '', '문의 세트는 매달 바뀌어요. 지난 세트의 답변도 여기서 다시 볼 수 있어요.'],
    ['cards', '문의 카드 21개', '첫 점수 → 최근 점수', 'span2', '카드에는 문의 유형, 답변 횟수, 첫 점수 → 최근 점수가 있어요. 오늘 문의 카드는 분홍 테두리예요.'],
    ['weeks', '주차별 답변', '카드를 누르면', 'span2', '같은 문의에 쓴 답변이 주차별로 쌓여 있어요. 최근 답변만 펼쳐져 있고, 피드백 아래에 "다음엔 이렇게"를 남길 수 있어요.'],
    ['compare', '비교하기', '두 답변 나란히', '', '첫 답변과 최근 답변이 나란히 보여요. 체크박스로 다른 두 개를 고를 수도 있어요. 새로 갖춘 채점 항목은 초록색이에요.'],
  ] },
  stats: { name: '통계', blocks: [
    ['big', '큰 숫자 3개', '연속 기록 · 달성률 · CS 점수', 'span3', '연속 기록, 이번 달 달성률, CS 평균 점수 변화(첫 주 → 최근 주)예요.'],
    ['grass', '잔디', '하루 한 칸', 'span2', '색이 진할수록 일일 항목을 많이 한 날이에요. 분홍 칸은 바쁜 날 모드로 가볍게 완료한 날이에요. 칸을 누르면 그날 기록으로 가요.'],
    ['chart', 'CS 점수 추이', '주별 평균', '', '매주 일요일 23:50 AI 코치 채점이 끝나면 점이 하나씩 생겨요.'],
    ['minis', '작은 카드 3개', '항목별 연속일 · 게임별 활동 · 엑셀 정답률', 'span3', '핵심 숫자가 보이고, [펼치기]를 누르면 자세한 막대그래프가 나와요.'],
  ] },
  settings: { name: '설정', blocks: [
    ['basic', '기본 정보', '제목 · 소개 · 시작일', 'span2', '시작일을 바꾸면 게임 로테이션, 문의 세트, 통계가 그 날짜 기준으로 다시 계산돼요.'],
    ['key', '보드 열쇠', '만드는 법', '', '이 저장소에만 쓸 수 있는 GitHub 토큰이에요. 만드는 순서가 화면에 적혀 있어요.'],
    ['items', '일일 항목', '이름 · 설명 · 추가', 'span2', '항목을 바꾸거나 더해요. 직무능력준비는 고정이에요.'],
    ['games', '게임 목록', '순서 · 추가', '', '로테이션 순서를 바꾸거나 가고 싶은 회사의 게임을 추가해요.'],
    ['folder', '내 폴더 · 함께 쓰기', '집 PC에서', 'span3', '폴더를 연결하면 저장할 때 내 컴퓨터에도 파일이 생기고, [가져오기]로 저장소 전체를 받아요. 다른 사람은 템플릿으로 복사해 써요.'],
  ] },
};
function viewGuide() {
  const g = GUIDE[S.ui.gscreen] || GUIDE.today;
  const sel = g.blocks.find((b) => b[0] === S.ui.gblock);
  return `<section class="guide-band">
      <h2>사용법 안내</h2>
      <p>① 설명을 볼 화면을 고르세요. ② 아래 점선 칸은 그 화면의 실제 배치예요. 궁금한 칸을 누르면 바로 아래 파란 상자에 설명이 나와요.</p>
      <div class="menu" role="group" aria-label="설명할 화면">${Object.entries(GUIDE).map(([id, x]) => `<button type="button" data-act="gscreen" data-id="${id}" aria-pressed="${S.ui.gscreen === id}">${x.name} 화면</button>`).join('')}</div>
    </section>
    <div class="gexplain" aria-live="polite">${sel ? `<strong>${esc(g.name)} 화면 · ${esc(sel[1])}</strong><p>${esc(sel[4])}</p><p class="sub">같은 칸을 다시 누르면 닫혀요.</p>` : '<p class="sub">궁금하신 기능을 클릭하세요.</p>'}</div>
    <div class="gmap">${g.blocks.map(([id, label, small, span]) => `<button class="gblock ${span}" type="button" data-act="gblock" data-id="${id}" aria-pressed="${S.ui.gblock === id}">${esc(label)}<small>${esc(small)}</small></button>`).join('')}</div>`;
}

// ───────── 공유용 요약 ─────────
function viewSummary() {
  const days = Math.max(0, diffDays(start(), S.today) + 1);
  return `<section class="summary-hero card">
      <span class="label">공유용 요약</span>
      <h2>${esc(S.settings.title)}</h2>
      <p>${esc(S.settings.subtitle)}</p>
      <p class="sub">${longDate(start())} 시작 · ${days > 0 ? `${days}일째` : '시작 전'} · 답변은 모두 직접 쓰고, 🤖 AI 코치는 매주 피드백만 남겨요.</p>
    </section>
    ${bigNums()}
    <section class="card"><div class="card-head"><h2>꾸준함</h2><span class="sub">최근 16주 잔디</span></div>${grassHtml()}</section>
    <section class="card"><div class="card-head"><h2>성장</h2><span class="sub">주별 CS 평균 점수</span></div>${chartHtml()}</section>
    <section class="card"><div class="card-head"><h2>결과물 바로가기</h2></div>
      <ul class="missions">${S.missions.map((m) => `<li><div class="m-row"><strong>${esc(m.name)}</strong><span class="num sub">${missionEntries(m).length}/${m.target} ${esc(m.unit || '')}</span></div></li>`).join('') || '<li class="sub">아직 미션이 없어요.</li>'}</ul>
      <div class="row"><a class="btn small" href="#missions">미션 결과물 보기</a><a class="btn small" href="#records">CS 성장 기록 보기</a><a class="btn small ghost" href="#guide">사용법</a></div></section>`;
}

// ───────── 그리기 ─────────
const VIEWS = { today: viewToday, missions: viewMissions, records: viewRecords, stats: viewStats, settings: viewSettings, guide: viewGuide, summary: viewSummary };
function render() {
  renderHeader();
  const v = $('#view');
  const y = window.scrollY;
  v.innerHTML = (VIEWS[S.view] || viewToday)();
  window.scrollTo(0, y);
}
function route() {
  const h = location.hash.slice(1);
  const next = VIEWS[h] ? h : 'today';
  if (next !== S.view) { S.ui.cmp = []; S.ui.cmpShow = null; S.ui.mcmp = []; S.ui.mcmpShow = null; if (next === 'settings') S.form = null; }
  S.view = next;
  render();
  if (h && !VIEWS[h]) return;
}
let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
}

// ───────── 입력 ─────────
document.addEventListener('input', (e) => {
  const b = e.target.dataset?.bind;
  if (!b) return;
  const v = e.target.value;
  const [k, ...rest] = b.split(':');
  const d = S.draft;
  switch (k) {
    case 'cs': d.cs.answers[rest[0]] = v; break;
    case 'act':
      if (rest[0] === 'body') d.activity.body = v;
      else if (rest[0] === 'field') d.activity.fields[rest[1]] = v;
      else if (rest[0] === 'game') d.activity.game = v;
      break;
    case 'excel': {
      const ex = d.activity.excel ||= { answers: {}, correct: {} };
      if (rest[0] === 'reason') ex.reason = v;
      else if (rest[0] === 'report') ex.report = v;
      else { ex.answers[rest[0]] = v; delete ex.correct?.[rest[0]]; }
      break;
    }
    case 'memo': d.memo = v; break;
    case 'mm': d.missionManual[rest[0]] = v; break;
    case 'set': S.form[rest[0]] = rest[0] === 'busyLimitPerWeek' ? Number(v) : v; break;
    case 'item': S.form.dailyItems[Number(rest[0])][rest[1]] = v; break;
    case 'mf': S.ui.mform[rest[0]] = rest[0] === 'target' ? Number(v) : v; break;
    case 'refl': S.ui.refl[rest.join(':')] = v; break;
  }
  if (['cs', 'act', 'excel', 'memo', 'mm'].includes(k)) {
    saveDraftSoon();
    if (k === 'cs' || k === 'act') softRefreshToday();
  }
});
// 입력 중에는 전체를 다시 그리지 않고, 일일 항목 상태만 갱신한다
let softTimer = null;
function softRefreshToday() {
  clearTimeout(softTimer);
  softTimer = setTimeout(() => {
    if (S.view !== 'today') return;
    const items = document.querySelectorAll('.daily .daily-item');
    const idx = S.settings.dailyItems.findIndex((it) => it.type === 'job');
    if (idx < 0 || !items[idx]) return;
    const js = jobState(S.draft, S.date || S.today);
    items[idx].className = 'daily-item ' + (js === 'done' ? 'done' : js === 'light' ? 'light' : js === 'half' ? 'half' : '');
    items[idx].querySelector('.box').innerHTML = js === 'done' || js === 'light' ? check : '';
    items[idx].querySelector('.small').innerHTML = js === 'light' ? '가볍게 완료 (바쁜 날)' : `CS <span class="num">${csCount(S.draft, S.date || S.today)}/3</span> · 활동 <span class="num">${activityDone(S.draft) ? 1 : 0}/1</span>`;
  }, 250);
}
document.addEventListener('change', (e) => {
  const a = e.target.dataset?.actChange;
  if (a === 'date' && e.target.value) { S.date = e.target.value; S.draft = null; S.draftDate = null; render(); }
  if (a === 'rset') { S.ui.rset = e.target.value; render(); }
});
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches?.('[role="button"][data-act]')) { e.preventDefault(); e.target.click(); }
  if (e.key === 'Enter' && e.target.id === 'key-input') { e.preventDefault(); $('[data-act="key-save"]')?.click(); }
});

document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const d = S.draft;
  const id = el.dataset.id;
  switch (act) {
    case 'key-open': S.ui.keyOpen = true; render(); setTimeout(() => $('#key-input')?.focus(), 0); break;
    case 'key-close': S.ui.keyOpen = false; render(); break;
    case 'key-save': {
      const v = ($('#key-input')?.value || '').trim();
      if (!v) { toast('보드 열쇠를 붙여 넣어 주세요.'); return; }
      S.token = v;
      try {
        const { owner, repo } = repoInfo();
        await gh(`/repos/${owner}/${repo}`);
        ss.set('cb_token', v); S.ui.keyOpen = false;
        toast('열쇠를 연결했어요. 최신 기록을 불러올게요.');
        await loadAll(); S.draft = null; S.draftDate = null; render();
      } catch (err) { S.token = null; toast('이 열쇠로는 저장소에 들어갈 수 없어요. 열쇠를 다시 확인해 주세요.'); }
      break;
    }
    case 'lock': S.token = null; ss.del('cb_token'); clearDrafts(); toast('잠갔어요. 이 컴퓨터에서 열쇠와 작성 중인 내용을 지웠어요.'); render(); break;
    case 'date': S.date = el.dataset.date; S.draft = null; S.draftDate = null; render(); break;
    case 'daily': if (!canEdit(S.date)) return; d.daily[id] = !d.daily[id]; saveDraftSoon(); render(); break;
    case 'busy': {
      if (!canEdit(S.date)) return;
      const limit = Number(S.settings.busyLimitPerWeek ?? 2);
      if (!d.busy && busyUsed(S.date) >= limit) { e.preventDefault(); toast(`바쁜 날 모드는 한 주에 ${limit}번까지 쓸 수 있어요.`); return; }
      d.busy = !d.busy; saveDraftSoon(); render(); break;
    }
    case 'menu': {
      if (!canEdit(S.date)) return;
      const m = menuById(id);
      d.activity.menu = id;
      if (m?.type === 'excel') { const ent = excelEntry(S.date); d.activity.excel ||= { week: ent?.week || null, answers: {}, correct: {} }; }
      else if (!(d.activity.body || '').trim() || menus().some((x) => (x.template || '').trim() === (d.activity.body || '').trim())) d.activity.body = m?.template || '';
      if (!d.activity.game) d.activity.game = rotationGame(S.date)?.game?.id || '';
      saveDraftSoon(); render(); break;
    }
    case 'excel-check': {
      const ent = excelEntry(S.date), task = ent && S.excelCache[ent.week];
      if (!task) return;
      const ex = d.activity.excel ||= { answers: {}, correct: {} };
      ex.week = ent.week; ex.correct ||= {};
      for (const q of task.questions.filter((x) => x.kind === 'number')) {
        const v = ex.answers?.[q.id];
        if (v == null || !String(v).trim()) { delete ex.correct[q.id]; continue; }
        ex.correct[q.id] = (await sha256(normAnswer(v))) === q.hash;
      }
      saveDraftSoon(); render(); break;
    }
    case 'mm-toggle':
      if (!canEdit(S.date)) return;
      if (Object.prototype.hasOwnProperty.call(d.missionManual, id)) delete d.missionManual[id]; else d.missionManual[id] = '';
      saveDraftSoon(); render(); break;
    case 'draft-clear': ls.del('cb_draft_' + S.date); S.draft = null; S.draftDate = null; render(); break;
    case 'save': await saveToday(); break;
    case 'goq': S.ui.rview = 'cs'; S.ui.qopen = el.dataset.qid; S.ui.cmp = []; S.ui.cmpShow = null; location.hash = 'records'; if (S.view === 'records') render(); window.scrollTo(0, 0); break;
    // 기록
    case 'rview': S.ui.rview = id; S.ui.qopen = null; render(); break;
    case 'qopen': S.ui.qopen = el.dataset.qid; S.ui.cmp = []; S.ui.cmpShow = null; render(); window.scrollTo(0, 0); break;
    case 'qback': S.ui.qopen = null; S.ui.cmpShow = null; render(); break;
    case 'acc': if (e.target.matches('input')) return; S.ui.open[el.dataset.key] = !el.closest('.acc').classList.contains('open'); render(); break;
    case 'cmp-pick': case 'mcmp-pick': {
      e.stopPropagation();
      const list = act === 'cmp-pick' ? S.ui.cmp : S.ui.mcmp;
      const k = el.dataset.key, i = list.indexOf(k);
      if (i >= 0) list.splice(i, 1); else { list.push(k); if (list.length > 2) list.shift(); }
      render(); break;
    }
    case 'cmp-go': {
      const ents = csEntries(el.dataset.qid), keyOf = (x) => `q:${el.dataset.qid}:${x.date}`;
      const keys = S.ui.cmp.length === 2 ? [...S.ui.cmp] : [keyOf(ents[0]), keyOf(ents[ents.length - 1])];
      keys.sort((a, b) => (a.split(':').pop() < b.split(':').pop() ? -1 : 1));
      S.ui.cmpShow = keys; render(); break;
    }
    case 'cmp-close': S.ui.cmpShow = null; render(); break;
    case 'refl-save': await saveReflection(el.dataset.date, el.dataset.qid); break;
    // 미션
    case 'mfilter': S.ui.mfilter = id; render(); break;
    case 'mopen': S.ui.mopen = S.ui.mopen === id ? null : id; S.ui.mcmp = []; S.ui.mcmpShow = null; render(); break;
    case 'mcmp-go': {
      const m = S.missions.find((x) => x.id === id), ents = missionEntries(m).filter((x) => S.ui.mfilter === 'all' || x.rec.activity?.game === S.ui.mfilter);
      const keyOf = (x) => `m:${id}:${x.date}`;
      const keys = S.ui.mcmp.length === 2 ? [...S.ui.mcmp] : [keyOf(ents[0]), keyOf(ents[ents.length - 1])];
      keys.sort((a, b) => (a.split(':').pop() < b.split(':').pop() ? -1 : 1));
      S.ui.mcmpShow = { id, keys }; render(); break;
    }
    case 'mcmp-close': S.ui.mcmpShow = null; render(); break;
    case 'm-new': S.ui.mform = { name: '', target: 1, unit: '개', deadline: '', menu: '' }; render(); window.scrollTo(0, 0); break;
    case 'm-edit': S.ui.mform = clone(S.missions.find((m) => m.id === id)); render(); window.scrollTo(0, 0); break;
    case 'm-cancel': S.ui.mform = null; render(); break;
    case 'm-save': {
      const f = S.ui.mform;
      if (!(f.name || '').trim()) { toast('미션 이름을 적어 주세요.'); return; }
      const list = clone(S.missions);
      const m = { id: f.id || 'm' + Date.now().toString(36), name: f.name.trim(), target: Math.max(1, Number(f.target) || 1), unit: f.unit || '개', deadline: f.deadline || '', menu: f.menu || '', createdAt: f.createdAt || (S.today < start() ? start() : S.today) };
      const i = list.findIndex((x) => x.id === m.id);
      if (i >= 0) list[i] = m; else list.push(m);
      if (await saveJSONFile('data/missions.json', { missions: list }, `미션: ${m.name}`)) { S.missions = list; S.ui.mform = null; render(); }
      break;
    }
    case 'm-del': {
      const m = S.missions.find((x) => x.id === id);
      if (el.dataset.confirm !== 'yes') { el.dataset.confirm = 'yes'; el.textContent = '정말 삭제'; return; }
      const list = S.missions.filter((x) => x.id !== id);
      if (await saveJSONFile('data/missions.json', { missions: list }, `미션 삭제: ${m?.name}`)) { S.missions = list; render(); }
      break;
    }
    // 통계
    case 'mini': S.ui.mini[id] = !S.ui.mini[id]; render(); break;
    case 'grass': S.ui.rview = 'date'; S.ui.qopen = null; S.ui.open['d:' + el.dataset.date] = true; location.hash = 'records'; setTimeout(() => document.getElementById('rec-' + el.dataset.date)?.scrollIntoView({ block: 'center' }), 50); break;
    // 설정
    case 'item-add': S.form.dailyItems.push({ id: 'i' + Date.now().toString(36), name: '새 항목', note: '' }); render(); break;
    case 'item-del': S.form.dailyItems.splice(Number(el.dataset.i), 1); render(); break;
    case 'game-up': case 'game-down': {
      const i = Number(el.dataset.i), j = act === 'game-up' ? i - 1 : i + 1, r = S.form.gameRotation;
      if (j < 0 || j >= r.length) return;
      [r[i], r[j]] = [r[j], r[i]]; render(); break;
    }
    case 'game-del': S.form.gameRotation.splice(Number(el.dataset.i), 1); render(); break;
    case 'game-readd': S.form.gameRotation.push(id); render(); break;
    case 'game-add': {
      const name = ($('#ng-name')?.value || '').trim();
      if (!name) { toast('게임 이름을 적어 주세요.'); return; }
      const [genre = '', platform = ''] = ($('#ng-genre')?.value || '').split('·').map((s) => s.trim());
      const g = { id: 'g' + Date.now().toString(36), name, genre, platform, custom: true };
      (S.form.extraGames ||= []).push(g); S.form.gameRotation.push(g.id); render(); break;
    }
    case 'settings-reset': S.form = null; render(); break;
    case 'settings-save': {
      const f = clone(S.form);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.startDate || '')) { toast('시작일을 확인해 주세요.'); return; }
      if (await saveJSONFile('data/settings.json', f, '설정 저장')) { S.settings = { ...clone(DEFAULT_SETTINGS), ...f }; S.form = null; S.draft = null; S.draftDate = null; render(); }
      break;
    }
    case 'folder-connect': await connectFolder(); break;
    case 'folder-import': await importAll(); break;
    case 'folder-forget': S.dir = null; await idbDel('dir'); toast('폴더 연결을 끊었어요.'); render(); break;
    // 사용법
    case 'gscreen': S.ui.gscreen = id; S.ui.gblock = null; render(); break;
    case 'gblock': S.ui.gblock = S.ui.gblock === id ? null : id; render(); break;
  }
});

// ───────── 시작 ─────────
async function loadAll() {
  const st = await loadJSON('data/settings.json', {});
  S.settings = { ...clone(DEFAULT_SETTINGS), ...st };
  const p = S.settings.pack || 'game-ops';
  const [pack, acts, real, mis, recs, fb, xi] = await Promise.all([
    loadJSON(`packs/${p}/pack.json`, null),
    loadJSON(`packs/${p}/activities.json`, { menus: [] }),
    loadJSON(`packs/${p}/real-games.json`, { games: [] }),
    loadJSON('data/missions.json', { missions: [] }),
    loadJSON('data/records.json', {}),
    loadJSON('data/feedback.json', {}),
    loadJSON('data/excel/index.json', { weeks: [] }),
  ]);
  Object.assign(S, { pack, acts, realGames: real.games || [], missions: mis.missions || [], records: recs || {}, feedback: fb || {}, excelIndex: xi || { weeks: [] } });
  document.title = S.settings.title;
}
async function boot() {
  S.token = ss.get('cb_token');
  S.today = todayKST();
  S.date = S.today;
  if (location.protocol === 'https:' || location.hostname === 'localhost') {
    const h = await idbGet('dir');
    if (h) S.dir = h;
  }
  await loadAll();
  route();
  window.addEventListener('hashchange', route);
}
boot();
