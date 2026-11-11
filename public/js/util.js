// Fungsi murni (tanpa Firebase) supaya mudah dites.

// SATU TEMPAT untuk nama dan info turnamen. Ubah di sini, lalu semua tampilan (beranda, TV, judul tab, footer) ikut berubah.
// Catatan: judul/deskripsi di <head> index.html dan admin/index.html, serta teks di dalam video promo dan og-image.jpg, diubah manual.
export const TOURNAMENT = {
  name: "Industropolis Batang Futsal League", // nama lengkap (judul tab, footer, alt logo)
  line1: "Industropolis Batang",               // baris 1 di logo teks (bilah atas, hero, TV)
  line2: "Futsal League",                      // baris 2 (miring)
  short: "IBFL 2026",
  tagline: "Khusus karyawan tenant Industropolis Batang",
  venue: "Sagara Futsal Arena, KEK Industropolis Batang",
  start: "2026-11-20",
  end: "2026-12-04",
};

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
  if (!isPlayPhase(p)) return { p, ps: 0, sec: off * 60, minute: off, extra: 0, pm: 0 };
  const lim = limitSec(c, p);
  // pm = menit di dalam babak ini (dipakai perpanjangan waktu: ET1 3', ET2 2')
  if (ps >= lim) return { p, ps, sec: off * 60 + ps, minute: off + lim / 60, extra: Math.floor((ps - lim) / 60) + 1, pm: lim / 60 };
  return { p, ps, sec: off * 60 + ps, minute: off + Math.floor(ps / 60) + 1, extra: 0, pm: Math.floor(ps / 60) + 1 };
}
export const stampNow = (m, now = nowMs()) => { const p = phaseOf(m) || "h1"; return stampAt(m, p, isPlayPhase(p) ? elapsedSec(m, now) : 0); };
export const fmtMinute = (minute, extra) => (extra ? `${minute}+${extra}'` : `${minute}'`);
const isET = (p) => p === "et1" || p === "et2";
const ET_TAG = { et1: "ET1", et2: "ET2" };
/** Menit tampil. Babak 1-2 berlanjut (11', 12', ...); perpanjangan waktu dihitung per babak: "ET1 3'", "ET2 2'", "ET1 5+1'". */
export function fmtStamp(s, withTag = true) {
  if (!isET(s.p)) return fmtMinute(s.minute ?? 0, s.extra || 0);
  const t = fmtMinute(s.pm ?? (Math.floor((s.ps || 0) / 60) + 1), s.extra || 0);
  return withTag ? `${ET_TAG[s.p]} ${t}` : t;
}
export const eventMinute = (e) => fmtStamp(e);
export const minuteNow = (m, now) => fmtStamp(stampNow(m, now));
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
  return { text: `${PHASE_SHORT[p] || "LIVE"} · ${fmtStamp(stampNow(m, now), false)}`, halted: false };
}
/** Status sebuah laga yang sudah selesai: "FT" atau "FT · ET". */
export const ftText = (m) => (m.wo ? "WO" : m.etPlayed ? "FT · ET" : "FT");
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

// ---------- Adu penalti ----------
// match.penKicks = [{ s: "A"|"B", g: true|false }, ...] (urutan tendangan). Disimpan di dokumen laga, BUKAN di events,
// jadi tidak masuk top scorer, skor laga, maupun kebobolan kiper. match.penWinner diisi otomatis dari hasil ini.
export const PEN_ROUNDS = 5;
export function shootout(m) {
  const kicks = Array.isArray(m?.penKicks) ? m.penKicks.filter((k) => k && (k.s === "A" || k.s === "B")) : [];
  const taken = { A: 0, B: 0 }, goals = { A: 0, B: 0 };
  for (const k of kicks) { taken[k.s]++; if (k.g) goals[k.s]++; }
  const rem = (n) => Math.max(0, PEN_ROUNDS - n);
  let winner = null;
  if (taken.A >= PEN_ROUNDS && taken.B >= PEN_ROUNDS) {
    // sudden death: hanya diputuskan setelah kedua tim menendang sama banyak
    if (taken.A === taken.B && goals.A !== goals.B) winner = goals.A > goals.B ? "A" : "B";
  } else if (goals.A > goals.B + rem(taken.B)) winner = "A";
  else if (goals.B > goals.A + rem(taken.A)) winner = "B";
  const next = taken.A === taken.B ? null : taken.A < taken.B ? "A" : "B";
  return { kicks, taken, goals, winner, next, any: kicks.length > 0 };
}
/** "3–4" (urutan Tim A–Tim B); winnerFirst=true menaruh skor pemenang di depan. Kosong bila tidak ada tendangan tercatat. */
export function penScoreText(m, winnerFirst = false) {
  const so = shootout(m);
  if (!so.any) return "";
  const a = so.goals.A, b = so.goals.B;
  return winnerFirst && (m.penWinner === "B" || (!m.penWinner && b > a)) ? `${b}–${a}` : `${a}–${b}`;
}
/** Titik hasil tendangan satu tim (HTML): ● gol, ✕ gagal, ○ belum menendang (minimal 5). */
export function penDots(m, side) {
  const ks = shootout(m).kicks.filter((k) => k.s === side);
  const dots = ks.map((k) => `<i class="pk ${k.g ? "g" : "m"}" title="${k.g ? "Gol" : "Gagal"}">${k.g ? "●" : "✕"}</i>`);
  while (dots.length < PEN_ROUNDS) dots.push(`<i class="pk">○</i>`);
  return dots.join("");
}

