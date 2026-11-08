// Fungsi murni (tanpa Firebase) supaya mudah dites.

export const TOURNAMENT = {
  name: "Industropolis Futsal League 2026",
  short: "IFL 2026",
  venue: "KEK Industropolis Batang",
  start: "2026-11-20",
  end: "2026-12-04",
};

// Pendaftaran tim (Google Form). Tombol "Daftar tim" mengikuti jadwal ini (jam perangkat pengunjung).
export const REGISTRATION = {
  url: "https://docs.google.com/forms/d/e/1FAIpQLScMWxdzfy64SIs-F8leDWftihMQfd4LgcrHdvcfzhvzRYXLFQ/viewform",
  open: "2026-11-09T00:00:00+07:00",
  close: "2026-11-15T15:00:00+07:00",
};
/** "soon" (belum dibuka), "open", atau "closed". */
export function registrationState(now = Date.now()) {
  if (now < Date.parse(REGISTRATION.open)) return "soon";
  return now <= Date.parse(REGISTRATION.close) ? "open" : "closed";
}

// Jumlah tim lolos per grup mengikuti bagan (4 grup x 2 tim = 8 tim perempat final).
export const QUALIFY_PER_GROUP = 2;

export const STAGES = {
  group: "Babak Grup",
  qf: "Perempat Final",
  sf: "Semi Final",
  third: "Perebutan Juara 3",
  final: "Final",
};

const TZ = "Asia/Jakarta";

export function toDate(v) {
  if (!v) return null;
  if (typeof v.toDate === "function") return v.toDate();
  if (v instanceof Date) return v;
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

const fmtTime = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ });
const fmtDayLong = new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: TZ });
const fmtDayShort = new Intl.DateTimeFormat("id-ID", { weekday: "short", day: "numeric", month: "short", timeZone: TZ });
const fmtKey = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: TZ });

export const timeStr = (v) => { const d = toDate(v); return d ? fmtTime.format(d).replace(":", ".") : "TBD"; };
export const dayLong = (v) => { const d = toDate(v); return d ? fmtDayLong.format(d) : "Akan ditentukan"; };
export const dayShort = (v) => { const d = toDate(v); return d ? fmtDayShort.format(d).replace(".", "") : "–"; };
export const dayKey = (v) => { const d = toDate(v); return d ? fmtKey.format(d) : "tbd"; };

/** Nilai untuk <input type="datetime-local"> dalam WIB. */
export function toLocalInput(v) {
  const d = toDate(v);
  if (!d) return "";
  const p = new Intl.DateTimeFormat("sv-SE", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: TZ,
  }).format(d);
  return p.replace(" ", "T");
}
/** Dari nilai datetime-local (dianggap WIB, UTC+7) ke Date. */
export function fromLocalInput(s) {
  if (!s) return null;
  const d = new Date(s + ":00+07:00");
  return isNaN(d) ? null : d;
}

// ---------- Jam server ----------
// Jam HP/laptop tiap orang bisa beda. Selisih terhadap jam server (header Date dari situs sendiri)
// dihitung sekali lalu dipakai admin dan penonton, jadi menit laga sama di semua perangkat.
let serverOffset = 0;
export const nowMs = () => Date.now() + serverOffset;
export async function syncServerTime() {
  try {
    const t0 = Date.now();
    const res = await fetch(location.pathname || "/", { method: "HEAD", cache: "no-store" });
    const t1 = Date.now();
    const h = res.headers.get("date");
    if (!h) return;
    const server = Date.parse(h);
    if (isNaN(server)) return;
    // header Date hanya akurat sampai detik: anggap server ada di tengah detik itu
    serverOffset = server + 500 - (t0 + t1) / 2;
  } catch { /* tetap pakai jam perangkat */ }
}

