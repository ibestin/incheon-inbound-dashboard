/* ═══════════════════════════════════════════════════════════════════════════
   Incheon Kia — Contact Centre Dashboard
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

/* ─── 1. CONFIG ──────────────────────────────────────────────────────── */
const CONFIG = {
  ALLOWED_AGENTS: ['dhanil', 'sreerag', 'athul', 'nigel', 'sijin', 'akhil_ar'],
  INBOUND_MISSED_DISPS: ['BUSY', 'QUEUE TIMEOUT', 'NO AGENTS', 'DISCONNECTED', 'NO ANSWER'],
  EXCLUDED_GROUP: 'HYPERLOCAL',
  ABANDONED_CUTOFF_HOUR: 18,
  DISP_ANSWERED: 'ANSWERED',
  DISP_NO_ANSWER: 'NO ANSWER',
  OCCUPANCY_HOURS: { start: 8, end: 19 },
  COMPARE_HOURS: [8, 18, 19],
  COMPARE_DAYS: 3,
  EXCLUDED_WEEKDAYS: [0], // Excludes Sundays from all math
  CHART_COLORS: { handled: '#c8102e', answered: '#16a34a', missed: '#d97706', onCall: '#2563eb', aht: '#7c3aed' },
  COLUMNS: {
    inbound:  { critical: ['Call Date', 'Disposition'], expected: ['From', 'Group', 'Agent', 'Call Duration'] },
    outbound: { critical: ['Call Date', 'Disposition'], expected: ['To', 'Agent', 'Duration'] }
  }
};

const ALLOWED_AGENT_SET = new Set(CONFIG.ALLOWED_AGENTS);
const MISSED_SET = new Set(CONFIG.INBOUND_MISSED_DISPS);

const state = { inbound: null, outbound: null, agents: [], charts: {} };

/* ─── 2. UTILITIES ────────────────────────────────────────────────────── */
const pad2 = (n) => String(n).padStart(2, '0');
const $ = (id) => document.getElementById(id);

function parseDuration(val) {
  if (val === null || val === undefined) return 0;
  const s = String(val).trim();
  if (!s) return 0;
  const parts = s.split(':').map(Number);
  if (parts.some(Number.isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

function secondsToMMSS(s) {
  if (!s || isNaN(s)) return '00:00';
  return `${pad2(Math.floor(s / 60))}:${pad2(Math.round(s % 60))}`;
}

function secondsToHHMM(s) {
  if (!s || isNaN(s)) return '0h 00m';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h > 0) return `${h}h ${pad2(m)}m`;
  return `${m}m ${pad2(Math.round(s % 60))}s`;
}

const RE_ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/;
const RE_MDY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?/;

function parseDateTime(raw) {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!s) return null;

  let y, mo, d, h = 0, mi = 0, se = 0, ampm = null;
  let m = s.match(RE_ISO);
  if (m) {
    y = +m[1]; mo = +m[2]; d = +m[3];
    h = +(m[4] || 0); mi = +(m[5] || 0); se = +(m[6] || 0);
  } else {
    m = s.match(RE_MDY);
    if (!m) return null;
    mo = +m[1]; d = +m[2]; y = +m[3];
    h = +(m[4] || 0); mi = +(m[5] || 0); se = +(m[6] || 0);
    ampm = m[7] ? m[7].toUpperCase() : null;
  }
  if (ampm) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (ampm === 'PM' ? 12 : 0);
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 59) return null;

  return { date: `${y}-${pad2(mo)}-${pad2(d)}`, hour: h, ts: Date.UTC(y, mo - 1, d, h, mi, se) };
}

