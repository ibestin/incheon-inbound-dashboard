/* Incheon Kia — Outbound Dashboard (Sales & Service), shared uploads and status timelines.
   Load after app.js (the version with the Agent Status Time table); its CONFIG, state and toast are used here. */
(() => {
'use strict';

/* ─── CONFIG: edit agent lists here ─── */
const CFG = {
  TEAMS: {
    sales: { label: 'Sales', agents: ['akhil','sreeraj','tony','joyal','balu','arunsiju','riswan','deepak','aravind','aswin','deepu','renjith','akshay','amal','sachu'] },
    service: { label: 'Service', agents: ['abhins_pm','charls','anil','nidhil','jinu','nived','davood','nitheesh','alan','anandhu','justin','aruntk','rahuls','hamdan'] }
  },
  HOURS: { start: 9, end: 18 },            // Outbound: 09:00 up to 18:00
  INBOUND_HOURS: { start: 8, end: 20 },    // Inbound timeline: 08:00 to 20:00
  OFFLINE: ['UNAVAILABLE', 'DISCONNECTED'],
  ANSWERED: 'ANSWERED',
  STYLE: {
    BREAK: ['#dc2626', 'Break'],
    PAUSED: ['#d97706', 'Paused'],
    AVAILABLE: ['#fcd34d', 'Available'],
    DIALING: ['#16a34a', 'Dialing / Ringing / On-call'],
    RINGING: ['#16a34a'], ONOCALL: ['#16a34a'], ONCALL: ['#16a34a'],
    CLOSURE: ['#8b4513', 'Closure']
  },
  OTHER_COLOR: '#94a3b8'                    // any status not listed above
};

const S = { team: 'sales', status: null, calls: null, ready: false };
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, '0');
const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
const clean = (v) => String(v ?? '').trim();

/* ─── PARSING ─── */
function makeStamp(y, mo, d, h, mi, s, ap) {
  if (ap) { if (h < 1 || h > 12) return null; h = (h % 12) + (ap.toUpperCase() === 'PM' ? 12 : 0); }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  return { date: `${y}-${pad(mo)}-${pad(d)}`, sec: h * 3600 + mi * 60 + s };
}
const TIME = String.raw`(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?`;
const RE_ISO = new RegExp(String.raw`^(\d{4})-(\d{1,2})-(\d{1,2})` + TIME);
const RE_SLASH = new RegExp(String.raw`^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})` + TIME);
/* Status report is DD/MM/YYYY; outbound CSV is ISO or MM/DD/YYYY (same as inbound dashboard) */
function parseStamp(raw, dayFirst) {
  const v = clean(raw);
  let m = v.match(RE_ISO);
  if (m) return m[4] === undefined ? null : makeStamp(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0), m[7]);
  m = v.match(RE_SLASH);
  if (!m || m[4] === undefined) return null;
  return makeStamp(+m[3], +(dayFirst ? m[2] : m[1]), +(dayFirst ? m[1] : m[2]), +m[4], +m[5], +(m[6] || 0), m[7]);
}
function parseDur(v) {
  const p = clean(v).split(':').map(Number);
  if (p.length < 2 || p.some(Number.isNaN)) return 0;
  return p.reduce((t, n) => t * 60 + n, 0);
}

function parseStatusRows(rows) {
  const out = []; let skipped = 0;
  rows.forEach((r, i) => {
    if (!clean(r['Agent']) && !clean(r['Status']) && !clean(r['Time'])) return;   // blank footer lines
    const t = parseStamp(r['Time'], true);
    const agent = clean(r['Agent']).toLowerCase(), status = clean(r['Status']).toUpperCase();
    if (!t || !agent || !status) { skipped++; return; }
    out.push({ ...t, agent, status, dur: parseDur(r['Total Duration']), sl: Number(r['SL No.']) || i + 1 });
  });
  const dates = [...new Set(out.map((r) => r.date))].sort();
  const date = dates[dates.length - 1];
  /* report is newest-first, so for identical timestamps the higher SL No. happened earlier */
  return { date, extraDates: dates.length - 1, skipped, rows: out.filter((r) => r.date === date).sort((a, b) => a.sec - b.sec || b.sl - a.sl) };
}
function parseCallRows(rows) {
  const out = []; let skipped = 0;
  for (const r of rows) {
    const t = parseStamp(r['Call Date'], false);
    if (!t) { skipped++; continue; }
    out.push({ ...t, agent: clean(r['Agent']).toLowerCase(), answered: clean(r['Disposition']).toUpperCase() === CFG.ANSWERED });
  }
  return { rows: out, skipped };
}