// ---------- Fase laga & jam ----------
// Jam hanya menghitung satu babak (mulai dari 0 tiap babak). Menit kejadian tetap berurutan lewat "offset":
// babak 2 grup 2 x 10 menit dihitung 11', 12', ... (babak gugur 2 x 15: 16', 17', ...), ET1 mulai setelah waktu normal.
// match.phase  : h1 | ht | h2 | et1 | etb | et2 | pen
// match.clock  : { running, baseSec (detik di babak ini), startedAt }
// match.cfg    : durasi yang dibekukan saat laga dimulai (mengubah Pengaturan tidak mengacaukan laga yang sedang jalan)
// match.pause  : { key, label, side? } bila jam dihentikan darurat (cedera, dll) atau laga dibuka untuk koreksi
export const DEFAULT_TIMING = { groupHalves: 2, groupHalf: 10, koHalf: 15, etHalf: 5, breakMin: 5, etBreakMin: 1 };

/** Durasi dari Pengaturan, dengan nilai bawaan dan batas wajar bila isinya kosong atau aneh. */
export function timingOf(settings) {
  const t = (settings && settings.timing) || {};
  const n = (v, d, lo, hi) => { const x = Number(v); return Number.isFinite(x) && x >= lo && x <= hi ? Math.round(x) : d; };
  const D = DEFAULT_TIMING;
  return {
    groupHalves: Number(t.groupHalves) === 1 ? 1 : 2,
    groupHalf: n(t.groupHalf, D.groupHalf, 1, 45),
    koHalf: n(t.koHalf, D.koHalf, 1, 45),
    etHalf: n(t.etHalf, D.etHalf, 1, 15),
    breakMin: n(t.breakMin, D.breakMin, 0, 20),
    etBreakMin: n(t.etBreakMin, D.etBreakMin, 0, 10),
  };
}
export const isKnockout = (m) => !!m && !!m.stage && m.stage !== "group";
/** Konfigurasi durasi satu laga (dibekukan ke match.cfg saat laga dimulai). */
export function cfgFor(m, timing = DEFAULT_TIMING) {
  const ko = isKnockout(m);
  return { ko, halves: ko ? 2 : timing.groupHalves, half: ko ? timing.koHalf : timing.groupHalf, etHalf: timing.etHalf, breakMin: timing.breakMin, etBreakMin: timing.etBreakMin };
}
const cfgOf = (m) => m.cfg || cfgFor(m);

export const PHASE_NAME = { h1: "Babak 1", ht: "Istirahat", h2: "Babak 2", et1: "ET1", etb: "Istirahat ET", et2: "ET2", pen: "Adu penalti" };
const PHASE_SHORT = { h1: "BABAK 1", h2: "BABAK 2", et1: "ET1", et2: "ET2" };
const RANK = { h1: 0, ht: 1, h2: 2, et1: 3, etb: 4, et2: 5, pen: 6 };
export const isPlayPhase = (p) => p === "h1" || p === "h2" || p === "et1" || p === "et2";
export const phaseOf = (m) => m.phase || (m.status === "live" ? "h1" : null);

const limitSec = (c, p) => 60 * ({ h1: c.half, h2: c.half, et1: c.etHalf, et2: c.etHalf, ht: c.breakMin, etb: c.etBreakMin }[p] || 0);
/** Menit nominal sebelum babak ini mulai (untuk istirahat: akhir babak sebelumnya). */
function offsetMin(m, c, p) {
  switch (p) {
    case "ht": case "h2": return c.half;
    case "et1": return 2 * c.half;
    case "etb": case "et2": return 2 * c.half + c.etHalf;
    case "pen": return 2 * c.half + (m.etPlayed ? 2 * c.etHalf : 0);
    default: return 0;
  }
}
export const periodLimitSec = (m, p = phaseOf(m)) => limitSec(cfgOf(m), p);

// match.clock = { running: bool, baseSec: number, startedAt: ms }; baseSec = detik di babak yang sedang berjalan
export function elapsedSec(match, now = nowMs()) {
  const c = match.clock || {};
  const base = c.baseSec || 0;
  if (c.running && c.startedAt) return base + Math.max(0, Math.floor((now - c.startedAt) / 1000));
  return base;
}

