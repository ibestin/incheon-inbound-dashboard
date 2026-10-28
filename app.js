/* ═══════════════════════════════════════════════════════════════════════════
   Incheon Kia — Contact Centre Dashboard
   Sections: 1 Config · 2 Utilities · 3 Data preparation · 4 Metrics
             5 Rendering · 6 Charts · 7 Export · 8 File handling & app flow
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

/* ─── 1. CONFIG (edit here; nothing else needs to change) ──────────────── */
const CONFIG = {
  ALLOWED_AGENTS: ['dhanil', 'sreerag', 'athul', 'nigel', 'sijin', 'akhil_ar', 'afthad', 'ajay'],
  INBOUND_MISSED_DISPS: ['BUSY', 'QUEUE TIMEOUT', 'NO AGENTS', 'DISCONNECTED', 'NO ANSWER'],
  EXCLUDED_GROUP: 'HYPERLOCAL',      // excluded from the abandoned-call calculation only
  ABANDONED_CUTOFF_HOUR: 18,         // last missed call at/after this hour is not counted
  DISP_ANSWERED: 'ANSWERED',
  DISP_NO_ANSWER: 'NO ANSWER',
  OCCUPANCY_HOURS: { start: 8, end: 19 },   // inclusive, shown in the hourly occupancy table
  COMPARE_HOURS: [8, 18, 19],               // hours shown in the hourly comparison table
  COMPARE_DAYS: 3,                          // last working day of the range plus the previous N-1 working days
  EXCLUDED_WEEKDAYS: [0],                   // 0 = Sunday. Rows on these days are ignored everywhere
  RATE_GOOD: 90,                            // answer rate (%) at/above which the chip is green
  RATE_WARN: 75,                            // at/above this it is amber, below it is red
  CHART_COLORS: { handled: '#C8102E', answered: '#1E8E3E', missed: '#F29900', onCall: '#1A73E8', aht: '#7E57C2' },
  COLUMNS: {
    inbound:  { critical: ['Call Date', 'Disposition'], expected: ['From', 'Group', 'Agent', 'Call Duration'] },
    outbound: { critical: ['Call Date', 'Disposition'], expected: ['To', 'Agent', 'Duration'] }
  },
  AVATAR_PALETTE: ['#C8102E', '#041E49', '#072711', '#21005D', '#410001', '#524343'],
  TOAST_MS: 3000,            // how long a toast stays visible
  TOAST_LONG_MS: 5000,       // used for messages longer than TOAST_LONG_CHARS
  TOAST_LONG_CHARS: 100,
  TOAST_MAX: 5               // oldest toast is dropped beyond this
};

const ALLOWED_AGENT_SET = new Set(CONFIG.ALLOWED_AGENTS);
const MISSED_SET = new Set(CONFIG.INBOUND_MISSED_DISPS);

/* ─── State ───────────────────────────────────────────────────────────── */
const state = {
  inbound: null,    // dataset (see buildDataset)
  outbound: null,
  agents: [],
  charts: {}
};

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

/** Parses 'YYYY-MM-DD[ HH:MM[:SS]]' or 'M/D/YYYY [HH:MM[:SS] [AM|PM]]' (month first, as before).
 *  Returns { date:'YYYY-MM-DD', hour, ts } or null when unreadable. */
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

  return {
    date: `${y}-${pad2(mo)}-${pad2(d)}`,
    hour: h,
    ts: Date.UTC(y, mo - 1, d, h, mi, se)
  };
}

