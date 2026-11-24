/* ═══════════════════════════════════════════════════════════════════════════
   Incheon Kia — Contact Centre Dashboard
   ═══════════════════════════════════════════════════════════════════════════ */
'use strict';

/* ─── 1. CONFIG ───────────────────────────────────────────────────────── */

const CONFIG = {
  ALLOWED_AGENTS: ['dhanil', 'sreerag', 'athul', 'nigel', 'sijin', 'akhil_ar', 'afthad'],
  INBOUND_MISSED_DISPS: ['BUSY', 'QUEUE TIMEOUT', 'NO AGENTS', 'DISCONNECTED', 'NO ANSWER'],
  EXCLUDED_GROUP: 'HYPERLOCAL',
  EXCLUDED_PHONE_PREFIXES: ['9179470'],
  ABANDONED_CUTOFF_HOUR: 18,
  DISP_ANSWERED: 'ANSWERED',
  DISP_NO_ANSWER: 'NO ANSWER',
  OCCUPANCY_HOURS: { start: 8, end: 19 },
  COMPARE_HOURS: [8, 18, 19],
  COMPARE_DAYS: 3,
  EXCLUDED_WEEKDAYS: [0],

  CHART_COLORS: {
    handled: '#c8102e',
    answered: '#16a34a',
    missed: '#d97706',
    onCall: '#2563eb',
    aht: '#7c3aed'
  },

  COLUMNS: {
    inbound: {
      critical: ['Call Date', 'Disposition'],
      expected: ['From', 'Group', 'Agent', 'Call Duration']
    },
    outbound: {
      critical: ['Call Date', 'Disposition'],
      expected: ['To', 'Agent', 'Duration']
    },
    status: {
      critical: ['Agent', 'Status', 'Time', 'Total Duration'],
      expected: []
    }
  },

  /* Agent Status Time table (detailed agent performance report) ------------
     STATUS_COLUMNS : table columns, in display order
                      kind 'time'  -> total time in that status
                      kind 'avg'   -> total time / agent's answered calls on the
                                      status file's date; denom lists which call
                                      files count (['inbound'] or
                                      ['inbound', 'outbound'])
                                      (highlight: true adds red / amber dots
                                       for the highest / 2nd highest agent)
                      kind 'count' -> a count (key must be filled in code)
     STATUS_MAP     : raw Status value (upper-case) -> time bucket key
     STATUS_IGNORED : raw Status values deliberately not tracked
     LONG_PAUSE_SEC : a PAUSED row longer than this counts as a long pause
     Any other status seen for a tracked agent is reported in the status bar. */
  STATUS_COLUMNS: [
    { key: 'ringing',   label: 'Avg Ringing',        kind: 'avg', highlight: true, denom: ['inbound'] },
    { key: 'closure',   label: 'Avg Closure',        kind: 'avg', highlight: true, denom: ['inbound', 'outbound'] },
    { key: 'paused',    label: 'Paused',             kind: 'time' },
    { key: 'longPause', label: 'Long Pauses (>10m)', kind: 'count' },
    { key: 'break',     label: 'Break',              kind: 'time' },
    { key: 'available', label: 'Available',          kind: 'time' }
  ],
  STATUS_MAP: {
    RINGING: 'ringing',
    AVAILABLE: 'available',
    PAUSED: 'paused',
    PAUSE: 'paused',
    BREAK: 'break',
    CLOSURE: 'closure'
  },
  STATUS_IGNORED: ['DIALING', 'UNAVAILABLE', 'DISCONNECTED', 'ONCALL', 'ONOCALL'],
  LONG_PAUSE_SEC: 600,

  TOAST_MS: 1000,
  TOAST_ERROR_MS: 4000
};

const ALLOWED_AGENT_SET = new Set(CONFIG.ALLOWED_AGENTS);
const MISSED_SET = new Set(CONFIG.INBOUND_MISSED_DISPS);
const STATUS_LOOKUP = new Map(Object.entries(CONFIG.STATUS_MAP));
const STATUS_IGNORED_SET = new Set(CONFIG.STATUS_IGNORED);

const state = {
  inbound: null,
  outbound: null,
  status: null,
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

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }

  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }

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

function secondsToHMS(s) {
  if (!s || isNaN(s)) return '00:00:00';

  const total = Math.round(s);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;

  return `${pad2(h)}:${pad2(m)}:${pad2(sec)}`;
}

/* ─── DATE PARSING ────────────────────────────────────────────────────── */

const RE_ISO = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/;

const RE_MDY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?/;