/** Cap waktu kejadian pada babak p setelah ps detik. Lewat batas babak = tambahan waktu (10+1'). */
export function stampAt(m, p, ps = 0) {
  const c = cfgOf(m), off = offsetMin(m, c, p);
  if (!isPlayPhase(p)) return { p, ps: 0, sec: off * 60, minute: off, extra: 0 };
  const lim = limitSec(c, p);
  if (ps >= lim) return { p, ps, sec: off * 60 + ps, minute: off + lim / 60, extra: Math.floor((ps - lim) / 60) + 1 };
  return { p, ps, sec: off * 60 + ps, minute: off + Math.floor(ps / 60) + 1, extra: 0 };
}
export const stampNow = (m, now = nowMs()) => { const p = phaseOf(m) || "h1"; return stampAt(m, p, isPlayPhase(p) ? elapsedSec(m, now) : 0); };
export const fmtMinute = (minute, extra) => (extra ? `${minute}+${extra}'` : `${minute}'`);
export const eventMinute = (e) => fmtMinute(e.minute ?? 0, e.extra || 0);
export const minuteNow = (m, now) => { const s = stampNow(m, now); return fmtMinute(s.minute, s.extra); };
/** Urutan kejadian: per babak lalu detik di babak itu (aman untuk tambahan waktu). Data lama memakai sec/minute. */
const eventKey = (e) => (e.p && e.p in RANK ? RANK[e.p] * 1e6 + (e.ps || 0) : e.sec ?? (e.minute ?? 0) * 60);
export const eventCmp = (a, b) => eventKey(a) - eventKey(b) || (a.ts ?? 0) - (b.ts ?? 0);

const mmss = (x) => `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
/** Babak main: 03:12 lalu "10:00 +00:42" saat tambahan waktu. Istirahat: hitung mundur. Adu penalti: kosong. */
export function clockText(match, now = nowMs()) {
  const p = phaseOf(match);
  if (!p || p === "pen") return "";
  const s = elapsedSec(match, now), lim = limitSec(cfgOf(match), p);
  if (!isPlayPhase(p)) return mmss(Math.max(0, lim - s));
  return s >= lim ? `${mmss(lim)} +${mmss(s - lim)}` : mmss(s);
}
/** Teks + status untuk label LIVE: "BABAK 2 · 11'", "JEDA · Cedera", "ISTIRAHAT". halted = warna kuning. */
export function livePill(m, now = nowMs()) {
  const p = phaseOf(m), c = m.clock || {};
  if (p === "ht") return { text: "ISTIRAHAT", halted: true };
  if (p === "etb") return { text: "ISTIRAHAT ET", halted: true };
  if (p === "pen") return { text: "ADU PENALTI", halted: false };
  if (m.pause) return { text: `JEDA · ${m.pause.label}`, halted: true };
  if (!c.running) return { text: (c.baseSec || 0) > 0 ? "JEDA" : `${PHASE_SHORT[p] || "LIVE"} · SIAP`, halted: true };
  return { text: `${PHASE_SHORT[p] || "LIVE"} · ${minuteNow(m, now)}`, halted: false };
}
/** Status sebuah laga yang sudah selesai: "FT" atau "FT · ET". */
export const ftText = (m) => (m.etPlayed ? "FT · ET" : "FT");
/** Pengingat tambahan waktu yang diumumkan admin (hanya saat babak main). */
export const addedText = (m) => (m.status === "live" && isPlayPhase(phaseOf(m)) && (m.addedMin || 0) > 0 ? `Tambahan waktu +${m.addedMin}'` : "");
/** Jam berhenti dan belum pernah jalan di babak ini (mis. ET1 menunggu peluit). */
export const isReadyToStart = (m) => m.status === "live" && isPlayPhase(phaseOf(m)) && !(m.clock && m.clock.running) && !m.pause && !((m.clock && m.clock.baseSec) > 0);

export const PAUSE_REASONS = [["injury", "Cedera"], ["pitch", "Gangguan lapangan"], ["timeout", "Time-out"], ["other", "Lainnya"]];

/**
 * Tombol utama yang berlaku di fase sekarang. Babak 2 laga gugur yang seri tidak punya "Selesai (FT)":
 * pilihannya perpanjangan waktu atau langsung adu penalti.
 */