function normalisePhone(val) {
  if (val === null || val === undefined) return null;
  let s = String(val).trim();
  if (!s || s.toUpperCase() === 'NAN') return null;

  s = s.replace(/\s*(?:extn?\.?|x|#).*$/i, '');
  if (/^\+?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(s)) {
    s = String(Math.round(Number(s)));
  } else {
    s = s.replace(/\D/g, '');
  }
  if (!s || s === '0') return null;
  if (s.length > 10) s = s.slice(-10);
  return s.length >= 7 ? s : null;
}

function shiftYMD(ymd, deltaDays) {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function isExcludedDay(ymd) {
  const d = new Date(`${ymd}T00:00:00Z`);
  return !isNaN(d) && CONFIG.EXCLUDED_WEEKDAYS.includes(d.getUTCDay());
}

function lastWorkingDay(ymd, floorYMD) {
  let d = ymd;
  while (isExcludedDay(d) && d > floorYMD) d = shiftYMD(d, -1);
  return d;
}

function pickCompareDays(toYMD) {
  const days = [];
  let cursor = toYMD;
  for (let guard = 0; days.length < CONFIG.COMPARE_DAYS && guard < 60; guard++) {
    if (!isExcludedDay(cursor)) days.unshift(cursor);
    cursor = shiftYMD(cursor, -1);
  }
  return days;
}

const fmtDateLong = (ymd) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
const fmtDayShort = (ymd) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
const fmtWeekday = (ymd) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'long' });

function avatarColor(name) {
  const palette = ['#c8102e','#2563eb','#16a34a','#ea580c','#7c3aed','#0d9488','#d97706','#db2777','#475569','#0284c7'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return palette[Math.abs(hash) % palette.length];
}

const pct = (num, den, digits = 2) => (den > 0 ? ((num / den) * 100).toFixed(digits) : (0).toFixed(digits));

/* ─── 3. DATA PREPARATION ─────────────────────────────────────────────── */
function prepareRows(rows, kind) {
  const isIn = kind === 'inbound';
  const phoneCol = isIn ? 'From' : 'To';
  const durCol = isIn ? 'Call Duration' : 'Duration';
  const records = [];
  const unknown = new Map();
  let skipped = 0, excluded = 0;

  for (const r of rows) {
    const dt = parseDateTime(r['Call Date']);
    if (!dt) { skipped++; continue; }
    if (isExcludedDay(dt.date)) { excluded++; continue; }
    const disp = String(r['Disposition'] ?? '').trim().toUpperCase();
    const agent = String(r['Agent'] ?? '').trim().toLowerCase();
    const rec = {
      date: dt.date, hour: dt.hour, ts: dt.ts,
      disp, agent,
      phone: normalisePhone(r[phoneCol]),
      durSec: disp === CONFIG.DISP_ANSWERED ? parseDuration(r[durCol]) : 0
    };
    if (isIn) rec.group = String(r['Group'] ?? '').trim().toUpperCase();
    if (agent && !ALLOWED_AGENT_SET.has(agent)) unknown.set(agent, (unknown.get(agent) || 0) + 1);
    records.push(rec);
  }
  return { records, skipped, unknown, excluded };
}

function buildDataset(records, skipped, unknown, fileName) {
  const byDate = new Map();
  for (const r of records) {
    let bucket = byDate.get(r.date);
    if (!bucket) { bucket = []; byDate.set(r.date, bucket); }
    bucket.push(r);
  }
  return { records, byDate, dates: [...byDate.keys()].sort(), skipped, unknown, fileName };
}

function rowsInRange(ds, from, to) {
  const chunks = [];
  for (const d of ds.dates) {
    if (d < from) continue;
    if (d > to) break;
    chunks.push(ds.byDate.get(d));
  }
  return [].concat(...chunks);
}
const rowsOnDate = (ds, ymd) => ds.byDate.get(ymd) || [];

/* ─── 4. METRICS ──────────────────────────────────────────────────────── */
function computeAbandoned(inRows, outRows) {
  const outAnsweredTs = new Map();
  for (const r of outRows) {
    if (!r.phone || r.disp !== CONFIG.DISP_ANSWERED) continue;
    const key = `${r.phone}|${r.date}`;
    if (!(outAnsweredTs.get(key) >= r.ts)) outAnsweredTs.set(key, r.ts);
  }

  const perKey = new Map();
  for (const r of inRows) {
    if (!r.phone || r.group === CONFIG.EXCLUDED_GROUP) continue;
    const key = `${r.phone}|${r.date}`;
    let s = perKey.get(key);
    if (!s) { s = { lastMissed: -Infinity, lastMissedHour: 0, lastAnswered: -Infinity }; perKey.set(key, s); }
    if (MISSED_SET.has(r.disp)) {
      if (r.ts > s.lastMissed) { s.lastMissed = r.ts; s.lastMissedHour = r.hour; }
    } else if (r.disp === CONFIG.DISP_ANSWERED && r.ts > s.lastAnswered) {
      s.lastAnswered = r.ts;
    }
  }

  let abandoned = 0;
  perKey.forEach((s, key) => {
    if (s.lastMissed === -Infinity) return;
    if (s.lastMissedHour >= CONFIG.ABANDONED_CUTOFF_HOUR) return;
    if (s.lastAnswered > s.lastMissed) return;
    if ((outAnsweredTs.get(key) ?? -Infinity) > s.lastMissed) return;
    abandoned++;
  });
  return abandoned;
}

function summariseInbound(inRows, outRows) {
  let answered = 0, missedNoAnswer = 0;
  for (const r of inRows) {
    if (r.disp === CONFIG.DISP_ANSWERED) answered++;
    else if (r.disp === CONFIG.DISP_NO_ANSWER) missedNoAnswer++;
  }
  const total = inRows.length;
  const abandoned = computeAbandoned(inRows, outRows);
  return { total, answered, missedNoAnswer, abandoned, abandonedPct: pct(abandoned, total) };
}

function computeHourly(inRows) {
  const hours = Array.from({ length: 24 }, () => ({ inbound: 0, answered: 0, missed: 0 }));
  for (const r of inRows) {
    const h = hours[r.hour];
    h.inbound++;
    if (r.disp === CONFIG.DISP_ANSWERED) h.answered++;
    else if (r.disp === CONFIG.DISP_NO_ANSWER) h.missed++;
  }
  return hours;
}

function buildAgents(outRows, inRows) {
  const map = new Map(CONFIG.ALLOWED_AGENTS.map((name) => [name, { name, handled: 0, answered: 0, missed: 0, onCallSec: 0 }]));

  for (const r of outRows) {
    const a = map.get(r.agent);
    if (!a) continue;
    a.handled++;
    if (r.disp === CONFIG.DISP_ANSWERED) { a.answered++; a.onCallSec += r.durSec; }
  }
  for (const r of inRows) {
    const a = map.get(r.agent);
    if (!a) continue;
    a.handled++;
    if (r.disp === CONFIG.DISP_ANSWERED) { a.answered++; a.onCallSec += r.durSec; }
    else if (r.disp === CONFIG.DISP_NO_ANSWER) a.missed++;
  }

  return [...map.values()].map((a) => ({
    name: a.name, totalHandled: a.handled, totalAnswered: a.answered, totalMissed: a.missed,
    totalOnCallSec: a.onCallSec, avgHandleSec: a.answered > 0 ? Math.round(a.onCallSec / a.answered) : 0,
    missedPercent: a.answered > 0 ? (a.missed / a.answered) * 100 : 0
  })).sort((x, y) => x.name.localeCompare(y.name));
}

/* ─── 5. RENDERING ────────────────────────────────────────────────────── */
function buildBoardHTML(sfx = '') {
  return `
    <div class="date-banner">
      <div class="date-display" id="date-display${sfx}">—</div>
      <div class="summary-pills" id="summary-pills${sfx}"></div>
    </div>
    <div class="kpi-strip" id="kpi-strip${sfx}"></div>
    <div class="board">
      <div class="card">
        <div class="card-header">
          <div class="card-title">Agent Performance</div>
          <div class="card-note" id="agent-note${sfx}">Inbound + Outbound</div>
        </div>
        <table>
          <thead>
            <tr>
              <th>#</th><th>Agent</th>
              <th class="right">Handled</th><th class="right">Answered</th>
              <th class="right">Missed (NA)</th><th class="right">Missed %</th>
              <th class="right">On-Call</th><th class="right">Avg Handle</th>
            </tr>
          </thead>
          <tbody id="agent-tbody${sfx}"></tbody>
        </table>
      </div>
      <div class="card">
        <div class="card-header">
          <div class="card-title">Hourly Occupancy · Inbound</div>
          <div class="card-note">8 AM – 8 PM</div>
        </div>
        <table>
          <thead>
            <tr><th>Hour</th><th class="right">Inbound</th><th class="right">Answered</th><th class="right">Missed</th><th>Answer rate</th></tr>
          </thead>
          <tbody id="hourly-occupancy-tbody${sfx}"></tbody>
        </table>
      </div>
      <div class="card">
        <div class="card-header">
          <div class="card-title">Hourly Comparison · Last ${CONFIG.COMPARE_DAYS} Days</div>
          <div class="card-note">Inbound · 8 AM · 6 PM · 7 PM</div>
        </div>
        <table>
          <thead>
            <tr><th>Day</th><th class="right">Handled</th><th class="right">Answered</th><th class="right">Answer %</th></tr>
          </thead>
          <tbody id="hourly-compare-tbody${sfx}"></tbody>
        </table>
      </div>
    </div>`;
}

function renderDateBanner(from, to, outCount, inCount, agents, sfx = '') {
  $('date-display' + sfx).innerHTML = from === to
    ? `<span>${fmtWeekday(from)}</span>, ${fmtDateLong(from)}`
    : `<span>${fmtDateLong(from)}</span> &nbsp;→&nbsp; <span>${fmtDateLong(to)}</span>`;
  const active = agents.filter((a) => a.totalHandled > 0).length;
  $('summary-pills' + sfx).innerHTML = `
    <div class="pill">Outbound<strong>${outCount}</strong></div>
    <div class="pill">Inbound<strong>${inCount}</strong></div>
    <div class="pill">Agents Active<strong>${active}</strong></div>`;
}

function renderKPIs(range, day, sfx = '') {
  const cards = [
    { label: 'Total Inbound Calls', value: range.total, today: day.total, sub: 'All inbound records', cls: 'c1' },
    { label: 'Inbound Answered', value: range.answered, today: day.answered, sub: `Answer rate ${pct(range.answered, range.total)}%`, cls: 'c2' },
    { label: 'Abandoned Calls (≤6PM rule)', value: range.abandoned, today: day.abandoned, sub: 'Last missed <6PM & no resolution', cls: 'c3' },
    { label: 'Abandoned %', value: `${range.abandonedPct}%`, today: `${day.abandonedPct}%`, sub: `of total inbound (${range.abandoned}/${range.total})`, cls: 'c4' },
    { label: 'Inbound Missed (NO ANSWER)', value: range.missedNoAnswer, today: day.missedNoAnswer, sub: 'Rang but not picked', cls: 'c5' }
  ];
  $('kpi-strip' + sfx).innerHTML = cards.map((c) => `
    <div class="kpi-card ${c.cls}">
      <div class="kpi-label">${c.label}</div>
      <div class="kpi-main"><div class="kpi-value">${c.value}</div><span class="kpi-today">(${c.today})</span></div>
      <div class="kpi-sub">${c.sub}</div>
    </div>`).join('');
}

function renderAgentTable(agents, dayAgents, sfx = '') {
  const maxHandled = Math.max(...agents.map((a) => a.totalHandled), 1);
  const dayByName = new Map((dayAgents || []).map((d) => [d.name, d]));
  const empty = { totalHandled: 0, totalAnswered: 0, totalMissed: 0, missedPercent: 0, totalOnCallSec: 0, avgHandleSec: 0 };
  const br = (v) => (dayAgents ? `<span class="br">(${v})</span>` : '');

  $('agent-tbody' + sfx).innerHTML = agents.map((a, idx) => {
    const d = dayByName.get(a.name) || empty;
    const barW = Math.round((a.totalHandled / maxHandled) * 50);
    return `<tr>
      <td class="num" style="color:var(--text-dim);">${idx + 1}</td>
      <td><div class="agent-name"><div class="agent-avatar" style="background:${avatarColor(a.name)}">${a.name.substring(0, 2)}</div>${a.name}${a.totalHandled === 0 ? '<span class="ab-badge">AB</span>' : ''}</div></td>
      <td class="right"><div class="bar-cell"><span class="stack"><span>${a.totalHandled}</span>${br(d.totalHandled)}</span><div class="mini-bar" style="width:${barW}px"></div></div></td>
      <td class="right">${a.totalAnswered}${br(d.totalAnswered)}</td>
      <td class="right">${a.totalMissed > 0 ? `<span class="warn">${a.totalMissed}</span>` : '0'}${br(d.totalMissed)}</td>
      <td class="right">${a.missedPercent.toFixed(2)}%${br(d.missedPercent.toFixed(2) + '%')}</td>
      <td class="right">${secondsToHHMM(a.totalOnCallSec)}${br(secondsToHHMM(d.totalOnCallSec))}</td>
      <td class="right">${a.avgHandleSec > 0 ? secondsToMMSS(a.avgHandleSec) : '—'}${br(d.avgHandleSec > 0 ? secondsToMMSS(d.avgHandleSec) : '—')}</td>
    </tr>`;
  }).join('');
}

function renderHourlyOccupancy(inRows, sfx = '') {
  const hours = computeHourly(inRows);
  const { start, end } = CONFIG.OCCUPANCY_HOURS;
  let maxInbound = 0;
  for (let h = start; h <= end; h++) maxInbound = Math.max(maxInbound, hours[h].inbound);

  let html = '';
  for (let h = start; h <= end; h++) {
    const d = hours[h];
    if (d.inbound === 0) continue;
    const barWidth = maxInbound > 0 ? Math.round((d.inbound / maxInbound) * 40) : 0;
    html += `<tr>
      <td class="hour-col">${pad2(h)}:00</td>
      <td class="right">${d.inbound}</td>
      <td class="right">${d.answered}</td>
      <td class="right">${d.missed > 0 ? `<span class="warn">${d.missed}</span>` : '0'}</td>
      <td class="num"><span class="bar-inline" style="width:${barWidth}px"></span>${d.inbound > 0 ? ((d.answered/d.inbound)*100).toFixed(0) : 0}%</td>
    </tr>`;
  }
  $('hourly-occupancy-tbody' + sfx).innerHTML = html || '<tr><td colspan="5" style="text-align:center; color:var(--text-dim); padding:16px;">No inbound calls in selected range</td></tr>';
}

function renderHourlyComparison(toVal, sfx = '') {
  const days = pickCompareDays(toVal);
  const stats = new Map();
  
  for (const day of days) {
    const perHour = new Map(CONFIG.COMPARE_HOURS.map((h) => [h, { handled: 0, answered: 0 }]));
    for (const r of rowsOnDate(state.inbound, day)) {
      const slot = perHour.get(r.hour);
      if (!slot) continue;
      slot.handled++;
      if (r.disp === CONFIG.DISP_ANSWERED) slot.answered++;
    }
    stats.set(day, perHour);
  }

  let html = '';
  for (const h of CONFIG.COMPARE_HOURS) {
    html += `<tr class="sub-row"><td colspan="4">${pad2(h > 12 ? h - 12 : h)}:00 – ${pad2(h > 12 ? h - 12 : h)}:59 ${h >= 12 ? 'PM' : 'AM'}</td></tr>`;
    for (const day of days) {
      const v = stats.get(day).get(h);
      const pct = v.handled > 0 ? ((v.answered / v.handled) * 100).toFixed(1) + '%' : '—';
      html += `<tr${day === days[days.length - 1] ? ' class="cmp-last"' : ''}>
        <td class="hour-col">${fmtDayShort(day)}</td>
        <td class="right">${v.handled}</td>
        <td class="right">${v.answered}</td>
        <td class="right">${pct}</td>
      </tr>`;
    }
  }
  $('hourly-compare-tbody' + sfx).innerHTML = html;
}

/* ─── 6. CHARTS ───────────────────────────────────────────────────────── */
function initChartDefaults() {
  Chart.defaults.font.family = "'JetBrains Mono', monospace";
  Chart.defaults.font.size = 10;
}

function baseChartOptions(opts = {}) {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { display: !!opts.legend, position: 'top', align: 'end', labels: { boxWidth: 8, boxHeight: 8, usePointStyle: true, color: '#4b5567', font: { family: 'Inter', size: 10 } } },
      tooltip: { backgroundColor: '#151a27', titleColor: '#fff', bodyColor: '#e3e7ee', padding: 8, cornerRadius: 6, callbacks: opts.tooltip ? { label: opts.tooltip } : {} }
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: '#7a8397' }, border: { color: '#e3e7ee' } },
      y: { grid: { color: '#eef1f6' }, ticks: { color: '#7a8397', callback: opts.yTick || undefined }, border: { display: false }, beginAtZero: true }
    }
  };
}