function parseDateTime(raw) {
  if (raw === null || raw === undefined) return null;

  const s = String(raw).trim();
  if (!s) return null;

  let y, mo, d, h = 0, mi = 0, se = 0, ampm = null;

  let m = s.match(RE_ISO);

  if (m) {
    y = +m[1];
    mo = +m[2];
    d = +m[3];
    h = +(m[4] || 0);
    mi = +(m[5] || 0);
    se = +(m[6] || 0);
  } else {
    m = s.match(RE_MDY);

    if (!m) return null;

    mo = +m[1];
    d = +m[2];
    y = +m[3];
    h = +(m[4] || 0);
    mi = +(m[5] || 0);
    se = +(m[6] || 0);
    ampm = m[7] ? m[7].toUpperCase() : null;
  }

  if (ampm) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (ampm === 'PM' ? 12 : 0);
  }

  if (
    mo < 1 || mo > 12 ||
    d < 1 || d > 31 ||
    h > 23 || mi > 59 || se > 59
  ) return null;

  return {
    date: `${y}-${pad2(mo)}-${pad2(d)}`,
    hour: h,
    ts: Date.UTC(y, mo - 1, d, h, mi, se)
  };
}

/* ─── PHONE NUMBER EXCLUSION ─────────────────────────────────────────── */

/**
 * Returns true if a phone number starts with any configured excluded prefix.
 *
 * Works with:
 * 917947066318
 * +917947060533
 * +91 79470 60533
 * 91-79470-60533
 *
 * Filtering happens BEFORE normalisePhone() removes the country code.
 */

function isExcludedPhone(val) {
  if (val === null || val === undefined) return false;

  let raw = String(val).trim();

  if (!raw || raw.toUpperCase() === 'NAN') return false;

  // Remove extension information
  raw = raw.replace(/\s*(?:extn?\.?|x|#).*$/i, '');

  let digits;

  // Handle numeric values and scientific notation
  if (/^\+?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(raw)) {
    digits = String(Math.round(Number(raw)));
  } else {
    digits = raw.replace(/\D/g, '');
  }

  if (!digits || digits === '0') return false;

  return CONFIG.EXCLUDED_PHONE_PREFIXES.some(prefix =>
    digits.startsWith(prefix)
  );
}

/* ─── PHONE NORMALISATION ────────────────────────────────────────────── */

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

/* ─── DATE UTILITIES ─────────────────────────────────────────────────── */

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

  while (isExcludedDay(d) && d > floorYMD) {
    d = shiftYMD(d, -1);
  }

  return d;
}

function pickCompareDays(toYMD) {
  const days = [];
  let cursor = toYMD;

  for (
    let guard = 0;
    days.length < CONFIG.COMPARE_DAYS && guard < 60;
    guard++
  ) {
    if (!isExcludedDay(cursor)) days.unshift(cursor);
    cursor = shiftYMD(cursor, -1);
  }

  return days;
}

const fmtDateLong = (ymd) =>
  new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-IN', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });

const fmtDayShort = (ymd) =>
  new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-IN', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short'
  });

const fmtWeekday = (ymd) =>
  new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-IN', {
    timeZone: 'UTC',
    weekday: 'long'
  });

function avatarColor(name) {
  const palette = [
    '#c8102e', '#2563eb', '#16a34a', '#ea580c',
    '#7c3aed', '#0d9488', '#d97706', '#db2777',
    '#475569', '#0284c7'
  ];

  let hash = 0;

  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }

  return palette[Math.abs(hash) % palette.length];
}

const pct = (num, den, digits = 2) =>
  den > 0 ? ((num / den) * 100).toFixed(digits) : (0).toFixed(digits);


/* ─── 3. DATA PREPARATION ─────────────────────────────────────────────── */

function prepareRows(rows, kind) {
  const isIn = kind === 'inbound';

  const phoneCol = isIn ? 'From' : 'To';
  const durCol = isIn ? 'Call Duration' : 'Duration';

  const records = [];
  const unknown = new Map();

  let skipped = 0;
  let excluded = 0;
  let excludedPhones = 0;

  for (const r of rows) {

    // EXCLUSION: Remove configured phone prefixes from both datasets
    // This must happen before phone number normalisation.

    if (isExcludedPhone(r[phoneCol])) {
      excludedPhones++;
      continue;
    }

    const dt = parseDateTime(r['Call Date']);

    if (!dt) {
      skipped++;
      continue;
    }

    // Existing Sunday exclusion
    if (isExcludedDay(dt.date)) {
      excluded++;
      continue;
    }

    const disp = String(r['Disposition'] ?? '').trim().toUpperCase();
    const agent = String(r['Agent'] ?? '').trim().toLowerCase();

    const rec = {
      date: dt.date,
      hour: dt.hour,
      ts: dt.ts,
      disp,
      agent,
      phone: normalisePhone(r[phoneCol]),
      durSec: disp === CONFIG.DISP_ANSWERED
        ? parseDuration(r[durCol])
        : 0
    };

    if (isIn) {
      rec.group = String(r['Group'] ?? '').trim().toUpperCase();
    }

    if (agent && !ALLOWED_AGENT_SET.has(agent)) {
      unknown.set(agent, (unknown.get(agent) || 0) + 1);
    }

    records.push(rec);
  }

  return {
    records,
    skipped,
    unknown,
    excluded,
    excludedPhones
  };
}