export function phaseActions(m) {
  if (m.status !== "live") return [];
  if (m.correcting) return [{ act: "finish", label: "Selesai (FT)", kind: "dark" }];
  const p = phaseOf(m), c = cfgOf(m);
  const tied = (m.scoreA || 0) === (m.scoreB || 0);
  const endRegular = () => (c.ko && tied
    ? [{ act: "to-et", label: "Lanjut perpanjangan waktu", kind: "orange" }, { act: "to-pen", label: "Langsung adu penalti", kind: "ghost" }]
    : [{ act: "finish", label: "Selesai (FT)", kind: "dark" }]);
  switch (p) {
    case "h1": return c.halves === 2 ? [{ act: "end-h1", label: "Akhiri babak 1", kind: "orange" }] : endRegular();
    case "ht": return [{ act: "start-h2", label: "Mulai babak 2", kind: "go" }];
    case "h2": return endRegular();
    case "et1": return [{ act: "end-et1", label: "Akhiri ET1", kind: "orange" }];
    case "etb": return [{ act: "start-et2", label: "Mulai ET2", kind: "go" }];
    case "et2": return tied ? [{ act: "to-pen", label: "Lanjut adu penalti", kind: "orange" }] : [{ act: "finish", label: "Selesai (FT)", kind: "dark" }];
    case "pen": return [{ act: "finish", label: "Selesai (FT)", kind: "dark" }];
    default: return [];
  }
}

// ---------- Line up ----------
export const FUTSAL_STARTERS = 5;
/** Daftar masalah line up satu sisi; kosong berarti siap main. */
export function lineupProblems(match, side, players) {
  const lu = match["lineup" + side] || {};
  const starters = lu.starters || [];
  const out = [];
  if (starters.length !== FUTSAL_STARTERS) out.push(`Susunan inti harus ${FUTSAL_STARTERS} pemain (baru ${starters.length})`);
  else if (!starters.some((id) => players.find((p) => p.id === id)?.isGK)) out.push("Susunan inti belum ada kiper");
  return out;
}
export function matchReadiness(match, players) {
  if (!match.teamA || !match.teamB) return ["Tim belum lengkap"];
  return [
    ...lineupProblems(match, "A", players).map((x) => "Tim A: " + x),
    ...lineupProblems(match, "B", players).map((x) => "Tim B: " + x),
  ];
}
/** Pemain yang boleh dicatat kejadiannya: inti + cadangan di line up. */
export const lineupIds = (match, side) => {
  const lu = match["lineup" + side] || {};
  return [...(lu.starters || []), ...(lu.subs || [])];
};

// ---------- Klasemen ----------
function blank(team) {
  return { teamId: team.id, name: team.name, group: team.group, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 };
}
function applyResult(row, gf, ga) {
  row.p++; row.gf += gf; row.ga += ga;
  if (gf > ga) { row.w++; row.pts += 3; } else if (gf === ga) { row.d++; row.pts += 1; } else row.l++;
}

/** Mengembalikan { A: [rows...], B: [...] }, sudah terurut. */
export function computeStandings(teams, matches) {
  const groups = {};
  const byId = {};
  for (const t of teams) {
    if (!t.group) continue;
    const r = blank(t);
    byId[t.id] = r;
    (groups[t.group] ||= []).push(r);
  }
  const done = matches.filter((m) => m.stage === "group" && m.status === "ft" && byId[m.teamA] && byId[m.teamB]);
  for (const m of done) {
    applyResult(byId[m.teamA], m.scoreA || 0, m.scoreB || 0);
    applyResult(byId[m.teamB], m.scoreB || 0, m.scoreA || 0);
  }
  for (const g of Object.keys(groups)) groups[g] = sortGroup(groups[g], done);
  return groups;
}