function makeChart(id, config) {
  const canvas = $(id);
  if (!canvas) return;
  if (state.charts[id]) state.charts[id].destroy();
  state.charts[id] = new Chart(canvas, config);
}

function renderCharts(agents) {
  const labels = agents.map((a) => a.name);
  const CC = CONFIG.CHART_COLORS;

  makeChart('chart-calls', {
    type: 'bar',
    data: {
      labels,
      datasets: [
        { label: 'Handled',  data: agents.map((a) => a.totalHandled),  backgroundColor: CC.handled,  borderRadius: 3, maxBarThickness: 18 },
        { label: 'Answered', data: agents.map((a) => a.totalAnswered), backgroundColor: CC.answered, borderRadius: 3, maxBarThickness: 18 },
        { label: 'Missed',   data: agents.map((a) => a.totalMissed),   backgroundColor: CC.missed,   borderRadius: 3, maxBarThickness: 18 }
      ]
    },
    options: baseChartOptions({ legend: true })
  });

  makeChart('chart-oncall', {
    type: 'bar',
    data: { labels, datasets: [{ data: agents.map((a) => parseFloat((a.totalOnCallSec / 60).toFixed(1))), backgroundColor: CC.onCall, borderRadius: 3, maxBarThickness: 28 }] },
    options: baseChartOptions({ tooltip: (ctx) => `${ctx.parsed.y} min` })
  });

  makeChart('chart-avg', {
    type: 'bar',
    data: { labels, datasets: [{ data: agents.map((a) => a.avgHandleSec), backgroundColor: CC.aht, borderRadius: 3, maxBarThickness: 28 }] },
    options: baseChartOptions({ tooltip: (ctx) => secondsToMMSS(ctx.parsed.y) + ' (MM:SS)', yTick: (v) => secondsToMMSS(v) })
  });
}