/* ─── METRICS ─── */
function compute(teamKey, statusRows, callRows) {
  return [...CFG.TEAMS[teamKey].agents].sort((a, b) => a.localeCompare(b)).map((name) => {
    const log = statusRows.filter((r) => r.agent === name);
    const calls = callRows.filter((r) => r.agent === name);
    const by = {};
    log.forEach((r) => { by[r.status] = (by[r.status] || 0) + r.dur; });
    const first = log.length ? log[0].sec : null;
    const last = log.length ? Math.max(...log.map((r) => r.sec + r.dur)) : null;
    const offline = CFG.OFFLINE.reduce((t, k) => t + (by[k] || 0), 0);
    const hours = {};
    calls.forEach((c) => {
      const h = Math.floor(c.sec / 3600);
      const key = h >= CFG.HOURS.start && h < CFG.HOURS.end ? h : 'other';
      hours[key] = hours[key] || { h: 0, a: 0 };
      hours[key].h++; if (c.answered) hours[key].a++;
    });
    const t = (k) => (log.length ? by[k] || 0 : null);
    return {
      name, log, hours, first, last,
      handled: calls.length, answered: calls.filter((c) => c.answered).length,
      login: log.length ? Math.max(0, last - first - offline) : null,
      available: t('AVAILABLE'), oncall: t('ONOCALL'), brk: t('BREAK'), paused: t('PAUSED'), closure: t('CLOSURE'),
      avgClosure: log.length && calls.length ? (by.CLOSURE || 0) / calls.length : null,
      absent: !log.length && !calls.length
    };
  });
}

/* ─── FORMATTING ─── */
const hms = (s) => (s === null ? '—' : `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s % 3600 / 60))}:${pad(Math.floor(s % 60))}`);
const mmss = (s) => { if (s === null) return '—'; const r = Math.round(s); return `${pad(Math.floor(r / 60))}:${pad(r % 60)}`; };
const rate = (a, b) => (b ? `${(a / b * 100).toFixed(1)}%` : '—');
const clock = (s) => { const h = Math.floor(s / 3600) % 24; return `${(h % 12) || 12}:${pad(Math.floor(s % 3600 / 60))}:${pad(s % 60)} ${h < 12 ? 'AM' : 'PM'}`; };
const sum = (list, k) => list.reduce((t, a) => t + (a[k] || 0), 0);
const nameCell = (a) => `<td><div class="agent-name">${esc(a.name)}${a.absent ? '<span class="ab-badge">AB</span>' : ''}</div></td>`;
const card = (title, note, body) => `<div class="card ob-card"><div class="card-header"><div class="card-title">${title}</div><div class="card-note">${note}</div></div>${body}</div>`;
const table = (head, body, foot) => `<div class="ob-scroll"><table><thead><tr>${head.map((h, i) => `<th class="${i ? 'right' : ''}">${h}</th>`).join('')}</tr></thead><tbody>${body}${foot}</tbody></table></div>`;
const cells = (list) => list.map((v) => `<td class="right">${v}</td>`).join('');

/* ─── RENDER ─── */
const longDate = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
function performanceTable(agents) {
  const head = ['Agent','Handled','Answered','Answering %','First Login','Login Hours','Available','On-Call','Break','Paused','Closure','Avg Closure'];
  const body = agents.map((a) => `<tr>${nameCell(a)}${cells([a.handled, a.answered, rate(a.answered, a.handled), a.first === null ? '—' : clock(a.first), hms(a.login), hms(a.available), hms(a.oncall), hms(a.brk), hms(a.paused), hms(a.closure), mmss(a.avgClosure)])}</tr>`).join('');
  const logged = agents.filter((a) => a.log.length);
  const total = (k) => (logged.length ? hms(sum(logged, k)) : '—');
  /* team average closure uses only agents who have status data */
  const loggedCalls = sum(logged, 'handled');
  const H = sum(agents, 'handled'), A = sum(agents, 'answered');
  const foot = `<tr class="ob-total"><td>Team Total</td>${cells([H, A, rate(A, H), '—', total('login'), total('available'), total('oncall'), total('brk'), total('paused'), total('closure'), mmss(loggedCalls ? sum(logged, 'closure') / loggedCalls : null)])}</tr>`;
  return table(head, body, foot);
}