function sortGroup(rows, doneMatches) {
  // 1) poin, 2) gol memasukkan (GM), 3) head to head, 4) nama
  const sorted = [...rows].sort((a, b) => b.pts - a.pts || b.gf - a.gf || a.name.localeCompare(b.name, "id"));
  const out = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && sorted[j].pts === sorted[i].pts && sorted[j].gf === sorted[i].gf) j++;
    const tied = sorted.slice(i, j);
    if (tied.length > 1) {
      const ids = new Set(tied.map((r) => r.teamId));
      const h2h = {};
      tied.forEach((r) => (h2h[r.teamId] = { pts: 0, gf: 0, ga: 0 }));
      for (const m of doneMatches) {
        if (!ids.has(m.teamA) || !ids.has(m.teamB)) continue;
        const a = h2h[m.teamA], b = h2h[m.teamB];
        a.gf += m.scoreA; a.ga += m.scoreB; b.gf += m.scoreB; b.ga += m.scoreA;
        if (m.scoreA > m.scoreB) a.pts += 3; else if (m.scoreA < m.scoreB) b.pts += 3; else { a.pts++; b.pts++; }
      }
      tied.sort((x, y) => {
        const hx = h2h[x.teamId], hy = h2h[y.teamId];
        return hy.pts - hx.pts || (hy.gf - hy.ga) - (hx.gf - hx.ga) || hy.gf - hx.gf || x.name.localeCompare(y.name, "id");
      });
    }
    out.push(...tied);
    i = j;
  }
  return out;
}

// ---------- Statistik pemain ----------
export function computePlayerStats(players, events) {
  const byId = {};
  for (const p of players) byId[p.id] = { ...p, goals: 0, assists: 0, yellow: 0, red: 0, ownGoals: 0 };
  for (const e of events) {
    const p = byId[e.playerId];
    if (e.type === "goal" && p) p.goals++;
    if (e.type === "goal" && e.assistId && byId[e.assistId]) byId[e.assistId].assists++;
    if (e.type === "own_goal" && p) p.ownGoals++;
    if (e.type === "yellow" && p) p.yellow++;
    if (e.type === "red" && p) p.red++;
  }
  return Object.values(byId);
}

export function topBy(stats, key, limit = 10) {
  return stats
    .filter((p) => p[key] > 0)
    .sort((a, b) => b[key] - a[key] || (a.name || "").localeCompare(b.name || "", "id"))
    .slice(0, limit);
}

/**
 * Statistik kiper (untuk Kiper Terbaik). Dihitung dari laga selesai di mana kiper masuk susunan inti:
 * main, clean sheet (lawan 0 gol, termasuk ET), kebobolan, rata-rata kebobolan, plus gol/assist/kartu dan posisi akhir timnya.
 * Catatan futsal: sistem tidak mencatat pergantian pemain, jadi yang dihitung adalah kiper di susunan inti.
 * Gol adu penalti tidak dicatat sebagai gol, jadi tidak menambah kebobolan.
 */
export function computeKeeperStats(players, matches, teams = [], events = []) {
  const gks = {};
  for (const p of players) if (p.isGK && p.role !== "official") gks[p.id] = { ...p, played: 0, cleanSheets: 0, conceded: 0, goals: 0, assists: 0, yellow: 0, red: 0 };
  for (const m of matches) {
    if (m.status !== "ft") continue;
    for (const side of ["A", "B"]) {
      const lineup = m["lineup" + side] || {};
      const conceded = side === "A" ? m.scoreB || 0 : m.scoreA || 0;
      for (const id of lineup.starters || []) {
        const g = gks[id];
        if (!g) continue;
        g.played++; g.conceded += conceded;
        if (conceded === 0) g.cleanSheets++;
      }
    }
  }
  for (const e of events) {
    if (e.type === "goal" && gks[e.playerId]) gks[e.playerId].goals++;
    if (e.type === "goal" && e.assistId && gks[e.assistId]) gks[e.assistId].assists++;
    if (e.type === "yellow" && gks[e.playerId]) gks[e.playerId].yellow++;
    if (e.type === "red" && gks[e.playerId]) gks[e.playerId].red++;
  }
  return Object.values(gks)
    .map((g) => ({ ...g, avg: g.played ? g.conceded / g.played : 0, progress: teamProgress(g.teamId, teams, matches) }))
    .filter((g) => g.played > 0)
    .sort((a, b) => b.cleanSheets - a.cleanSheets || a.avg - b.avg || b.played - a.played || a.name.localeCompare(b.name, "id"));
}
/** Statistik satu kiper walau belum main (untuk kartu Kiper Terbaik yang dipilih panitia). */
export function keeperDetail(playerId, players, matches, teams, events) {
  const all = computeKeeperStats(players, matches, teams, events);
  const hit = all.find((k) => k.id === playerId);
  if (hit) return { ...hit, rank: all.indexOf(hit) + 1, total: all.length };
  const p = players.find((x) => x.id === playerId);
  return p ? { ...p, played: 0, cleanSheets: 0, conceded: 0, avg: 0, goals: 0, assists: 0, yellow: 0, red: 0, progress: teamProgress(p.teamId, teams, matches), rank: null, total: all.length } : null;
}