// ---------- Line up ----------
export const FUTSAL_STARTERS = 5;
/** Daftar masalah line up satu sisi; kosong berarti siap main. */
export function lineupProblems(match, side, players) {
  const lu = match["lineup" + side] || {};
  const teamId = side === "A" ? match.teamA : match.teamB;
  // hanya pemain yang benar-benar ada dan anggota tim ini (menjaga dari line up basi setelah tim diganti / pemain dihapus)
  const starters = (lu.starters || []).filter((id) => players.some((p) => p.id === id && p.teamId === teamId));
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

// ---------- Skorsing (dihitung dari kejadian, tanpa data baru) ----------
// Merah (langsung atau dari kuning kedua) = absen SUSPENSION.redMatches laga berikutnya tim itu.
// Akumulasi kuning (di laga berbeda) mencapai yellowLimit = absen 1 laga, lalu hitungan mulai dari nol.
// Dua kuning di laga yang sama sudah jadi merah, jadi tidak dihitung dua kali. Kuning dari babak grup dihapus saat babak gugur dimulai.
// Panitia bisa mengubah lamanya lewat settings/main.suspOverrides[kunci] (0 = skorsing dibatalkan, 2 = diperpanjang).
export const SUSPENSION = { yellowLimit: 2, redMatches: 1 };
export const suspKey = (playerId, matchId) => `${playerId}_${matchId}`;
export function computeSuspensions(teamId, matches, events, players, overrides = {}) {
  const L = matches.filter((m) => m.teamA === teamId || m.teamB === teamId).sort(sortByKickoff);
  const mine = new Set(players.filter((p) => p.teamId === teamId).map((p) => p.id));
  const yel = {}, out = [];
  let reset = false;
  L.forEach((m, j) => {
    if (m.status !== "ft") return;
    if (!(m.stage === "group" || !m.stage) && !reset) { for (const k of Object.keys(yel)) delete yel[k]; reset = true; }
    if (m.wo) return;
    const byP = {};
    events.filter((e) => e.matchId === m.id && e.teamId === teamId && mine.has(e.playerId) && (e.type === "yellow" || e.type === "red"))
      .forEach((e) => (byP[e.playerId] ||= []).push(e));
    for (const [pid, list] of Object.entries(byP)) {
      let kind = null;
      if (list.some((e) => e.type === "red")) kind = "red";
      else { yel[pid] = (yel[pid] || 0) + list.length; if (yel[pid] >= SUSPENSION.yellowLimit) { kind = "yellow"; yel[pid] = 0; } }
      if (!kind) continue;
      const base = kind === "red" ? SUSPENSION.redMatches : 1, key = suspKey(pid, m.id), len = overrides[key] ?? base;
      out.push({ playerId: pid, matchId: m.id, kind, base, len, key, overridden: overrides[key] != null, covers: L.slice(j + 1, j + 1 + len).map((x) => x.id) });
    }
  });
  return out;
}
/** Skorsing yang berlaku di satu laga untuk satu tim: Map playerId -> rincian. */
export function suspendedIn(match, teamId, matches, events, players, overrides = {}) {
  const map = new Map();
  if (!teamId || match.status === "ft") return map;
  for (const o of computeSuspensions(teamId, matches, events, players, overrides)) if (o.covers.includes(match.id) && !map.has(o.playerId)) map.set(o.playerId, o);
  return map;
}
export const suspReason = (o) => (o.kind === "red" ? "Kartu merah" : `Akumulasi ${SUSPENSION.yellowLimit} kartu kuning`) + (o.len !== o.base ? ` (skorsing ${o.len} laga)` : "");

// ---------- Pemain di lapangan, kiper, kartu ----------
/** Pemain yang sudah dikeluarkan (kartu merah) di laga ini. */
export const sentOffIds = (m, events) => new Set(events.filter((e) => e.matchId === m.id && e.type === "red").map((e) => e.playerId));
/** Pemain di lapangan: susunan inti, lalu pergantian (subLog), dikurangi yang dikartu merah. */
export function onCourtIds(m, side, events = []) {
  let on = [...(m["lineup" + side]?.starters || [])];
  for (const s of m.subLog || []) if (s.s === side) { on = on.filter((id) => id !== s.out); if (!on.includes(s.in)) on.push(s.in); }
  const off = sentOffIds(m, events);
  return on.filter((id) => !off.has(id));
}
/** Sisi tampil kejadian: "a" (tim A, kiri), "b" (tim B, kanan), "c" (tengah). Gol bunuh diri ditaruh di sisi tim yang diuntungkan. */
export function eventSide(m, e) {
  const team = !e.teamId ? null : e.type === "own_goal" ? (e.teamId === m.teamA ? m.teamB : m.teamA) : e.teamId;
  return team && team === m.teamA ? "a" : team && team === m.teamB ? "b" : "c";
}
/** Total kartu satu tim di satu laga. */
export const cardTotals = (events, matchId, teamId) => {
  const l = events.filter((e) => e.matchId === matchId && e.teamId === teamId);
  return { y: l.filter((e) => e.type === "yellow").length, r: l.filter((e) => e.type === "red").length };
};
/** Kiper yang sedang jaga gawang (null = kiper terbang). Laga lama tanpa pelacakan memakai kiper di susunan inti. */
export function gkNow(m, side, players) {
  const v = m["gk" + side];
  if (v !== undefined) return v;
  return (m["lineup" + side]?.starters || []).find((id) => players.find((p) => p.id === id)?.isGK) ?? null;
}

// ---------- Klasemen ----------
function blank(team) {
  return { teamId: team.id, name: team.name, group: team.group, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0, fp: 0, tb: team.tbRank ?? null, tied: false, tieId: null };
}
// Poin kartu (fair play) untuk pemisah klasemen: makin kecil makin baik.
// Kuning 1, merah langsung 3. Merah dari kuning kedua hanya +1 karena dua kuningnya sudah dihitung (total 3).
export const CARD_POINTS = { yellow: 1, red: 3, secondYellowRed: 1 };
const cardPts = (e) => (e.type === "yellow" ? CARD_POINTS.yellow : e.type === "red" ? (e.second ? CARD_POINTS.secondYellowRed : CARD_POINTS.red) : 0);
function applyResult(row, gf, ga) {
  row.p++; row.gf += gf; row.ga += ga;
  if (gf > ga) { row.w++; row.pts += 3; } else if (gf === ga) { row.d++; row.pts += 1; } else row.l++;
}

/** Mengembalikan { A: [rows...], B: [...] }, sudah terurut. */
export function computeStandings(teams, matches, events = []) {
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
  // kartu hanya dihitung dari laga grup yang sudah selesai
  const doneIds = new Set(done.map((m) => m.id));
  for (const e of events) {
    if (!doneIds.has(e.matchId) || !byId[e.teamId]) continue;
    byId[e.teamId].fp += cardPts(e);
  }
  for (const g of Object.keys(groups)) groups[g] = sortGroup(groups[g], done);
  return groups;
}

function sortGroup(rows, doneMatches) {
  // Urutan: 1) poin, 2) gol memasukkan (GM), 3) head to head (poin, selisih gol, gol),
  // 4) selisih gol keseluruhan (GM - GK), 5) poin kartu (kuning 1, merah 3; lebih sedikit lebih baik),
  // 6) urutan manual hasil adu penalti/undian (field tbRank di tim).
  // Bila semuanya masih sama, tim ditandai "tied" (seri penuh): tidak ditentukan otomatis, panitia mengisi manual.
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
      const cmp = (x, y) => {
        const hx = h2h[x.teamId], hy = h2h[y.teamId];
        return hy.pts - hx.pts || (hy.gf - hy.ga) - (hx.gf - hx.ga) || hy.gf - hx.gf
          || (y.gf - y.ga) - (x.gf - x.ga)
          || x.fp - y.fp
          || (x.tb ?? 99) - (y.tb ?? 99);
      };
      tied.sort((x, y) => cmp(x, y) || x.name.localeCompare(y.name, "id"));
      // tandai blok tim yang benar-benar seri penuh (urutan alfabet hanya tampilan, bukan penentu)
      let k = 0;
      while (k < tied.length) {
        let l = k + 1;
        while (l < tied.length && cmp(tied[k], tied[l]) === 0) l++;
        if (l - k > 1) for (let q = k; q < l; q++) { tied[q].tied = true; tied[q].tieId = `${tied[k].group}:${tied[k].teamId}`; }
        k = l;
      }
    }
    out.push(...tied);
    i = j;
  }
  return out;
}