function hourlyTable(agents) {
  const hrs = []; for (let h = CFG.HOURS.start; h < CFG.HOURS.end; h++) hrs.push(h);
  const keys = agents.some((a) => a.hours.other) ? [...hrs, 'other'] : hrs;
  const head = ['Agent', ...keys.map((k) => (k === 'other' ? 'Other Hours' : `${pad(k)}–${pad(k + 1)}`)), 'Total'];
  const body = agents.map((a) => `<tr>${nameCell(a)}${keys.map((k) => {
    const v = a.hours[k];
    if (v) return `<td class="right">${v.h} / ${v.a}</td>`;
    const idle = k !== 'other' && a.log.length && k * 3600 <= a.last && (k + 1) * 3600 > a.first;
    return idle ? '<td class="right ob-idle">0 / 0</td>' : '<td class="right">—</td>';
  }).join('')}<td class="right"><b>${a.handled} / ${a.answered}</b></td></tr>`).join('');
  const foot = `<tr class="ob-total"><td>Team Total</td>${cells(keys.map((k) => `${agents.reduce((t, a) => t + (a.hours[k]?.h || 0), 0)} / ${agents.reduce((t, a) => t + (a.hours[k]?.a || 0), 0)}`))}<td class="right">${sum(agents, 'handled')} / ${sum(agents, 'answered')}</td></tr>`;
  return table(head, body, foot);
}

function timeline(agents, hours, extendEarly) {
  const end = hours.end * 3600;
  const starts = extendEarly ? agents.filter((a) => a.first !== null && a.first < end).map((a) => a.first) : [];
  const start = Math.floor(Math.min(hours.start * 3600, ...starts) / 3600) * 3600;
  const pos = (s) => (s - start) / (end - start) * 100;
  let grid = '', axis = '';
  for (let s = start; s <= end; s += 3600) {
    const h = s / 3600;
    grid += `<i class="ob-grid" style="left:${pos(s)}%"></i>`;
    const shift = s === start ? '0' : s === end ? '-100%' : '-50%';
    axis += `<span style="left:${pos(s)}%;transform:translateX(${shift})">${(h % 12) || 12} ${h < 12 ? 'AM' : 'PM'}</span>`;
  }
  const rows = agents.map((a) => {
    const bars = a.log.map((r, i) => {
      if (CFG.OFFLINE.includes(r.status) || r.sec >= end) return '';
      const color = CFG.STYLE[r.status]?.[0] || CFG.OTHER_COLOR;
      const open = r.dur === 0;
      if (open && i !== a.log.length - 1) return '';
      if (open ? r.sec < start : r.sec + r.dur <= start) return '';
      const from = Math.max(r.sec, start);
      const width = open ? '' : `width:${pos(Math.min(r.sec + r.dur, end)) - pos(from)}%;`;
      const tip = `${a.name} · ${r.status}\nStart: ${clock(r.sec)}\n${open ? 'End: not known (latest status)' : `End: ${clock(r.sec + r.dur)}\nDuration: ${hms(r.dur)}`}`;
      return `<b class="ob-seg${open ? ' ob-open' : ''}" style="left:${pos(from)}%;${width}background:${color}" data-tip="${esc(tip)}"></b>`;
    }).join('');
    return `<div class="ob-row"><div class="ob-name agent-name">${esc(a.name)}${a.absent ? '<span class="ab-badge">AB</span>' : ''}</div><div class="ob-track">${grid}${bars}</div></div>`;
  }).join('');
  const legend = Object.values(CFG.STYLE).filter((v) => v[1]).map(([c, l]) => `<span><i style="background:${c}"></i>${l}</span>`).join('') + '<span><i class="ob-gap"></i>Blank = Unavailable / Disconnected / no data</span>';
  return `<div class="ob-timeline"><div class="ob-legend">${legend}</div><div class="ob-row"><div class="ob-name"></div><div class="ob-axis">${axis}</div></div>${rows}</div>`;
}