/**
 * Sampai mana sebuah tim: { label, out } dengan label seperti "Gugur di Perempat Final", "Juara", "Masih bertanding".
 * Grup baru dianggap gugur setelah semua laga grupnya selesai dan tim tidak masuk 2 besar.
 */
export function teamProgress(teamId, teams, matches) {
  const team = teams.find((t) => t.id === teamId);
  const mine = matches.filter((m) => m.teamA === teamId || m.teamB === teamId);
  const sideOf = (m) => (m.teamA === teamId ? "A" : "B");
  const result = (m) => { const w = winnerSide(m); return w ? (w === sideOf(m) ? "W" : "L") : null; };
  const ko = mine.filter((m) => m.stage && m.stage !== "group");
  const by = (s) => ko.find((m) => m.stage === s);
  const fin = by("final"), third = by("third"), sf = by("sf"), qf = by("qf");
  if (fin) { const r = result(fin); return r === "W" ? { label: "Juara", out: false } : r === "L" ? { label: "Runner-up", out: false } : { label: "Di final", out: false }; }
  if (third) { const r = result(third); return r === "W" ? { label: "Juara 3", out: false } : r === "L" ? { label: "Peringkat 4", out: false } : { label: "Perebutan juara 3", out: false }; }
  if (sf) { const r = result(sf); return r === "W" ? { label: "Lolos ke final", out: false } : r === "L" ? { label: "Gugur di Semi Final", out: true } : { label: "Di semi final", out: false }; }
  if (qf) { const r = result(qf); return r === "W" ? { label: "Lolos ke semi final", out: false } : r === "L" ? { label: "Gugur di Perempat Final", out: true } : { label: "Di perempat final", out: false }; }
  if (!team || !team.group) return { label: "–", out: false };
  if (!groupDone(matches, team.group)) return { label: "Masih di babak grup", out: false };
  const rows = computeStandings(teams, matches)[team.group] || [];
  return rows.findIndex((r) => r.teamId === teamId) < QUALIFY_PER_GROUP
    ? { label: "Lolos ke perempat final", out: false }
    : { label: "Gugur di Babak Grup", out: true };
}

/** Skor yang berlaku = gol dari daftar kejadian + koreksi manual (adjA/adjB, mis. menang WO). */
export function finalScore(match, events) {
  const [a, b] = scoreFromEvents(match, events);
  return [Math.max(0, a + (match.adjA || 0)), Math.max(0, b + (match.adjB || 0))];
}

/** Skor dari daftar event saja (gol bunuh diri dihitung untuk lawan). */
export function scoreFromEvents(match, events) {
  let a = 0, b = 0;
  for (const e of events) {
    if (e.matchId !== match.id) continue;
    const forA = (e.type === "goal" && e.teamId === match.teamA) || (e.type === "own_goal" && e.teamId === match.teamB);
    const forB = (e.type === "goal" && e.teamId === match.teamB) || (e.type === "own_goal" && e.teamId === match.teamA);
    if (forA) a++;
    if (forB) b++;
  }
  return [a, b];
}

/** Ikon bola untuk gol. cls "og" = merah (gol bunuh diri). Warna diatur lewat CSS (.ball). */
export const ballSvg = (cls = "") =>
  `<svg class="ball ${cls}" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><circle class="bs bf" cx="12" cy="12" r="10.5"/><path class="bl" d="M12 7.2l4.1 3-1.6 4.8H9.5L7.9 10.2z"/><path class="bs" d="M12 7.2V2M16.1 10.2l5-1.6M14.5 15l3 4.2M9.5 15l-3 4.2M7.9 10.2l-5-1.6"/></svg>`;