function buildDataset(records, skipped, unknown, fileName) {
  const byDate = new Map();

  for (const r of records) {
    let bucket = byDate.get(r.date);

    if (!bucket) {
      bucket = [];
      byDate.set(r.date, bucket);
    }

    bucket.push(r);
  }

  return {
    records,
    byDate,
    dates: [...byDate.keys()].sort(),
    skipped,
    unknown,
    fileName
  };
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

/**
 * The agent status report uses DD/MM/YYYY HH:MM:SS (the call reports use
 * MM/DD/YYYY), so it gets its own date reader. ISO dates are also accepted.
 * Returns 'YYYY-MM-DD' or null.
 */
function parseStatusDate(raw) {
  if (raw === null || raw === undefined) return null;

  const s = String(raw).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);

  if (m) {
    const d = +m[1];
    const mo = +m[2];
    const y = +m[3];

    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;

    return `${y}-${pad2(mo)}-${pad2(d)}`;
  }

  const iso = parseDateTime(s);

  return iso ? iso.date : null;
}

/**
 * Agent status report (single-day file).
 * Sums "Total Duration" per tracked agent per status column.
 * - Extension-number rows and any non-tracked agents are dropped.
 * - Missing / malformed durations count as 0.
 * - Statuses outside STATUS_MAP / STATUS_IGNORED are collected in `unknown`.
 * The whole file is summed; the date range selector does not apply.
 */
function prepareStatusRows(rows) {
  const keys = CONFIG.STATUS_COLUMNS.map((c) => c.key);
  const totals = new Map(
    CONFIG.ALLOWED_AGENTS.map((name) => {
      const rec = { name, rows: 0 };
      keys.forEach((k) => { rec[k] = 0; });
      return [name, rec];
    })
  );

  const dates = new Set();
  const unknown = new Map();

  let used = 0;
  let otherAgents = 0;
  let ignored = 0;

  for (const r of rows) {
    const agent = String(r['Agent'] ?? '').trim().toLowerCase();
    const rec = totals.get(agent);

    if (!rec) {
      otherAgents++;
      continue;
    }

    const st = String(r['Status'] ?? '').trim().toUpperCase();
    const key = STATUS_LOOKUP.get(st);

    if (!key) {
      if (STATUS_IGNORED_SET.has(st)) {
        ignored++;
      } else if (st) {
        unknown.set(st, (unknown.get(st) || 0) + 1);
      }
      continue;
    }

    const dur = parseDuration(r['Total Duration']);

    rec[key] += dur;
    rec.rows++;
    used++;

    if (key === 'paused' && dur > CONFIG.LONG_PAUSE_SEC) {
      rec.longPause++;
    }

    const day = parseStatusDate(r['Time']);
    if (day) dates.add(day);
  }

  const sortedDates = [...dates].sort();

  let dateLabel = 'Date n/a';

  if (sortedDates.length === 1) {
    dateLabel = fmtDateLong(sortedDates[0]);
  } else if (sortedDates.length > 1) {
    dateLabel = `${fmtDateLong(sortedDates[0])} → ${fmtDateLong(sortedDates[sortedDates.length - 1])}`;
  }

  return {
    totals,
    unknown,
    used,
    otherAgents,
    ignored,
    dateLabel,
    dates: sortedDates,
    multiDate: sortedDates.length > 1
  };
}


/* ─── 4. METRICS ──────────────────────────────────────────────────────── */