function render() {
  const day = S.status.date;
  const calls = S.calls.rows.filter((c) => c.date === day);
  const agents = compute(S.team, S.status.rows, calls);
  const H = sum(agents, 'handled'), A = sum(agents, 'answered');
  const label = CFG.TEAMS[S.team].label;
  const dayText = longDate(day);
  const kpis = [['Total Handled', H], ['Answered', A], ['Answering %', rate(A, H)], ['Total On-Call', hms(sum(agents, 'oncall'))], ['Agents Logged In', `${agents.filter((a) => a.log.length).length} / ${agents.length}`]];
  $('ob-board').innerHTML = `
    <div class="date-banner"><div class="date-display"><span>${label} Outbound</span> · ${dayText}</div></div>
    <div class="kpi-strip">${kpis.map(([l, v], i) => `<div class="kpi-card c${i + 1}"><div class="kpi-label">${l}</div><div class="kpi-main"><div class="kpi-value">${v}</div></div></div>`).join('')}</div>
    ${card('Agent Performance', 'Durations HH:MM:SS · Avg Closure MM:SS', performanceTable(agents))}
    ${card('Hourly Calls by Agent', 'Handled / Answered', hourlyTable(agents))}
    ${card('Status Timeline', 'Hover a segment for details', timeline(agents, CFG.HOURS, true))}`;
  $('ob-dashboard').style.display = 'block';
  $('ob-empty').style.display = 'none';
  S.ready = true;

  const warn = [];
  if (!calls.length) warn.push(`No outbound calls found for ${day}. Check that the CSV is for the same date.`);
  else if (!H) warn.push(`No ${label} agent calls found for ${day}.`);
  if (!agents.some((a) => a.log.length)) warn.push(`No ${label} agents found in the status file.`);
  if (S.status.extraDates) warn.push(`Status file has more than one date; only ${day} is used.`);
  if (S.status.skipped) warn.push(`${S.status.skipped} unreadable status rows skipped.`);
  if (S.calls.skipped) warn.push(`${S.calls.skipped} unreadable call rows skipped.`);
  setStatus(warn.length ? warn.join(' ') : `${label} dashboard updated for ${day}`, warn.length ? 'error' : 'success');
}

/* ─── INBOUND TIMELINE ─── */
/* Lives inside #export-container, below app.js's Agent Status Time table */
function renderInboundTimeline() {
  const box = $('in-timeline');
  if (!S.status) { box.innerHTML = ''; return; }
  const day = S.status.date;
  const agents = [...CONFIG.ALLOWED_AGENTS].sort((a, b) => a.localeCompare(b)).map((name) => {
    const log = S.status.rows.filter((r) => r.agent === name);
    return { name, log, first: log.length ? log[0].sec : null, absent: !log.length };
  });
  const notes = [];
  if (day < $('date-from').value || day > $('date-to').value) notes.push(`Note: the timeline date (${longDate(day)}) is outside the selected date range.`);
  if (agents.every((a) => a.absent)) notes.push('No inbound agents found in the status file.');
  if (S.status.extraDates) notes.push(`Status file has more than one date; only ${day} is used.`);
  if (S.status.skipped) notes.push(`${S.status.skipped} unreadable status rows skipped.`);
  const note = notes.length ? `<div class="ob-note">${notes.join(' ')}</div>` : '';
  box.innerHTML = card(`Status Timeline · ${longDate(day)}`, '8 AM – 8 PM · Status file date', note + timeline(agents, CFG.INBOUND_HOURS, false));
}

/* ─── FILES, EVENTS ─── */
function setStatus(msg, type) { const el = $('ob-status'); el.textContent = msg; el.className = msg ? `ob-status show ${type || ''}` : 'ob-status'; }
function setInboundStatus(msg) { window.setStatus(msg, 'error'); }   // app.js toast

/* Clears both dashboards so old results are never shown against new files */
function reset() {
  S.ready = false;
  $('ob-dashboard').style.display = 'none';
  $('ob-empty').style.display = '';
  $('dashboard').classList.remove('show');
  $('empty-state').style.display = '';
  $('header-date').textContent = 'No data loaded';
}