/** Returns the last 10 digits of a phone number, or null when blank/invalid. */
function normalisePhone(val) {
  if (val === null || val === undefined) return null;
  let s = String(val).trim();
  if (!s || s.toUpperCase() === 'NAN') return null;

  s = s.replace(/\s*(?:extn?\.?|x|#).*$/i, '');                       // drop extensions
  if (/^\+?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(s)) {                       // 9.19E+11, 9876543210.0, +91...
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

/** True when the date falls on a weekday listed in CONFIG.EXCLUDED_WEEKDAYS (Sundays by default). */
function isExcludedDay(ymd) {
  const d = new Date(`${ymd}T00:00:00Z`);
  return !isNaN(d) && CONFIG.EXCLUDED_WEEKDAYS.includes(d.getUTCDay());
}

/** Latest non-excluded date on or before `ymd`, never going earlier than `floorYMD`. */
function lastWorkingDay(ymd, floorYMD) {
  let d = ymd;
  while (isExcludedDay(d) && d > floorYMD) d = shiftYMD(d, -1);
  return d;
}

/** The last CONFIG.COMPARE_DAYS working days ending at `toYMD` (oldest first). */
function pickCompareDays(toYMD) {
  const days = [];
  let cursor = toYMD;
  for (let guard = 0; days.length < CONFIG.COMPARE_DAYS && guard < 60; guard++) {
    if (!isExcludedDay(cursor)) days.unshift(cursor);
    cursor = shiftYMD(cursor, -1);
  }
  return days;
}

const fmtDateLong = (ymd) =>
  new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
const fmtDayShort = (ymd) =>
  new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
const fmtWeekday = (ymd) =>
  new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'long' });

const hour12 = (h) => h % 12 || 12;
const hourSuffix = (h) => (h % 24 < 12 ? 'AM' : 'PM');
const hourShort = (h) => `${hour12(h)} ${hourSuffix(h)}`;
const hourRangeLabel = (h) => `${pad2(hour12(h))}:00 – ${pad2(hour12(h))}:59 ${hourSuffix(h)}`;

function avatarColor(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return CONFIG.AVATAR_PALETTE[Math.abs(hash) % CONFIG.AVATAR_PALETTE.length];
}

function rateClass(num, den) {
  if (!(den > 0)) return 'rate-none';
  const p = (num / den) * 100;
  if (p >= CONFIG.RATE_GOOD) return 'rate-good';
  if (p >= CONFIG.RATE_WARN) return 'rate-ok';
  return 'rate-bad';
}

const pct = (num, den, digits = 2) => (den > 0 ? ((num / den) * 100).toFixed(digits) : (0).toFixed(digits));

/** Colour-coded answer-rate chip, e.g. <span class="rate rate-good">96.5%</span>. */
const rateChip = (num, den, digits = 0) =>
  `<span class="rate ${rateClass(num, den)}">${den > 0 ? pct(num, den, digits) + '%' : '—'}</span>`;

/* ─── 3. DATA PREPARATION (every row is parsed once, at upload) ───────── */
function prepareRows(rows, kind) {
  const isIn = kind === 'inbound';
  const phoneCol = isIn ? 'From' : 'To';
  const durCol = isIn ? 'Call Duration' : 'Duration';
  const records = [];
  const unknown = new Map();
  let skipped = 0;
  let excluded = 0;

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
/** Abandoned = per phone+date, the last missed call is before the cutoff hour and no
 *  later ANSWERED call exists (inbound or outbound). HYPERLOCAL inbound rows are ignored. */
function computeAbandoned(inRows, outRows) {
  const outAnsweredTs = new Map();                       // key -> latest answered outbound ts
  for (const r of outRows) {
    if (!r.phone || r.disp !== CONFIG.DISP_ANSWERED) continue;
    const key = `${r.phone}|${r.date}`;
    if (!(outAnsweredTs.get(key) >= r.ts)) outAnsweredTs.set(key, r.ts);
  }

  const perKey = new Map();                              // key -> inbound state
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
  const map = new Map(CONFIG.ALLOWED_AGENTS.map((name) =>
    [name, { name, handled: 0, answered: 0, missed: 0, onCallSec: 0 }]));

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
    name: a.name,
    totalHandled: a.handled,
    totalAnswered: a.answered,
    totalMissed: a.missed,
    totalOnCallSec: a.onCallSec,
    avgHandleSec: a.answered > 0 ? Math.round(a.onCallSec / a.answered) : 0,
    missedPercent: a.answered > 0 ? (a.missed / a.answered) * 100 : 0
  })).sort((x, y) => x.name.localeCompare(y.name));
}