export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const sortByKickoff = (a, b) => (toDate(a.kickoff)?.getTime() ?? 9e15) - (toDate(b.kickoff)?.getTime() ?? 9e15);

// ---------- Babak gugur ----------
// Pasangan perempat final mengikuti slide manajemen (4 grup, 2 lolos per grup).
export const QF_SEEDS = [
  [["A", 1], ["B", 2]],
  [["C", 1], ["D", 2]],
  [["B", 1], ["A", 2]],
  [["D", 1], ["C", 2]],
];
export const seedLabel = ([g, r]) => (r === 1 ? `Juara ${g}` : `Runner-up ${g}`);

/** Sisi pemenang ("A"/"B") untuk laga selesai; seri ditentukan lewat penWinner (adu penalti). */
export function winnerSide(m) {
  if (!m || m.status !== "ft") return null;
  if ((m.scoreA || 0) > (m.scoreB || 0)) return "A";
  if ((m.scoreB || 0) > (m.scoreA || 0)) return "B";
  return m.penWinner === "A" || m.penWinner === "B" ? m.penWinner : null;
}
const loserSide = (m) => { const w = winnerSide(m); return w ? (w === "A" ? "B" : "A") : null; };
const teamOfSide = (m, s) => (s === "A" ? m.teamA : s === "B" ? m.teamB : null) || null;

const koSorted = (matches, stage) =>
  matches.filter((m) => m.stage === stage).sort((a, b) => sortByKickoff(a, b) || (a.createdAt || 0) - (b.createdAt || 0));

function groupDone(matches, g) {
  const list = matches.filter((m) => (m.stage === "group" || !m.stage) && m.group === g);
  return list.length > 0 && list.every((m) => m.status === "ft");
}

/**
 * Susunan bagan. Urutan laga QF1..QF4 dan SF1..SF2 diambil dari urutan jam kickoff
 * (lalu urutan input) pada fase yang sama. Tim yang sudah pasti ikut terisi otomatis
 * di tampilan walau admin belum mengisinya di data laga.
 */
export function computeBracket(teams, matches) {
  const standings = computeStandings(teams, matches);
  const seedTeam = (seed) => (groupDone(matches, seed[0]) ? standings[seed[0]]?.[seed[1] - 1]?.teamId || null : null);
  const qf = koSorted(matches, "qf").slice(0, 4);
  const sf = koSorted(matches, "sf").slice(0, 2);
  const fin = koSorted(matches, "final")[0] || null;
  const third = koSorted(matches, "third")[0] || null;

  const mk = (name, match, a, b) => ({
    name, match,
    teamA: match?.teamA || a.team || null, teamB: match?.teamB || b.team || null,
    labelA: a.label, labelB: b.label,
  });
  const qfSlots = QF_SEEDS.map(([sa, sb], i) =>
    mk(`QF${i + 1}`, qf[i] || null, { team: seedTeam(sa), label: seedLabel(sa) }, { team: seedTeam(sb), label: seedLabel(sb) }));
  const fromQF = (i) => ({ team: qf[i] ? teamOfSide(qf[i], winnerSide(qf[i])) : null, label: `Pemenang QF${i + 1}` });
  const sfSlots = [mk("SF1", sf[0] || null, fromQF(0), fromQF(1)), mk("SF2", sf[1] || null, fromQF(2), fromQF(3))];
  const fromSF = (i) => ({ team: sf[i] ? teamOfSide(sf[i], winnerSide(sf[i])) : null, label: `Pemenang SF${i + 1}` });
  const loseSF = (i) => ({ team: sf[i] ? teamOfSide(sf[i], loserSide(sf[i])) : null, label: `Kalah SF${i + 1}` });
  return {
    qf: qfSlots, sf: sfSlots,
    final: mk("FINAL", fin, fromSF(0), fromSF(1)),
    third: third ? mk("JUARA 3", third, loseSF(0), loseSF(1)) : null,
  };
}