function computeAbandoned(inRows, outRows) {
  const outAnsweredTs = new Map();

  for (const r of outRows) {
    if (!r.phone || r.disp !== CONFIG.DISP_ANSWERED) continue;

    const key = `${r.phone}|${r.date}`;

    if (!(outAnsweredTs.get(key) >= r.ts)) {
      outAnsweredTs.set(key, r.ts);
    }
  }

  const perKey = new Map();

  for (const r of inRows) {
    if (!r.phone || r.group === CONFIG.EXCLUDED_GROUP) continue;

    const key = `${r.phone}|${r.date}`;

    let s = perKey.get(key);

    if (!s) {
      s = {
        lastMissed: -Infinity,
        lastMissedHour: 0,
        lastAnswered: -Infinity
      };

      perKey.set(key, s);
    }

    if (MISSED_SET.has(r.disp)) {
      if (r.ts > s.lastMissed) {
        s.lastMissed = r.ts;
        s.lastMissedHour = r.hour;
      }
    } else if (
      r.disp === CONFIG.DISP_ANSWERED &&
      r.ts > s.lastAnswered
    ) {
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
  let answered = 0;
  let missedNoAnswer = 0;

  for (const r of inRows) {
    if (r.disp === CONFIG.DISP_ANSWERED) answered++;
    else if (r.disp === CONFIG.DISP_NO_ANSWER) missedNoAnswer++;
  }

  const total = inRows.length;
  const abandoned = computeAbandoned(inRows, outRows);

  return {
    total,
    answered,
    missedNoAnswer,
    abandoned,
    abandonedPct: pct(abandoned, total)
  };
}

function computeHourly(inRows) {
  const hours = Array.from(
    { length: 24 },
    () => ({ inbound: 0, answered: 0, missed: 0 })
  );

  for (const r of inRows) {
    const h = hours[r.hour];

    h.inbound++;

    if (r.disp === CONFIG.DISP_ANSWERED) {
      h.answered++;
    } else if (r.disp === CONFIG.DISP_NO_ANSWER) {
      h.missed++;
    }
  }

  return hours;
}

function buildAgents(outRows, inRows) {
  const map = new Map(
    CONFIG.ALLOWED_AGENTS.map((name) => [
      name,
      {
        name,
        handled: 0,
        answered: 0,
        missed: 0,
        onCallSec: 0
      }
    ])
  );

  for (const r of outRows) {
    const a = map.get(r.agent);
    if (!a) continue;

    a.handled++;

    if (r.disp === CONFIG.DISP_ANSWERED) {
      a.answered++;
      a.onCallSec += r.durSec;
    }
  }

  for (const r of inRows) {
    const a = map.get(r.agent);
    if (!a) continue;

    a.handled++;

    if (r.disp === CONFIG.DISP_ANSWERED) {
      a.answered++;
      a.onCallSec += r.durSec;
    } else if (r.disp === CONFIG.DISP_NO_ANSWER) {
      a.missed++;
    }
  }

  return [...map.values()].map((a) => ({
    name: a.name,
    totalHandled: a.handled,
    totalAnswered: a.answered,
    totalMissed: a.missed,
    totalOnCallSec: a.onCallSec,
    avgHandleSec: a.answered > 0
      ? Math.round(a.onCallSec / a.answered)
      : 0,
    missedPercent: a.answered > 0
      ? (a.missed / a.answered) * 100
      : 0
  })).sort((x, y) => x.name.localeCompare(y.name));
}


/* ─── 5. RENDERING ────────────────────────────────────────────────────── */

function buildBoardHTML(sfx = '') {
  const statusHeaders = CONFIG.STATUS_COLUMNS
    .map((c) => `<th class="right">${c.label}</th>`)
    .join('');

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
              <th>#</th>
              <th>Agent</th>
              <th class="right">Handled</th>
              <th class="right">Answered</th>
              <th class="right">Missed (NA)</th>
              <th class="right">Missed %</th>
              <th class="right">On-Call</th>
              <th class="right">Avg Handle</th>
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
            <tr>
              <th>Hour</th>
              <th class="right">Inbound</th>
              <th class="right">Answered</th>
              <th class="right">Missed</th>
              <th>Answer rate</th>
            </tr>
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
            <tr>
              <th>Day</th>
              <th class="right">Handled</th>
              <th class="right">Answered</th>
              <th class="right">Answer %</th>
            </tr>
          </thead>

          <tbody id="hourly-compare-tbody${sfx}"></tbody>
        </table>
      </div>

    </div>

    <div class="status-card-wrap" id="status-card-wrap${sfx}" style="display:none;">
      <div class="card">
        <div class="card-header">
          <div class="card-title">Agent Status Time</div>
          <div class="card-note" id="status-note${sfx}">—</div>
        </div>

        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Agent</th>
              ${statusHeaders}
            </tr>
          </thead>

          <tbody id="status-tbody${sfx}"></tbody>
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
    {
      label: 'Total Inbound Calls',
      value: range.total,
      today: day.total,
      sub: 'All inbound records',
      cls: 'c1'
    },
    {
      label: 'Inbound Answered',
      value: range.answered,
      today: day.answered,
      sub: `Answer rate ${pct(range.answered, range.total)}%`,
      cls: 'c2'
    },
    {
      label: 'Abandoned Calls (≤6PM rule)',
      value: range.abandoned,
      today: day.abandoned,
      sub: 'Last missed <6PM & no resolution',
      cls: 'c3'
    },
    {
      label: 'Abandoned %',
      value: `${range.abandonedPct}%`,
      today: `${day.abandonedPct}%`,
      sub: `of total inbound (${range.abandoned}/${range.total})`,
      cls: 'c4'
    },
    {
      label: 'Inbound Missed (NO ANSWER)',
      value: range.missedNoAnswer,
      today: day.missedNoAnswer,
      sub: 'Rang but not picked',
      cls: 'c5'
    }
  ];

  $('kpi-strip' + sfx).innerHTML = cards.map((c) => `
    <div class="kpi-card ${c.cls}">
      <div class="kpi-label">${c.label}</div>
      <div class="kpi-main">
        <div class="kpi-value">${c.value}</div>
        <span class="kpi-today">(${c.today})</span>
      </div>
      <div class="kpi-sub">${c.sub}</div>
    </div>
  `).join('');
}

function renderAgentTable(agents, dayAgents, sfx = '') {
  const maxHandled = Math.max(
    ...agents.map((a) => a.totalHandled),
    1
  );

  const dayByName = new Map(
    (dayAgents || []).map((d) => [d.name, d])
  );

  const empty = {
    totalHandled: 0,
    totalAnswered: 0,
    totalMissed: 0,
    missedPercent: 0,
    totalOnCallSec: 0,
    avgHandleSec: 0
  };

  const br = (v) =>
    dayAgents ? `<span class="br">(${v})</span>` : '';

  $('agent-tbody' + sfx).innerHTML = agents.map((a, idx) => {
    const d = dayByName.get(a.name) || empty;
    const barW = Math.round((a.totalHandled / maxHandled) * 50);

    return `
      <tr>
        <td class="num" style="color:var(--text-dim);">${idx + 1}</td>

        <td>
          <div class="agent-name">
            <div class="agent-avatar" style="background:${avatarColor(a.name)}">
              ${a.name.substring(0, 2)}
            </div>
            ${a.name}
            ${a.totalHandled === 0 ? '<span class="ab-badge">AB</span>' : ''}
          </div>
        </td>

        <td class="right">
          <div class="bar-cell">
            <span class="stack">
              <span>${a.totalHandled}</span>
              ${br(d.totalHandled)}
            </span>
            <div class="mini-bar" style="width:${barW}px"></div>
          </div>
        </td>

        <td class="right">${a.totalAnswered}${br(d.totalAnswered)}</td>

        <td class="right">
          ${a.totalMissed > 0
            ? `<span class="warn">${a.totalMissed}</span>`
            : '0'}
          ${br(d.totalMissed)}
        </td>

        <td class="right">
          ${a.missedPercent.toFixed(2)}%
          ${br(d.missedPercent.toFixed(2) + '%')}
        </td>

        <td class="right">
          ${secondsToHHMM(a.totalOnCallSec)}
          ${br(secondsToHHMM(d.totalOnCallSec))}
        </td>

        <td class="right">
          ${a.avgHandleSec > 0 ? secondsToMMSS(a.avgHandleSec) : '—'}
          ${br(d.avgHandleSec > 0 ? secondsToMMSS(d.avgHandleSec) : '—')}
        </td>
      </tr>`;
  }).join('');
}

/**
 * Answered calls per tracked agent on the given dates, counted from the listed
 * call files (e.g. ['inbound'] or ['inbound', 'outbound']).
 * Returns null when any listed file is not loaded.
 */
function answeredByAgent(dates, sources) {
  if (sources.some((src) => !state[src])) return null;

  const counts = new Map(CONFIG.ALLOWED_AGENTS.map((n) => [n, 0]));

  for (const src of sources) {
    for (const d of dates) {
      for (const r of rowsOnDate(state[src], d)) {
        if (r.disp !== CONFIG.DISP_ANSWERED) continue;

        if (counts.has(r.agent)) {
          counts.set(r.agent, counts.get(r.agent) + 1);
        }
      }
    }
  }

  return counts;
}

/**
 * Rank positive values (highest first, ties share a rank).
 * Returns Map(name -> 'red' | 'amber') for the top two distinct values.
 */
function rankDots(valuesByName) {
  const distinct = [...new Set(
    [...valuesByName.values()].filter((v) => v !== null && v > 0)
  )].sort((x, y) => y - x);

  const out = new Map();

  valuesByName.forEach((v, name) => {
    if (v === null || v <= 0) return;

    if (v === distinct[0]) out.set(name, 'red');
    else if (v === distinct[1]) out.set(name, 'amber');
  });

  return out;
}

function renderStatusTable(sfx = '') {
  const wrap = $('status-card-wrap' + sfx);

  if (!wrap) return;

  if (!state.status) {
    wrap.style.display = 'none';
    return;
  }

  const cols = CONFIG.STATUS_COLUMNS;

  const agents = [...state.status.totals.values()]
    .sort((x, y) => x.name.localeCompare(y.name));

  const statusDates = state.status.dates || [];

  // Per-agent average (seconds) for every 'avg' column; null = not available
  const avgs = new Map();
  const dots = new Map();

  let missingCalls = false;

  cols.filter((c) => c.kind === 'avg').forEach((c) => {
    const byName = new Map();
    const answered = answeredByAgent(statusDates, c.denom);

    if (!answered) missingCalls = true;

    agents.forEach((a) => {
      const n = answered ? answered.get(a.name) || 0 : 0;

      byName.set(a.name, n > 0 ? a[c.key] / n : null);
    });

    avgs.set(c.key, byName);

    if (c.highlight) dots.set(c.key, rankDots(byName));
  });

  $('status-note' + sfx).textContent = missingCalls
    ? `${state.status.dateLabel} · Load inbound & outbound CSV for averages`
    : `${state.status.dateLabel} · Ringing ÷ inbound answered · Closure ÷ in+out answered`;

  $('status-tbody' + sfx).innerHTML = agents.map((a, idx) => {
    const hasData = a.rows > 0;

    const cells = cols.map((c) => {
      let body;

      if (c.kind === 'avg') {
        const v = avgs.get(c.key).get(a.name);
        const dot = dots.has(c.key) ? dots.get(c.key).get(a.name) : null;

        body = v === null
          ? '<span class="zero">—</span>'
          : `${dot ? `<span class="rank-dot ${dot}"></span>` : ''}${secondsToHMS(v)}`;
      } else if (c.kind === 'count') {
        body = a[c.key] > 0
          ? `<span class="warn">${a[c.key]}</span>`
          : '<span class="zero">0</span>';
      } else {
        body = a[c.key] > 0
          ? secondsToHMS(a[c.key])
          : `<span class="zero">${secondsToHMS(0)}</span>`;
      }

      return `<td class="right">${body}</td>`;
    }).join('');

    return `
      <tr>
        <td class="num" style="color:var(--text-dim);">${idx + 1}</td>

        <td>
          <div class="agent-name">
            <div class="agent-avatar" style="background:${avatarColor(a.name)}">
              ${a.name.substring(0, 2)}
            </div>
            ${a.name}
            ${hasData ? '' : '<span class="ab-badge">AB</span>'}
          </div>
        </td>

        ${cells}
      </tr>`;
  }).join('');

  wrap.style.display = '';
}

function renderHourlyOccupancy(inRows, sfx = '') {
  const hours = computeHourly(inRows);
  const { start, end } = CONFIG.OCCUPANCY_HOURS;

  let maxInbound = 0;

  for (let h = start; h <= end; h++) {
    maxInbound = Math.max(maxInbound, hours[h].inbound);
  }

  let html = '';

  for (let h = start; h <= end; h++) {
    const d = hours[h];

    if (d.inbound === 0) continue;

    const barWidth = maxInbound > 0
      ? Math.round((d.inbound / maxInbound) * 40)
      : 0;

    html += `
      <tr>
        <td class="hour-col">${pad2(h)}:00</td>
        <td class="right">${d.inbound}</td>
        <td class="right">${d.answered}</td>
        <td class="right">
          ${d.missed > 0
            ? `<span class="warn">${d.missed}</span>`
            : '0'}
        </td>
        <td class="num">
          <span class="bar-inline" style="width:${barWidth}px"></span>
          ${d.inbound > 0
            ? ((d.answered / d.inbound) * 100).toFixed(0)
            : 0}%
        </td>
      </tr>`;
  }

  $('hourly-occupancy-tbody' + sfx).innerHTML = html ||
    '<tr><td colspan="5" style="text-align:center; color:var(--text-dim); padding:16px;">No inbound calls in selected range</td></tr>';
}

function renderHourlyComparison(toVal, sfx = '') {
  const days = pickCompareDays(toVal);
  const stats = new Map();

  for (const day of days) {
    const perHour = new Map(
      CONFIG.COMPARE_HOURS.map((h) => [
        h,
        { handled: 0, answered: 0 }
      ])
    );

    for (const r of rowsOnDate(state.inbound, day)) {
      const slot = perHour.get(r.hour);

      if (!slot) continue;

      slot.handled++;

      if (r.disp === CONFIG.DISP_ANSWERED) {
        slot.answered++;
      }
    }

    stats.set(day, perHour);
  }

  let html = '';

  for (const h of CONFIG.COMPARE_HOURS) {
    html += `
      <tr class="sub-row">
        <td colspan="4">
          ${pad2(h > 12 ? h - 12 : h)}:00 –
          ${pad2(h > 12 ? h - 12 : h)}:59
          ${h >= 12 ? 'PM' : 'AM'}
        </td>
      </tr>`;

    for (const day of days) {
      const v = stats.get(day).get(h);

      const rate = v.handled > 0
        ? ((v.answered / v.handled) * 100).toFixed(1) + '%'
        : '—';

      html += `
        <tr${day === days[days.length - 1] ? ' class="cmp-last"' : ''}>
          <td class="hour-col">${fmtDayShort(day)}</td>
          <td class="right">${v.handled}</td>
          <td class="right">${v.answered}</td>
          <td class="right">${rate}</td>
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
    responsive: true,
    maintainAspectRatio: false,

    plugins: {
      legend: {
        display: !!opts.legend,
        position: 'top',
        align: 'end',
        labels: {
          boxWidth: 8,
          boxHeight: 8,
          usePointStyle: true,
          color: '#4b5567',
          font: {
            family: 'Inter',
            size: 10
          }
        }
      },

      tooltip: {
        backgroundColor: '#151a27',
        titleColor: '#fff',
        bodyColor: '#e3e7ee',
        padding: 8,
        cornerRadius: 6,
        callbacks: opts.tooltip
          ? { label: opts.tooltip }
          : {}
      }
    },

    scales: {
      x: {
        grid: { display: false },
        ticks: { color: '#7a8397' },
        border: { color: '#e3e7ee' }
      },

      y: {
        grid: { color: '#eef1f6' },
        ticks: {
          color: '#7a8397',
          callback: opts.yTick || undefined
        },
        border: { display: false },
        beginAtZero: true
      }
    }
  };
}

function makeChart(id, config) {
  const canvas = $(id);

  if (!canvas) return;

  if (state.charts[id]) {
    state.charts[id].destroy();
  }

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
        {
          label: 'Handled',
          data: agents.map((a) => a.totalHandled),
          backgroundColor: CC.handled,
          borderRadius: 3,
          maxBarThickness: 18
        },
        {
          label: 'Answered',
          data: agents.map((a) => a.totalAnswered),
          backgroundColor: CC.answered,
          borderRadius: 3,
          maxBarThickness: 18
        },
        {
          label: 'Missed',
          data: agents.map((a) => a.totalMissed),
          backgroundColor: CC.missed,
          borderRadius: 3,
          maxBarThickness: 18
        }
      ]
    },

    options: baseChartOptions({ legend: true })
  });

  makeChart('chart-oncall', {
    type: 'bar',

    data: {
      labels,

      datasets: [{
        data: agents.map((a) =>
          parseFloat((a.totalOnCallSec / 60).toFixed(1))
        ),
        backgroundColor: CC.onCall,
        borderRadius: 3,
        maxBarThickness: 28
      }]
    },

    options: baseChartOptions({
      tooltip: (ctx) => `${ctx.parsed.y} min`
    })
  });

  makeChart('chart-avg', {
    type: 'bar',

    data: {
      labels,

      datasets: [{
        data: agents.map((a) => a.avgHandleSec),
        backgroundColor: CC.aht,
        borderRadius: 3,
        maxBarThickness: 28
      }]
    },

    options: baseChartOptions({
      tooltip: (ctx) =>
        secondsToMMSS(ctx.parsed.y) + ' (MM:SS)',

      yTick: (v) => secondsToMMSS(v)
    })
  });
}


/* ─── 7. EXPORT & FILE FLOW ───────────────────────────────────────────── */

async function exportToJPEG(containerId = 'export-container') {
  const container = $(containerId);

  if (!container) {
    setStatus('Nothing to export. Please load data first.', 'error');
    return;
  }

  setStatus('Generating JPEG...', '');

  try {
    const canvas = await html2canvas(container, {
      scale: 2,
      backgroundColor: '#f3f5f9',
      logging: false,
      useCORS: true
    });

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

let toastTimer = null;

/**
 * Shows a short toast (top-right) instead of a permanent bar.
 * info / success disappear after CONFIG.TOAST_MS; errors stay a little longer
 * (CONFIG.TOAST_ERROR_MS) so they can be read. Empty msg hides it at once.
 */
function setStatus(msg, type = '') {
  let el = $('toast');

  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }

  clearTimeout(toastTimer);

  if (!msg) {
    el.className = '';
    return;
  }

  el.textContent = msg;
  el.className = `show ${type}`;

  toastTimer = setTimeout(() => {
    el.className = '';
  }, type === 'error' ? CONFIG.TOAST_ERROR_MS : CONFIG.TOAST_MS);
}


/* ─── CSV PROCESSING ─────────────────────────────────────────────────── */

function onFileParsed(kind, file, input, res) {
  const label = kind === 'inbound' ? 'Inbound' : 'Outbound';
  const spec = CONFIG.COLUMNS[kind];

  const fields = (res.meta && res.meta.fields) || [];

  if (spec.critical.some((c) => !fields.includes(c))) {
    setStatus(`${label} file is missing critical columns.`, 'error');

    input.value = '';
    return;
  }

  const prepared = prepareRows(res.data, kind);

  state[kind] = buildDataset(
    prepared.records,
    prepared.skipped,
    prepared.unknown,
    file.name
  );

  $(`${kind}-filename`).textContent = file.name;
  $(`${kind}-btn`).classList.add('loaded');

  setStatus(
    `${label} loaded: ${prepared.records.length} rows | ${prepared.excludedPhones} excluded phone records`,
    'success'
  );
}

function onStatusFileParsed(file, input, res) {
  const spec = CONFIG.COLUMNS.status;
  const fields = (res.meta && res.meta.fields) || [];

  const missing = spec.critical.filter((c) => !fields.includes(c));

  if (missing.length) {
    setStatus(`Agent status file is missing columns: ${missing.join(', ')}`, 'error');

    input.value = '';
    return;
  }

  const prepared = prepareStatusRows(res.data);

  if (prepared.used === 0) {
    setStatus('Agent status file has no usable rows for the tracked agents.', 'error');

    input.value = '';
    return;
  }

  state.status = prepared;

  $('status-filename').textContent = file.name;
  $('status-btn').classList.add('loaded');

  let msg = `Agent status loaded: ${prepared.used} rows | ${prepared.otherAgents} rows from other agents/extensions skipped`;

  if (prepared.unknown.size) {
    const list = [...prepared.unknown.entries()]
      .map(([k, v]) => `${k} (${v})`)
      .join(', ');

    msg += ` | Unmapped statuses: ${list}`;
  }

  if (prepared.multiDate) {
    msg += ' | Note: file spans multiple dates, all summed';
  }

  setStatus(msg, 'success');

  // If the dashboard is already on screen, refresh the table straight away
  const dash = $('dashboard');

  if (dash && dash.classList.contains('show')) {
    renderStatusTable();
  }
}

function handleFileSelected(kind, input) {
  const file = input.files && input.files[0];

  if (!file) return;

  Papa.parse(file, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),

    complete: (res) => (
      kind === 'status'
        ? onStatusFileParsed(file, input, res)
        : onFileParsed(kind, file, input, res)
    ),

    error: () => setStatus(`Failed to parse ${kind} file.`, 'error')
  });
}


/* ─── 8. DASHBOARD EXECUTION ─────────────────────────────────────────── */

function runDashboard() {
  if (!state.outbound || !state.inbound) {
    setStatus('Please upload both CSV files first.', 'error');
    return;
  }

  const from = $('date-from').value;
  const to = $('date-to').value;

  if (!from || !to || from > to) {
    setStatus('Please select a valid date range.', 'error');
    return;
  }

  try {
    const outRows = rowsInRange(state.outbound, from, to);
    const inRows = rowsInRange(state.inbound, from, to);

    if (!outRows.length && !inRows.length) {
      setStatus('No records found for date range.', 'error');
      return;
    }

    const agents = buildAgents(outRows, inRows);
    const rangeSummary = summariseInbound(inRows, outRows);

    // Strictly snap to selected To date or nearest previous working day
    const lastDay = lastWorkingDay(to, from);

    const dayOut = rowsOnDate(state.outbound, lastDay);
    const dayIn = rowsOnDate(state.inbound, lastDay);

    const daySummary = from === lastDay
      ? rangeSummary
      : summariseInbound(dayIn, dayOut);

    const dayAgents = from !== lastDay
      ? buildAgents(dayOut, dayIn)
      : null;

    renderDateBanner(
      from,
      to,
      outRows.length,
      inRows.length,
      agents
    );

    renderKPIs(rangeSummary, daySummary);

    $('agent-note').textContent = dayAgents
      ? `Range (${lastDay})`
      : 'Inbound + Outbound';

    renderAgentTable(agents, dayAgents);
    renderCharts(agents);
    renderHourlyOccupancy(inRows);
    renderHourlyComparison(lastDay);
    renderStatusTable();

    $('dashboard').classList.add('show');
    $('empty-state').style.display = 'none';
    $('export-btn').style.display = 'flex';

    const rangeLabel = from === to
      ? from
      : `${from} → ${to}`;

    setStatus(`Dashboard updated for ${rangeLabel}`, 'success');

    $('header-date').textContent = `Inbound | ${rangeLabel}`;

  } catch (err) {
    console.error('Dashboard error:', err);
    setStatus(`Something went wrong: ${err.message}`, 'error');
  }
}


/* ─── 9. INITIALISATION ───────────────────────────────────────────────── */

function init() {
  initChartDefaults();

  $('export-container').innerHTML = buildBoardHTML('');

  $('outbound-file').addEventListener('change', (e) =>
    handleFileSelected('outbound', e.target)
  );

  $('inbound-file').addEventListener('change', (e) =>
    handleFileSelected('inbound', e.target)
  );

  $('status-file').addEventListener('change', (e) =>
    handleFileSelected('status', e.target)
  );

  const runBtn = document.querySelector('.run-btn');

  if (runBtn) {
    runBtn.addEventListener('click', runDashboard);
  }

  const exportBtn = $('export-btn');

  if (exportBtn) {
    exportBtn.addEventListener('click', () => exportToJPEG());
  }

  const t = new Date();

  const today = `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`;

  $('date-from').value = today;
  $('date-to').value = today;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
}