/* ─── 5. RENDERING ────────────────────────────────────────────────────── */
function buildBoardHTML(sfx = '') {
  const occ = CONFIG.OCCUPANCY_HOURS;
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
        <div class="table-responsive">
          <table>
            <thead>
              <tr>
                <th>#</th><th class="left">Agent</th>
                <th class="right">Handled</th><th class="right">Answered</th>
                <th class="right">Missed (NA)</th><th class="right">Missed %</th>
                <th class="right">On-Call</th><th class="right">AHT</th>
              </tr>
            </thead>
            <tbody id="agent-tbody${sfx}"></tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">Hourly Occupancy · Inbound</div>
          <div class="card-note">${hourShort(occ.start)} – ${hourShort(occ.end + 1)}</div>
        </div>
        <div class="table-responsive">
          <table>
            <thead>
              <tr><th>Hour</th><th class="right">Inbound</th><th class="right">Answered</th><th class="right">Missed</th><th>Answer rate</th></tr>
            </thead>
            <tbody id="hourly-occupancy-tbody${sfx}"></tbody>
          </table>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">Hourly Comparison · Last ${CONFIG.COMPARE_DAYS} Days</div>
          <div class="card-note">${CONFIG.COMPARE_HOURS.map(hourShort).join(' · ')}</div>
        </div>
        <div class="table-responsive">
          <table>
            <thead>
              <tr><th>Day</th><th class="right">Handled</th><th class="right">Answered</th><th class="right">Answer %</th></tr>
            </thead>
            <tbody id="hourly-compare-tbody${sfx}"></tbody>
          </table>
        </div>
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
    { label: 'Total Inbound',    value: range.total,    today: day.total,    sub: 'All inbound records', cls: 'c1' },
    { label: 'Inbound Answered', value: range.answered, today: day.answered, sub: `Rate ${pct(range.answered, range.total)}%`, cls: 'c2' },
    { label: 'Abandoned (≤6PM)', value: range.abandoned, today: day.abandoned, sub: 'Missed & no resolution', cls: 'c3' },
    { label: 'Abandoned %',      value: `${range.abandonedPct}%`, today: `${day.abandonedPct}%`, sub: 'of total inbound', cls: 'c4' },
    { label: 'Inbound Missed',   value: range.missedNoAnswer, today: day.missedNoAnswer, sub: 'NO ANSWER rings', cls: 'c5' }
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
    return `<tr${a.totalHandled === 0 ? ' class="is-away"' : ''}>
      <td class="num" style="color:var(--md-text-variant);">${idx + 1}</td>
      <td class="left"><div class="agent-name"><div class="agent-avatar" style="background:${avatarColor(a.name)}">${a.name.substring(0, 2)}</div>${a.name}${a.totalHandled === 0 ? '<span class="ab-badge">AB</span>' : ''}</div></td>
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
    const barWidth = maxInbound > 0 ? Math.round((d.inbound / maxInbound) * 100) : 0;
    html += `<tr>
      <td class="hour-col">${pad2(h)}:00</td>
      <td class="right">${d.inbound}</td>
      <td class="right">${d.answered}</td>
      <td class="right">${d.missed > 0 ? `<span class="warn">${d.missed}</span>` : '0'}</td>
      <td><div class="rate-wrap"><span class="bar-track" title="Bar = share of the busiest hour"><span class="bar-fill" style="width:${barWidth}%"></span></span>${rateChip(d.answered, d.inbound)}</div></td>
    </tr>`;
  }
  $('hourly-occupancy-tbody' + sfx).innerHTML =
    html || '<tr><td colspan="5" class="muted-cell">No inbound calls in selected range</td></tr>';
}

function renderHourlyComparison(toVal, sfx = '') {
  const days = pickCompareDays(toVal);

  const stats = new Map();   // date -> hour -> {handled, answered}
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
    html += `<tr class="sub-row"><td colspan="4">${hourRangeLabel(h)}</td></tr>`;
    for (const day of days) {
      const v = stats.get(day).get(h);
      html += `<tr${day === days[days.length - 1] ? ' class="cmp-last"' : ''}>
        <td class="hour-col">${fmtDayShort(day)}</td>
        <td class="right">${v.handled}</td>
        <td class="right">${v.answered}</td>
        <td class="right">${rateChip(v.answered, v.handled, 1)}</td>
      </tr>`;
    }
  }
  $('hourly-compare-tbody' + sfx).innerHTML = html;
}

/* ─── 6. CHARTS ───────────────────────────────────────────────────────── */
function initChartDefaults() {
  Chart.defaults.font.family = "'Inter', sans-serif";
  Chart.defaults.font.size = 11;
  Chart.defaults.font.weight = '600';
  Chart.defaults.color = '#524343';
}

function baseChartOptions(opts = {}) {
  return {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: { display: !!opts.legend, position: 'top', align: 'end', labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, font: { family: 'Inter', size: 11, weight: '600' } } },
      tooltip: { backgroundColor: '#201A1A', titleColor: '#FFFFFF', bodyColor: '#F4EDED', padding: 12, cornerRadius: 12, callbacks: opts.tooltip ? { label: opts.tooltip } : {} }
    },
    scales: {
      x: { grid: { display: false }, border: { display: false } },
      y: { grid: { color: '#F0E8E8' }, ticks: { callback: opts.yTick || undefined }, border: { display: false }, beginAtZero: true }
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
        { label: 'Handled',  data: agents.map((a) => a.totalHandled),  backgroundColor: CC.handled,  borderRadius: 6, borderSkipped: false, maxBarThickness: 22 },
        { label: 'Answered', data: agents.map((a) => a.totalAnswered), backgroundColor: CC.answered, borderRadius: 6, borderSkipped: false, maxBarThickness: 22 },
        { label: 'Missed',   data: agents.map((a) => a.totalMissed),   backgroundColor: CC.missed,   borderRadius: 6, borderSkipped: false, maxBarThickness: 22 }
      ]
    },
    options: baseChartOptions({ legend: true })
  });

  makeChart('chart-oncall', {
    type: 'bar',
    data: { labels, datasets: [{ data: agents.map((a) => parseFloat((a.totalOnCallSec / 60).toFixed(1))), backgroundColor: CC.onCall, borderRadius: 6, borderSkipped: false, maxBarThickness: 30 }] },
    options: baseChartOptions({ tooltip: (ctx) => `${ctx.parsed.y} min` })
  });

  makeChart('chart-avg', {
    type: 'bar',
    data: { labels, datasets: [{ data: agents.map((a) => a.avgHandleSec), backgroundColor: CC.aht, borderRadius: 6, borderSkipped: false, maxBarThickness: 30 }] },
    options: baseChartOptions({
      tooltip: (ctx) => secondsToMMSS(ctx.parsed.y) + ' (MM:SS)',
      yTick: (v) => secondsToMMSS(v)
    })
  });
}

/* ─── 7. EXPORT ───────────────────────────────────────────────────────── */
async function exportToJPEG(containerId = 'export-container') {
  const container = $(containerId);
  if (!container) { showToast('Nothing to export.', 'error'); return; }
  if (typeof html2canvas === 'undefined') { showToast('Export library failed to load. Check your internet connection.', 'error'); return; }
  showToast('Generating JPEG...', '');
  try {
    const canvas = await html2canvas(container, { scale: 2, backgroundColor: '#FCF8F8', logging: false, useCORS: true });
    const label = $('header-date').textContent.replace(/[^\w-]+/g, '_');
    const link = document.createElement('a');
    link.download = `incheon_dashboard_${label}.jpeg`;
    link.href = canvas.toDataURL('image/jpeg', 0.95);
    link.click();
    showToast('JPEG exported successfully!', 'success');
  } catch (err) {
    console.error('Export error:', err);
    showToast('Failed to generate JPEG. Please try again.', 'error');
  }
}

/* ─── 8. FILE HANDLING & APP FLOW ─────────────────────────────────────── */
/** Shows a short-lived message. type: 'success' | 'error' | 'warn' | '' (neutral).
 *  Hover pauses the timer; click dismisses. */
function showToast(msg, type = '') {
  if (!msg) return;
  const box = $('toast-container');
  if (!box) return;

  const el = document.createElement('div');
  el.className = `toast ${type}`.trim();
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.textContent = msg;              // textContent: CSV-derived text is never parsed as HTML
  box.appendChild(el);
  while (box.children.length > CONFIG.TOAST_MAX) box.removeChild(box.firstChild);
  requestAnimationFrame(() => el.classList.add('show'));

  const life = msg.length > CONFIG.TOAST_LONG_CHARS ? CONFIG.TOAST_LONG_MS : CONFIG.TOAST_MS;
  let timer = null;
  const hide = () => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); };
  const start = () => { clearTimeout(timer); timer = setTimeout(hide, life); };
  el.addEventListener('mouseenter', () => clearTimeout(timer));
  el.addEventListener('mouseleave', start);
  el.addEventListener('click', () => { clearTimeout(timer); hide(); });
  start();
}

function describeUnknownAgents(unknown) {
  const top = [...unknown.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const text = top.map(([name, n]) => `${name} (${n})`).join(', ');
  return unknown.size > top.length ? `${text}, +${unknown.size - top.length} more` : text;
}

function onFileParsed(kind, file, input, res) {
  const label = kind === 'inbound' ? 'Inbound' : 'Outbound';
  const spec = CONFIG.COLUMNS[kind];
  const fields = (res.meta && res.meta.fields) || [];

  const missingCritical = spec.critical.filter((c) => !fields.includes(c));
  if (missingCritical.length) {
    showToast(`${label} file is missing required column(s): ${missingCritical.join(', ')}. Columns found: ${fields.join(', ') || 'none'}.`, 'error');
    input.value = '';
    return;
  }
  if (!res.data.length) {
    showToast(`${label} file has no data rows.`, 'error');
    input.value = '';
    return;
  }

  const prepared = prepareRows(res.data, kind);
  if (!prepared.records.length) {
    showToast(prepared.excluded
      ? `${label} file has only Sunday rows, which are excluded.`
      : `${label} file has no rows with a readable Call Date.`, 'error');
    input.value = '';
    return;
  }

  const notices = [];
  const missingExpected = spec.expected.filter((c) => !fields.includes(c));
  if (missingExpected.length) notices.push(`${label}: column(s) not found — ${missingExpected.join(', ')}. Related figures may be zero or incomplete.`);
  if (prepared.excluded) notices.push(`${label}: ${prepared.excluded} Sunday row(s) excluded from all calculations.`);
  if (prepared.skipped) notices.push(`${label}: ${prepared.skipped} row(s) skipped because the Call Date could not be read.`);
  if (prepared.unknown.size) {
    const n = [...prepared.unknown.values()].reduce((a, b) => a + b, 0);
    notices.push(`${label}: ${n} call(s) by agents not in the allowed list are left out of the agent table — ${describeUnknownAgents(prepared.unknown)}.`);
  }

  state[kind] = buildDataset(prepared.records, prepared.skipped, prepared.unknown, file.name);

  $(`${kind}-filename`).textContent = file.name;
  $(`${kind}-btn`).classList.add('loaded');
  showToast(`${label} loaded: ${prepared.records.length} rows`, 'success');
  notices.forEach((n) => showToast(n, 'warn'));
}

function handleFileSelected(kind, input) {
  const file = input.files && input.files[0];
  if (!file) return;
  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
    complete: (res) => {
      try { onFileParsed(kind, file, input, res); }
      catch (err) { console.error(err); showToast(`Could not process the ${kind} file: ${err.message}`, 'error'); }
    },
    error: () => showToast(`Failed to parse ${kind} file.`, 'error')
  });
}

function runDashboard() {
  if (!state.outbound || !state.inbound) {
    showToast('Please upload both Outbound and Inbound CSV files first.', 'error');
    return;
  }
  const from = $('date-from').value;
  const to = $('date-to').value;
  if (!from || !to) { showToast('Please select both From and To dates.', 'error'); return; }
  if (from > to) { showToast('From date cannot be after To date.', 'error'); return; }

  try {
    const outRows = rowsInRange(state.outbound, from, to);
    const inRows = rowsInRange(state.inbound, from, to);
    if (!outRows.length && !inRows.length) {
      showToast('No records found for the selected date range (Sundays are excluded). Try different dates.', 'error');
      return;
    }

    const agents = buildAgents(outRows, inRows);
    state.agents = agents;

    const rangeSummary = summariseInbound(inRows, outRows);
    const lastDay = lastWorkingDay(to, from);   // the 'To' date, or the nearest working day before it
    const dayOut = rowsOnDate(state.outbound, lastDay);
    const dayIn = rowsOnDate(state.inbound, lastDay);
    const daySummary = from === lastDay ? rangeSummary : summariseInbound(dayIn, dayOut);
    const dayAgents = from !== lastDay ? buildAgents(dayOut, dayIn) : null;

    renderDateBanner(from, to, outRows.length, inRows.length, agents);
    renderKPIs(rangeSummary, daySummary);
    $('agent-note').textContent = dayAgents ? `Range (${lastDay})` : 'Inbound + Outbound';
    renderAgentTable(agents, dayAgents);
    renderCharts(agents);
    renderHourlyOccupancy(inRows);
    renderHourlyComparison(lastDay);

    $('dashboard').classList.add('show');
    $('empty-state').style.display = 'none';
    $('export-btn').style.display = 'flex';

    const rangeLabel = from === to ? from : `${from} → ${to}`;
    showToast(`Dashboard updated for ${rangeLabel}`, 'success');
    $('header-date').textContent = `Inbound | ${rangeLabel}`;
  } catch (err) {
    console.error(err);
    showToast(`Something went wrong while building the dashboard: ${err.message}`, 'error');
  }
}

function init() {
  const missingLibs = [['Papa', 'PapaParse'], ['Chart', 'Chart.js']]
    .filter(([g]) => typeof window[g] === 'undefined').map(([, n]) => n);
  if (missingLibs.length) {
    showToast(`Required library failed to load (${missingLibs.join(', ')}). Check your internet connection and reload.`, 'error');
    return;
  }
  initChartDefaults();

  $('export-container').innerHTML = buildBoardHTML('');

  $('outbound-file').addEventListener('change', (e) => handleFileSelected('outbound', e.target));
  $('inbound-file').addEventListener('change', (e) => handleFileSelected('inbound', e.target));
  $('apply-btn').addEventListener('click', runDashboard);
  $('export-btn').addEventListener('click', () => exportToJPEG());

  const t = new Date();
  const today = `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;
  $('date-from').value = today;
  $('date-to').value = today;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
}

// Lets the pure logic be tested in Node; harmless in the browser.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseDateTime, normalisePhone, parseDuration, prepareRows, computeAbandoned, summariseInbound, buildAgents, computeHourly, shiftYMD, isExcludedDay, lastWorkingDay, pickCompareDays, rateClass, CONFIG };
}