/** Daftar pengisian tim yang bisa dilakukan sekarang (hanya laga yang belum mulai). */
export function planKnockout(teams, matches) {
  const b = computeBracket(teams, matches);
  const slots = [...b.qf, ...b.sf, b.final, ...(b.third ? [b.third] : [])];
  const out = [];
  for (const s of slots) {
    const m = s.match;
    if (!m || m.status !== "scheduled") continue;
    const patch = {};
    if (s.teamA && s.teamA !== m.teamA) patch.teamA = s.teamA;
    if (s.teamB && s.teamB !== m.teamB) patch.teamB = s.teamB;
    if (Object.keys(patch).length) out.push({ id: m.id, name: s.name, patch });
  }
  return out;
}

/**
 * Kerangka loading (shimmer) per jenis halaman. Dipakai saat data belum siap dan sekilas tiap pindah halaman.
 * Jenis: list, grid, form, cards, pos (admin) dan home, detail, list, grid (publik).
 */
export function skeleton(kind = "list") {
  const S = (w, h, cls = "") => `<i class="sk ${cls}" style="--w:${w};--h:${h}"></i>`;
  const row = () => `<div class="sk-row">${S("52px", "42px")}<div class="sk-col">${S("68%", "16px")}${S("38%", "12px")}</div>${S("68px", "30px", "sk-pill")}</div>`;
  const rows = (n) => Array.from({ length: n }, row).join("");
  const tcard = () => `<div class="sk-card">${S("36px", "36px", "sk-circle")}<div class="sk-col">${S("62%", "15px")}${S("36%", "12px")}</div></div>`;
  const field = () => `<div class="sk-col">${S("90px", "12px")}${S("100%", "48px", "sk-in")}</div>`;
  const kcard = () => `<div class="sk-card v"><div class="sk-top">${S("36px", "36px", "sk-circle")}<div class="sk-col">${S("70%", "15px")}${S("40%", "12px")}</div></div><div class="sk-stats">${Array.from({ length: 6 }, () => S("100%", "44px")).join("")}</div></div>`;
  let body;
  switch (kind) {
    case "home":
      body = `${S("100%", "250px", "sk-hero")}${S("100%", "64px", "sk-in")}<div class="sk-two"><div class="sk-col">${S("180px", "24px")}<div class="sk-panel">${rows(3)}</div></div><div class="sk-col">${S("220px", "24px")}<div class="sk-panel">${rows(4)}</div></div></div>`; break;
    case "detail":
      body = `${S("110px", "16px")}${S("100%", "220px", "sk-hero")}<div class="sk-panel">${rows(4)}</div>`; break;
    case "grid":
      body = `${S("240px", "34px", "sk-t")}<div class="sk-grid">${[0, 1, 2, 3].map(() => `<div class="sk-col">${S("70px", "13px")}${tcard()}${tcard()}${tcard()}${tcard()}</div>`).join("")}</div>`; break;
    case "form":
      body = `${S("260px", "34px", "sk-t")}<div class="sk-panel">${field()}${field()}${field()}${S("170px", "48px", "sk-btn")}</div>`; break;
    case "cards":
      body = `${S("220px", "34px", "sk-t")}<div class="sk-col">${S("92%", "14px")}${S("64%", "14px")}</div>${S("100%", "48px", "sk-in")}<div class="sk-kgrid">${Array.from({ length: 8 }, kcard).join("")}</div>`; break;
    case "pos":
      body = `${S("120px", "16px")}${S("100%", "260px", "sk-hero")}<div class="sk-panel">${S("200px", "22px")}<div class="sk-tiles">${Array.from({ length: 8 }, () => S("100%", "76px", "sk-tile")).join("")}</div></div>`; break;
    default:
      body = `${S("240px", "34px", "sk-t")}${S("100%", "42px", "sk-pill")}<div class="sk-panel">${rows(6)}</div>`;
  }
  return `<div class="sk-wrap" role="status" aria-busy="true" aria-label="Memuat">${body}</div>`;
}