/* ─── 7. EXPORT & FILE FLOW ───────────────────────────────────────────── */
async function exportToJPEG(containerId = 'export-container') {
  const container = $(containerId);
  if (!container) { setStatus('Nothing to export. Please load data first.', 'error'); return; }
  setStatus('Generating JPEG...', '');
  try {
    const canvas = await html2canvas(container, { scale: 2, backgroundColor: '#f3f5f9', logging: false, useCORS: true });
    const label = $('header-date').textContent.replace(/[\s|→]+/g, '_');
    const link = document.createElement('a');
    link.download = `incheon_dashboard_${label}.jpeg`;
    link.href = canvas.toDataURL('image/jpeg', 0.95);
    link.click();
    setStatus('JPEG exported successfully!', 'success');
    setTimeout(() => setStatus('', ''), 3000);
  } catch (err) {
    console.error('Export error:', err);
    setStatus('Failed to generate JPEG. Please try again.', 'error');
  }
}

function setStatus(msg, type = '') {
  const el = $('status-bar');
  if (!el) return;
  if (!msg) { el.textContent = ''; el.className = ''; return; }
  el.textContent = msg;
  el.className = `show ${type}`;
}

function onFileParsed(kind, file, input, res) {
  const label = kind === 'inbound' ? 'Inbound' : 'Outbound';
  const spec = CONFIG.COLUMNS[kind];
  const fields = (res.meta && res.meta.fields) || [];

  if (spec.critical.some((c) => !fields.includes(c))) {
    setStatus(`${label} file is missing critical columns.`, 'error');
    input.value = ''; return;
  }
  const prepared = prepareRows(res.data, kind);
  state[kind] = buildDataset(prepared.records, prepared.skipped, prepared.unknown, file.name);

  $(`${kind}-filename`).textContent = file.name;
  $(`${kind}-btn`).classList.add('loaded');
  setStatus(`${label} loaded: ${prepared.records.length} rows`, 'success');
}