/* kind 'calls' shares the outbound input with app.js, which manages that button's label */
function loadFile(kind, input) {
  const file = input.files && input.files[0];
  if (!file) return;
  S[kind] = null; reset();
  const need = kind === 'status' ? ['Agent', 'Status', 'Time', 'Total Duration'] : ['Call Date', 'Agent', 'Disposition'];
  const statusLabel = (name, loaded) => {
    $('status-filename').textContent = name;
    $('status-btn').classList.toggle('loaded', loaded);
  };
  if (kind === 'status') statusLabel('Choose agent status CSV…', false);
  const fail = (msg) => {
    if (kind === 'status') input.value = '';
    setStatus(msg, 'error');
    if (kind === 'status') setInboundStatus(msg);
  };
  Papa.parse(file, {
    header: true, skipEmptyLines: true, transformHeader: (h) => h.replace(/^\uFEFF/, '').trim(),
    complete: (res) => {
      const fields = res.meta.fields || [];
      /* file rejected by the inbound rules too: drop any previously loaded outbound data */
      if (kind === 'calls' && CONFIG.COLUMNS.outbound.critical.some((c) => !fields.includes(c))) {
        state.outbound = null;
        $('outbound-filename').textContent = 'Choose outbound CSV…';
        $('outbound-btn').classList.remove('loaded');
      }
      const missing = need.filter((c) => !fields.includes(c));
      if (missing.length) return fail(`${file.name}: missing columns ${missing.join(', ')}`);
      const parsed = kind === 'status' ? parseStatusRows(res.data) : parseCallRows(res.data);
      if (!parsed.rows.length) return fail(`${file.name}: no readable rows (check the date format).`);
      S[kind] = parsed;
      if (kind === 'status') statusLabel(file.name, true);
      setStatus(`${file.name} loaded: ${parsed.rows.length} rows`, 'success');
    },
    error: () => fail(`Failed to read ${file.name}`)
  });
}

/* Runs after app.js has handled the same APPLY click */
function applyAll() {
  try {
    if (!state.inbound || !state.outbound) setInboundStatus('Upload the outbound and inbound CSVs to build the Inbound dashboard.');
    else if ($('dashboard').classList.contains('show')) renderInboundTimeline();
  } catch (e) { console.error(e); setInboundStatus(`Timeline could not be built: ${e.message}`); }
  if (!S.status || !S.calls) return setStatus('Upload the outbound and agent status CSVs to build the Outbound dashboard.', 'error');
  try { render(); } catch (e) { console.error(e); setStatus(`Something went wrong: ${e.message}`, 'error'); }
}

function showView(view) {
  document.querySelectorAll('[data-view]').forEach((el) => { el.hidden = el.dataset.view !== view; });
  document.querySelectorAll('.ob-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === view));
}

function init() {
  document.querySelectorAll('.ob-tab').forEach((b) => b.addEventListener('click', () => showView(b.dataset.tab)));
  $('export-container').insertAdjacentHTML('beforeend', '<div id="in-timeline"></div>');
  $('outbound-file').addEventListener('change', (e) => loadFile('calls', e.target));
  $('inbound-file').addEventListener('change', reset);
  $('status-file').addEventListener('change', (e) => loadFile('status', e.target));
  document.querySelectorAll('.ob-team').forEach((b) => b.addEventListener('click', () => {
    S.team = b.dataset.team;
    document.querySelectorAll('.ob-team').forEach((x) => x.classList.toggle('active', x === b));
    if (S.ready) render();
  }));
  $('apply-btn').addEventListener('click', reset, true);   // before app.js runs
  $('apply-btn').addEventListener('click', applyAll);      // after app.js runs
  const tip = $('ob-tip');
  document.addEventListener('mousemove', (e) => {
    const seg = e.target.closest?.('.ob-seg');
    tip.style.display = seg ? 'block' : 'none';
    if (!seg) return;
    tip.textContent = seg.dataset.tip;
    tip.style.left = `${Math.min(e.clientX + 12, window.innerWidth - tip.offsetWidth - 8)}px`;
    tip.style.top = `${Math.min(e.clientY + 12, window.innerHeight - tip.offsetHeight - 8)}px`;
  });
}
document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