// ---------- Statistik pemain ----------
// teams + matches bersifat opsional; bila diberikan, tiap pemain mendapat `reach` (seberapa jauh timnya bertahan) untuk penentu urutan imbang di topBy.
export function computePlayerStats(players, events, teams = null, matches = null) {
  const reach = teams && matches ? teamReachMap(teams, matches, events) : {};
  const byId = {};
  for (const p of players) byId[p.id] = { ...p, goals: 0, assists: 0, yellow: 0, red: 0, ownGoals: 0, reach: reach[p.teamId] ?? 0 };
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

/**
 * Top scorer / top assist. Urutan:
 * 1) angka utama (gol untuk top scorer, assist untuk top assist), terbanyak di atas;
 * 2) angka pendamping (top scorer: assist terbanyak; top assist: gol terbanyak);
 * 3) tim yang bertahan paling jauh di turnamen (lihat teamReachMap): juara di atas, tim yang masih bertanding di atas tim yang sudah gugur, gugur di babak lebih akhir di atas gugur lebih awal;
 * 4) hanya bila semuanya masih sama persis: abjad nama (supaya urutan tetap stabil, bukan penentu utama).
 */
export function topBy(stats, key, limit = 10) {
  const other = key === "goals" ? "assists" : "goals";
  return stats
    .filter((p) => p[key] > 0)
    .sort((a, b) => b[key] - a[key] || (b[other] || 0) - (a[other] || 0) || (b.reach || 0) - (a.reach || 0) || (a.name || "").localeCompare(b.name || "", "id"))
    .slice(0, limit);
}

/**
 * Statistik kiper (untuk Kiper Terbaik). Dihitung dari laga selesai di mana kiper masuk susunan inti:
 * main, clean sheet (lawan 0 gol, termasuk ET), kebobolan, rata-rata kebobolan, plus gol/assist/kartu dan posisi akhir timnya.
 * Bila laga memakai pelacakan kiper (tombol Ganti kiper / Pergantian), kebobolan dibebankan ke kiper yang jaga saat gol; laga lama memakai kiper di susunan inti. Clean sheet = tim tidak kebobolan sama sekali.
 * Gol adu penalti tidak dicatat sebagai gol, jadi tidak menambah kebobolan.
 */
export function computeKeeperStats(players, matches, teams = [], events = []) {
  const gks = {};
  for (const p of players) if (p.isGK && p.role !== "official") gks[p.id] = { ...p, played: 0, cleanSheets: 0, conceded: 0, goals: 0, assists: 0, yellow: 0, red: 0 };
  for (const m of matches) {
    if (m.status !== "ft" || m.wo) continue; // WO: tidak ada permainan, tidak masuk statistik kiper
    for (const side of ["A", "B"]) {
      const lineup = m["lineup" + side] || {};
      if (m["gk" + side] !== undefined) { // pelacakan kiper aktif: kebobolan dibebankan ke kiper yang jaga saat gol terjadi
        const me = side === "A" ? m.teamA : m.teamB;
        const used = (m["gkUsed" + side] || []).filter((id) => gks[id]);
        const conc = events.filter((e) => e.matchId === m.id && ((e.type === "goal" && e.teamId !== me) || (e.type === "own_goal" && e.teamId === me)));
        const first = (m["gkUsed" + side] || [])[0];
        for (const id of used) {
          const g = gks[id];
          g.played++;
          g.conceded += conc.filter((e) => ("gkId" in e ? e.gkId : first) === id).length;
          if (!conc.length) g.cleanSheets++;
        }
        continue;
      }
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
    .map((g) => ({ ...g, avg: g.played ? g.conceded / g.played : 0, progress: teamProgress(g.teamId, teams, matches, events) }))
    .filter((g) => g.played > 0)
    .sort((a, b) => b.cleanSheets - a.cleanSheets || a.avg - b.avg || b.played - a.played || a.name.localeCompare(b.name, "id"));
}
/** Statistik satu kiper walau belum main (untuk kartu Kiper Terbaik yang dipilih panitia). */
export function keeperDetail(playerId, players, matches, teams, events) {
  const all = computeKeeperStats(players, matches, teams, events);
  const hit = all.find((k) => k.id === playerId);
  if (hit) return { ...hit, rank: all.indexOf(hit) + 1, total: all.length };
  const p = players.find((x) => x.id === playerId);
  return p ? { ...p, played: 0, cleanSheets: 0, conceded: 0, avg: 0, goals: 0, assists: 0, yellow: 0, red: 0, progress: teamProgress(p.teamId, teams, matches, events), rank: null, total: all.length } : null;
}

/**
 * Sampai mana sebuah tim: { label, out } dengan label seperti "Gugur di Perempat Final", "Juara", "Masih bertanding".
 * Grup baru dianggap gugur setelah semua laga grupnya selesai dan tim tidak masuk 2 besar.
 */
export function teamProgress(teamId, teams, matches, events = [], std = null) {
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
  if (!groupDone(matches, team.group, teams)) return { label: "Masih di babak grup", out: false };
  const rows = (std || computeStandings(teams, matches, events))[team.group] || [];
  const idx = rows.findIndex((r) => r.teamId === teamId);
  if (rows[idx]?.tied && rows.some((r, i) => r.tieId === rows[idx].tieId && i < QUALIFY_PER_GROUP) && rows.some((r, i) => r.tieId === rows[idx].tieId && i >= QUALIFY_PER_GROUP))
    return { label: "Menunggu adu penalti", out: false };
  return idx < QUALIFY_PER_GROUP
    ? { label: "Lolos ke perempat final", out: false }
    : { label: "Gugur di Babak Grup", out: true };
}

/** Nilai "bertahan sampai mana" per label teamProgress; makin besar makin jauh. Dipakai sebagai penentu urutan imbang top scorer / top assist. */
const REACH_BY_LABEL = {
  "Juara": 100, "Di final": 95, "Lolos ke final": 95, "Runner-up": 90,
  "Juara 3": 80, "Perebutan juara 3": 75, "Gugur di Semi Final": 72, "Peringkat 4": 70,
  "Di semi final": 60, "Lolos ke semi final": 60,
  "Di perempat final": 40, "Lolos ke perempat final": 40, "Menunggu adu penalti": 35, "Gugur di Perempat Final": 30,
  "Masih di babak grup": 20, "Gugur di Babak Grup": 10,
};
/** { teamId: nilai } untuk semua tim; klasemen dihitung sekali saja. */
export function teamReachMap(teams, matches, events = []) {
  const std = computeStandings(teams, matches, events);
  const out = {};
  for (const t of teams) out[t.id] = REACH_BY_LABEL[teamProgress(t.id, teams, matches, events, std).label] ?? 0;
  return out;
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

/** Ikon bola untuk gol: gambar vektor (SVG, bentuk bola sepak asli) supaya tepinya selalu tajam di ukuran berapa pun.
 *  Satu sprite dipakai ulang lewat <use>, jadi daftar yang berisi banyak bola tetap ringan.
 *  Warna lewat variabel CSS: --b (jahitan dan petak), --bw (muka putih), --br (cincin tepi). cls "og" = merah (gol bunuh diri). */
const BALL_SPRITE = `<svg xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><symbol id="gball" viewBox="-50 -50 100 100"><circle r="47.8" style="fill:var(--bw,#fff)"/><clipPath id="gballClip"><circle r="47"/></clipPath><g clip-path="url(#gballClip)"><path d="M9.3 12.8L6.2 13.0L3.1 13.1L0.0 13.1L-3.1 13.1L-6.2 13.0L-9.3 12.8L-10.4 9.9L-11.5 7.0L-12.5 4.0L-13.4 1.1L-14.3 -1.9L-15.1 -4.9L-12.7 -6.8L-10.2 -8.7L-7.7 -10.6L-5.2 -12.4L-2.6 -14.2L0.0 -15.9L2.6 -14.2L5.2 -12.4L7.7 -10.6L10.2 -8.7L12.7 -6.8L15.1 -4.9L14.3 -1.9L13.4 1.1L12.5 4.0L11.5 7.0L10.4 9.9ZM15.1 -36.6L12.7 -36.2L10.2 -35.6L7.7 -34.9L5.2 -34.0L2.6 -32.9L0.0 -31.7L-2.6 -32.9L-5.2 -34.0L-7.7 -34.9L-10.2 -35.6L-12.7 -36.2L-15.1 -36.6L-14.3 -38.4L-13.4 -40.0L-12.5 -41.4L-11.5 -42.7L-10.4 -43.7L-9.3 -44.5L-6.2 -45.1L-3.1 -45.4L0.0 -45.5L3.1 -45.4L6.2 -45.1L9.3 -44.5L10.4 -43.7L11.5 -42.7L12.5 -41.4L13.4 -40.0L14.3 -38.4ZM9.3 38.5L11.0 36.7L12.7 34.8L14.3 32.8L15.8 30.5L17.3 28.2L18.6 25.7L21.4 25.1L24.1 24.5L26.7 23.7L29.2 22.8L31.5 21.8L33.7 20.8L34.1 22.7L34.4 24.5L34.4 26.2L34.4 27.8L34.1 29.2L33.7 30.6L31.5 32.8L29.2 34.9L26.7 36.8L24.1 38.6L21.4 40.1L18.6 41.5L17.3 41.5L15.8 41.3L14.3 40.8L12.7 40.2L11.0 39.5ZM-33.7 20.8L-31.5 21.8L-29.2 22.8L-26.7 23.7L-24.1 24.5L-21.4 25.1L-18.6 25.7L-17.3 28.2L-15.8 30.5L-14.3 32.8L-12.7 34.8L-11.0 36.7L-9.3 38.5L-11.0 39.5L-12.7 40.2L-14.3 40.8L-15.8 41.3L-17.3 41.5L-18.6 41.5L-21.4 40.1L-24.1 38.6L-26.7 36.8L-29.2 34.9L-31.5 32.8L-33.7 30.6L-34.1 29.2L-34.4 27.8L-34.4 26.2L-34.4 24.5L-34.1 22.7ZM39.5 3.0L38.4 0.9L37.0 -1.3L35.6 -3.5L33.9 -5.6L32.1 -7.7L30.2 -9.8L30.5 -12.6L30.7 -15.4L30.8 -18.1L30.7 -20.7L30.5 -23.2L30.2 -25.7L32.1 -25.4L33.9 -25.1L35.6 -24.7L37.0 -24.1L38.4 -23.4L39.5 -22.6L40.9 -19.9L42.2 -17.0L43.3 -14.1L44.1 -11.1L44.8 -8.0L45.2 -4.9L44.8 -3.6L44.1 -2.3L43.3 -1.0L42.2 0.4L40.9 1.7ZM-30.2 -25.7L-30.5 -23.2L-30.7 -20.7L-30.8 -18.1L-30.7 -15.4L-30.5 -12.6L-30.2 -9.8L-32.1 -7.7L-33.9 -5.6L-35.6 -3.5L-37.0 -1.3L-38.4 0.9L-39.5 3.0L-40.9 1.7L-42.2 0.4L-43.3 -1.0L-44.1 -2.3L-44.8 -3.6L-45.2 -4.9L-44.8 -8.0L-44.1 -11.1L-43.3 -14.1L-42.2 -17.0L-40.9 -19.9L-39.5 -22.6L-38.4 -23.4L-37.0 -24.1L-35.6 -24.7L-33.9 -25.1L-32.1 -25.4Z" style="fill:var(--b)"/><path d="M-46.2 0.0L-46.1 -1.2L-46.0 -2.5L-45.7 -3.7L-45.2 -4.9M-45.2 -4.9L-44.9 -7.2L-44.5 -9.5L-43.9 -11.8L-43.3 -14.1L-42.5 -16.3L-41.6 -18.4L-40.6 -20.6L-39.5 -22.6M-45.2 -4.9L-44.9 -3.9L-44.5 -2.9L-43.9 -2.0L-43.3 -1.0L-42.5 0.0L-41.6 1.0L-40.6 2.0L-39.5 3.0M-39.5 -22.6L-39.1 -23.9L-38.6 -25.0L-38.1 -26.1L-37.4 -27.2M-39.5 -22.6L-38.7 -23.2L-37.7 -23.8L-36.7 -24.2L-35.6 -24.7L-34.3 -25.0L-33.0 -25.3L-31.6 -25.5L-30.2 -25.7M-37.4 27.2L-36.6 28.1L-35.7 29.0L-34.8 29.8L-33.7 30.6M-39.5 3.0L-39.1 5.3L-38.6 7.6L-38.1 9.9L-37.4 12.1L-36.6 14.4L-35.7 16.5L-34.8 18.7L-33.7 20.8M-39.5 3.0L-38.7 1.4L-37.7 -0.2L-36.7 -1.8L-35.6 -3.5L-34.3 -5.1L-33.0 -6.7L-31.6 -8.2L-30.2 -9.8M-33.7 30.6L-34.0 29.6L-34.3 28.5L-34.4 27.4L-34.4 26.2L-34.4 24.9L-34.3 23.6L-34.0 22.2L-33.7 20.8M-33.7 30.6L-32.1 32.2L-30.4 33.9L-28.6 35.4L-26.7 36.8L-24.8 38.1L-22.8 39.4L-20.8 40.5L-18.6 41.5M-33.7 20.8L-32.1 21.6L-30.4 22.3L-28.6 23.1L-26.7 23.7L-24.8 24.3L-22.8 24.8L-20.8 25.3L-18.6 25.7M-30.2 -25.7L-30.4 -23.9L-30.6 -22.0L-30.8 -20.1L-30.8 -18.1L-30.8 -16.1L-30.6 -14.0L-30.4 -11.9L-30.2 -9.8M-30.2 -25.7L-28.5 -27.3L-26.8 -28.9L-25.0 -30.4L-23.1 -31.8L-21.2 -33.1L-19.2 -34.4L-17.2 -35.5L-15.1 -36.6M-30.2 -9.8L-28.5 -9.3L-26.8 -8.7L-25.0 -8.1L-23.1 -7.5L-21.2 -6.9L-19.2 -6.2L-17.2 -5.6L-15.1 -4.9M-14.3 -43.9L-13.1 -44.3L-11.9 -44.5L-10.6 -44.6L-9.3 -44.5M-18.6 41.5L-17.6 42.3L-16.5 43.0L-15.4 43.5L-14.3 43.9M-18.6 41.5L-17.6 41.5L-16.5 41.4L-15.4 41.2L-14.3 40.8L-13.1 40.4L-11.9 39.9L-10.6 39.2L-9.3 38.5M-18.6 25.7L-17.6 24.2L-16.5 22.8L-15.4 21.2L-14.3 19.7L-13.1 18.0L-11.9 16.3L-10.6 14.6L-9.3 12.8M-18.6 25.7L-17.6 27.5L-16.5 29.4L-15.4 31.1L-14.3 32.8L-13.1 34.3L-11.9 35.8L-10.6 37.2L-9.3 38.5M-15.1 -36.6L-14.5 -38.0L-13.8 -39.2L-13.2 -40.4L-12.5 -41.4L-11.7 -42.4L-10.9 -43.2L-10.1 -43.9L-9.3 -44.5M-15.1 -36.6L-13.3 -36.3L-11.5 -35.9L-9.6 -35.5L-7.7 -34.9L-5.8 -34.2L-3.9 -33.5L-1.9 -32.6L0.0 -31.7M-15.1 -4.9L-14.5 -2.7L-13.8 -0.4L-13.2 1.8L-12.5 4.0L-11.7 6.3L-10.9 8.5L-10.1 10.7L-9.3 12.8M-15.1 -4.9L-13.3 -6.4L-11.5 -7.8L-9.6 -9.2L-7.7 -10.6L-5.8 -12.0L-3.9 -13.3L-1.9 -14.6L0.0 -15.9M-9.3 -44.5L-7.0 -45.0L-4.7 -45.3L-2.3 -45.4L0.0 -45.5L2.3 -45.4L4.7 -45.3L7.0 -45.0L9.3 -44.5M-9.3 12.8L-7.0 12.9L-4.7 13.0L-2.3 13.1L0.0 13.1L2.3 13.1L4.7 13.0L7.0 12.9L9.3 12.8M-9.3 38.5L-7.0 38.8L-4.7 39.1L-2.3 39.2L0.0 39.3L2.3 39.2L4.7 39.1L7.0 38.8L9.3 38.5M0.0 -31.7L0.0 -30.0L0.0 -28.1L0.0 -26.3L0.0 -24.3L0.0 -22.3L0.0 -20.2L0.0 -18.0L0.0 -15.9M0.0 -31.7L1.9 -32.6L3.9 -33.5L5.8 -34.2L7.7 -34.9L9.6 -35.5L11.5 -35.9L13.3 -36.3L15.1 -36.6M0.0 -15.9L1.9 -14.6L3.9 -13.3L5.8 -12.0L7.7 -10.6L9.6 -9.2L11.5 -7.8L13.3 -6.4L15.1 -4.9M9.3 -44.5L10.1 -43.9L10.9 -43.2L11.7 -42.4L12.5 -41.4L13.2 -40.4L13.8 -39.2L14.5 -38.0L15.1 -36.6M9.3 -44.5L10.6 -44.6L11.9 -44.5L13.1 -44.3L14.3 -43.9M14.3 43.9L15.4 43.5L16.5 43.0L17.6 42.3L18.6 41.5M9.3 12.8L10.1 10.7L10.9 8.5L11.7 6.3L12.5 4.0L13.2 1.8L13.8 -0.4L14.5 -2.7L15.1 -4.9M9.3 12.8L10.6 14.6L11.9 16.3L13.1 18.0L14.3 19.7L15.4 21.2L16.5 22.8L17.6 24.2L18.6 25.7M9.3 38.5L10.6 39.2L11.9 39.9L13.1 40.4L14.3 40.8L15.4 41.2L16.5 41.4L17.6 41.5L18.6 41.5M9.3 38.5L10.6 37.2L11.9 35.8L13.1 34.3L14.3 32.8L15.4 31.1L16.5 29.4L17.6 27.5L18.6 25.7M15.1 -36.6L17.2 -35.5L19.2 -34.4L21.2 -33.1L23.1 -31.8L25.0 -30.4L26.8 -28.9L28.5 -27.3L30.2 -25.7M15.1 -4.9L17.2 -5.6L19.2 -6.2L21.2 -6.9L23.1 -7.5L25.0 -8.1L26.8 -8.7L28.5 -9.3L30.2 -9.8M18.6 41.5L20.8 40.5L22.8 39.4L24.8 38.1L26.7 36.8L28.6 35.4L30.4 33.9L32.1 32.2L33.7 30.6M18.6 25.7L20.8 25.3L22.8 24.8L24.8 24.3L26.7 23.7L28.6 23.1L30.4 22.3L32.1 21.6L33.7 20.8M30.2 -25.7L30.4 -23.9L30.6 -22.0L30.8 -20.1L30.8 -18.1L30.8 -16.1L30.6 -14.0L30.4 -11.9L30.2 -9.8M30.2 -25.7L31.6 -25.5L33.0 -25.3L34.3 -25.0L35.6 -24.7L36.7 -24.2L37.7 -23.8L38.7 -23.2L39.5 -22.6M30.2 -9.8L31.6 -8.2L33.0 -6.7L34.3 -5.1L35.6 -3.5L36.7 -1.8L37.7 -0.2L38.7 1.4L39.5 3.0M37.4 -27.2L38.1 -26.1L38.6 -25.0L39.1 -23.9L39.5 -22.6M33.7 30.6L34.0 29.6L34.3 28.5L34.4 27.4L34.4 26.2L34.4 24.9L34.3 23.6L34.0 22.2L33.7 20.8M33.7 30.6L34.8 29.8L35.7 29.0L36.6 28.1L37.4 27.2M33.7 20.8L34.8 18.7L35.7 16.5L36.6 14.4L37.4 12.1L38.1 9.9L38.6 7.6L39.1 5.3L39.5 3.0M39.5 -22.6L40.6 -20.6L41.6 -18.4L42.5 -16.3L43.3 -14.1L43.9 -11.8L44.5 -9.5L44.9 -7.2L45.2 -4.9M39.5 3.0L40.6 2.0L41.6 1.0L42.5 0.0L43.3 -1.0L43.9 -2.0L44.5 -2.9L44.9 -3.9L45.2 -4.9M46.2 0.0L46.1 -1.2L46.0 -2.5L45.7 -3.7L45.2 -4.9" style="fill:none;stroke:var(--b);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round"/></g><circle r="47.8" style="fill:none;stroke:var(--br,var(--b));stroke-width:var(--brw,4.4)"/></symbol></svg>`;
if (typeof document !== "undefined") {
  const addSprite = () => { if (!document.getElementById("gball")) document.body.insertAdjacentHTML("afterbegin", BALL_SPRITE); };
  if (document.body) addSprite(); else document.addEventListener("DOMContentLoaded", addSprite);
}
export const ballSvg = (cls = "") => `<span class="ball ${cls}" aria-hidden="true"><svg viewBox="0 0 100 100" focusable="false"><use href="#gball" width="100" height="100"/></svg></span>`;

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
/** Tempatkan laga ke slot bagan: field `slot` (1..n) dipakai bila ada; laga tanpa slot mengisi sisanya menurut urutan jam kickoff. */
function placeSlots(list, n) {
  const out = Array(n).fill(null), rest = [];
  for (const m of list) {
    const s = Number(m.slot);
    if (Number.isInteger(s) && s >= 1 && s <= n && !out[s - 1]) out[s - 1] = m; else rest.push(m);
  }
  for (let i = 0; i < n && rest.length; i++) if (!out[i]) out[i] = rest.shift();
  return out;
}

// Grup dianggap selesai bila SEMUA pertemuan round-robin sudah ada dan berstatus selesai
// (n tim -> n x (n-1) / 2 laga). Jadwal yang baru separuh dibuat tidak dianggap selesai.
export function groupDone(matches, g, teams) {
  const n = teams.filter((t) => t.group === g).length;
  if (n < 2) return false;
  const list = matches.filter((m) => (m.stage === "group" || !m.stage) && m.group === g);
  return list.length >= (n * (n - 1)) / 2 && list.every((m) => m.status === "ft");
}

/**
 * Susunan bagan. Urutan laga QF1..QF4 dan SF1..SF2 diambil dari urutan jam kickoff
 * (lalu urutan input) pada fase yang sama. Tim yang sudah pasti ikut terisi otomatis
 * di tampilan walau admin belum mengisinya di data laga.
 */
export function computeBracket(teams, matches, events = []) {
  const standings = computeStandings(teams, matches, events);
  const seedTeam = (seed) => (groupDone(matches, seed[0], teams) ? (standings[seed[0]]?.[seed[1] - 1]?.tied ? null : standings[seed[0]]?.[seed[1] - 1]?.teamId) || null : null);
  const qf = placeSlots(koSorted(matches, "qf"), 4);
  const sf = placeSlots(koSorted(matches, "sf"), 2);
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

/** Grup selesai yang masih seri penuh di posisi yang menentukan lolos/juara: perlu adu penalti, diinput manual. */
export function unresolvedTies(teams, matches, events = []) {
  const st = computeStandings(teams, matches, events), out = [];
  for (const g of Object.keys(st)) {
    if (!groupDone(matches, g, teams)) continue;
    const ids = [...new Set(st[g].filter((r) => r.tied).map((r) => r.tieId))];
    for (const id of ids) {
      const rows = st[g].filter((r) => r.tieId === id);
      if (st[g].some((r, i) => r.tieId === id && i < QUALIFY_PER_GROUP)) out.push({ group: g, rows });
    }
  }
  return out;
}

/** Daftar pengisian tim yang bisa dilakukan sekarang (hanya laga yang belum mulai). */
export function planKnockout(teams, matches, events = []) {
  const b = computeBracket(teams, matches, events);
  const slots = [...b.qf, ...b.sf, b.final, ...(b.third ? [b.third] : [])];
  const out = [];
  for (const s of slots) {
    const m = s.match;
    if (!m || m.status !== "scheduled") continue;
    const patch = {};
    const empty = () => ({ starters: [], subs: [] });
    if (s.teamA && s.teamA !== m.teamA) { patch.teamA = s.teamA; if (m.teamA) patch.lineupA = empty(); }
    if (s.teamB && s.teamB !== m.teamB) { patch.teamB = s.teamB; if (m.teamB) patch.lineupB = empty(); }
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

// Logo situs (assets/logo.png, perisai Industropolis Batang Futsal League). Bila file hilang, gambar diganti kotak bertuliskan "LOGO".
if (typeof document !== "undefined") {
  const placeholder = (img) => {
    const ph = document.createElement("span");
    ph.className = "logo-ph";
    ph.setAttribute("aria-hidden", "true");
    ph.textContent = "LOGO";
    img.replaceWith(ph);
  };
  document.addEventListener("error", (e) => { if (e.target?.matches?.("img[data-sitelogo]")) placeholder(e.target); }, true);
  // gambar yang sudah gagal sebelum skrip ini jalan (mis. logo di header statis)
  const sweep = () => document.querySelectorAll("img[data-sitelogo]").forEach((i) => { if (i.complete && i.naturalWidth === 0) placeholder(i); });
  window.addEventListener("load", sweep);
  document.addEventListener("DOMContentLoaded", sweep);
}

// ---------- Jam dinding real-time (hari, tanggal, jam:menit:detik WIB) ----------
// Pakai di halaman mana pun: tulis rtClockHtml() di markup, jam otomatis bergerak tiap detik (jam server, bukan jam perangkat).
const fmtRtDay = new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: TZ });
const fmtRtTime = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: TZ });
const rtParts = () => { const d = new Date(nowMs()); return [fmtRtDay.format(d), fmtRtTime.format(d).replace(/\./g, ":")]; };
export function rtClockHtml(cls = "") {
  const [d, t] = rtParts();
  return `<span class="rtclock ${cls}" data-rtclock><span class="rt-d">${d}</span><span class="rt-t">${t} WIB</span></span>`;
}
export function tickRtClocks() {
  const els = document.querySelectorAll("[data-rtclock]");
  if (!els.length) return;
  const [d, t] = rtParts();
  els.forEach((el) => {
    const a = el.querySelector(".rt-d"), b = el.querySelector(".rt-t");
    if (a && a.textContent !== d) a.textContent = d;
    if (b) b.textContent = t + " WIB";
  });
}
if (typeof window !== "undefined") setInterval(tickRtClocks, 1000);