function handleFileSelected(kind, input) {
  const file = input.files && input.files[0];
  if (!file) return;
  Papa.parse(file, {
    header: true, skipEmptyLines: true, transformHeader: (h) => h.trim(),
    complete: (res) => onFileParsed(kind, file, input, res),
    error: () => setStatus(`Failed to parse ${kind} file.`, 'error')
  });
}

function runDashboard() {
  if (!state.outbound || !state.inbound) { setStatus('Please upload both CSV files first.', 'error'); return; }
  const from = $('date-from').value;
  const to = $('date-to').value;

  try {
    const outRows = rowsInRange(state.outbound, from, to);
    const inRows = rowsInRange(state.inbound, from, to);
    if (!outRows.length && !inRows.length) { setStatus('No records found for date range.', 'error'); return; }

    const agents = buildAgents(outRows, inRows);
    const rangeSummary = summariseInbound(inRows, outRows);

    // Strictly snap to the selected 'To' date (or its nearest previous working day if it falls on an excluded day like Sunday)
    const lastDay = lastWorkingDay(to, from); 
    const dayOut = rowsOnDate(state.outbound, lastDay);
    const dayIn = rowsOnDate(state.inbound, lastDay);
    
    const daySummary = from === lastDay ? rangeSummary : summariseInbound(dayIn, dayOut);
    const dayAgents = from !== lastDay ? buildAgents(dayOut, dayIn) : null;

    renderDateBanner(from, to, outRows.length, inRows.length, agents);
    renderKPIs(rangeSummary, daySummary); // <--- KPI cards are now powered strictly by the lastDay variable
    $('agent-note').textContent = dayAgents ? `Range (${lastDay})` : 'Inbound + Outbound';
    renderAgentTable(agents, dayAgents);
    renderCharts(agents);
    renderHourlyOccupancy(inRows);
    renderHourlyComparison(lastDay);

    $('dashboard').classList.add('show');
    $('empty-state').style.display = 'none';
    $('export-btn').style.display = 'flex';
    const rangeLabel = from === to ? from : `${from} → ${to}`;
    setStatus(`Dashboard updated for ${rangeLabel}`, 'success');
    $('header-date').textContent = `Inbound | ${rangeLabel}`;
  } catch (err) { setStatus(`Something went wrong: ${err.message}`, 'error'); }
}

function init() {
  initChartDefaults();
  $('export-container').innerHTML = buildBoardHTML('');
  $('outbound-file').addEventListener('change', (e) => handleFileSelected('outbound', e.target));
  $('inbound-file').addEventListener('change', (e) => handleFileSelected('inbound', e.target));
  
  const runBtn = document.querySelector('.run-btn');
  if (runBtn) runBtn.addEventListener('click', runDashboard); 
  
  const exportBtn = $('export-btn');
  if (exportBtn) exportBtn.addEventListener('click', () => exportToJPEG());

  const t = new Date();
  const today = `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
  $('date-from').value = today;
  $('date-to').value = today;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}