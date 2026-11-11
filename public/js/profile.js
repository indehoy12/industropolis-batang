// Data untuk profil tim, profil pemain, riwayat pertemuan, dan juara. Dipakai bersama oleh website (app.js) dan admin (admin.js).
import { computePlayerStats, keeperDetail, lineupIds, sortByKickoff, winnerSide } from "./util.js";

const isOff = (p) => p.role === "official";
const scoreOf = (m) => [m.scoreA ?? 0, m.scoreB ?? 0];

/** Hasil satu laga dari sudut pandang satu tim: { my, opp, res: M|S|K|null, pen: "menang"|"kalah"|null }. null bila laga belum selesai. */
export function resultFor(m, teamId) {
  if (m.status !== "ft") return null;
  const side = m.teamA === teamId ? "A" : "B";
  const [a, b] = scoreOf(m), my = side === "A" ? a : b, opp = side === "A" ? b : a;
  const res = my > opp ? "M" : my < opp ? "K" : "S";
  const w = winnerSide(m);
  return { my, opp, res, side, pen: res === "S" && w ? (w === side ? "menang" : "kalah") : null };
}

/** Ringkasan satu tim: main, M/S/K, gol, kebobolan, assist, kartu, riwayat laga. */
export function teamSummary(teamId, { matches, events, players, playerById }) {
  const mine = matches.filter((m) => m.teamA === teamId || m.teamB === teamId).sort(sortByKickoff);
  const history = mine.map((m) => ({ m, opp: m.teamA === teamId ? m.teamB : m.teamA, r: resultFor(m, teamId) }));
  const done = history.filter((h) => h.r);
  const ev = events.filter((e) => e.teamId === teamId);
  const stats = computePlayerStats(players, events).filter((p) => p.teamId === teamId && !isOff(p));
  return {
    played: done.length,
    w: done.filter((h) => h.r.res === "M").length, d: done.filter((h) => h.r.res === "S").length, l: done.filter((h) => h.r.res === "K").length,
    gf: done.reduce((s, h) => s + h.r.my, 0), ga: done.reduce((s, h) => s + h.r.opp, 0),
    goals: ev.filter((e) => e.type === "goal").length,
    ownGoals: ev.filter((e) => e.type === "own_goal").length,
    assists: ev.filter((e) => e.type === "goal" && e.assistId).length,
    yellow: ev.filter((e) => e.type === "yellow").length,
    red: ev.filter((e) => e.type === "red").length,
    history,
    roster: stats.sort((a, b) => (a.number ?? 999) - (b.number ?? 999) || (a.name || "").localeCompare(b.name || "", "id")),
  };
}

/** Profil pemain: statistik total dan baris per laga (gol, assist, kartu). null bila pemain tidak ada. */
export function playerProfile(id, { matches, events, players, teams, playerById }) {
  const p = playerById[id];
  if (!p) return null;
  const stat = computePlayerStats(players, events).find((x) => x.id === id) || { goals: 0, assists: 0, yellow: 0, red: 0, ownGoals: 0 };
  const rows = [];
  for (const m of [...matches].sort(sortByKickoff)) {
    if (m.status === "scheduled") continue;
    const inA = lineupIds(m, "A").includes(id), inB = lineupIds(m, "B").includes(id);
    const evs = events.filter((e) => e.matchId === m.id);
    const goals = evs.filter((e) => e.type === "goal" && e.playerId === id);
    const og = evs.filter((e) => e.type === "own_goal" && e.playerId === id);
    const assists = evs.filter((e) => e.type === "goal" && e.assistId === id);
    const yellow = evs.filter((e) => e.type === "yellow" && e.playerId === id);
    const red = evs.filter((e) => e.type === "red" && e.playerId === id);
    const played = inA || inB;
    if (!played && !(goals.length || og.length || assists.length || yellow.length || red.length)) continue;
    const teamId = inA ? m.teamA : inB ? m.teamB : p.teamId;
    const opp = m.teamA === teamId ? m.teamB : m.teamA;
    rows.push({ m, teamId, opp, played, goals, og, assists, yellow, red, r: resultFor(m, teamId) });
  }
  const keeper = p.isGK ? keeperDetail(id, players, matches, teams, events) : null;
  return { p, stat, rows, played: rows.filter((r) => r.played).length, keeper };
}

/** Pertemuan lain antara dua tim yang sama (laga selesai, bukan laga ini), terbaru dulu, plus total dari sudut tim A laga ini. */
export function headToHead(m, matches) {
  if (!m.teamA || !m.teamB) return null;
  const list = matches.filter((x) => x.id !== m.id && x.status === "ft" && ((x.teamA === m.teamA && x.teamB === m.teamB) || (x.teamA === m.teamB && x.teamB === m.teamA)))
    .sort((a, b) => sortByKickoff(b, a));
  const t = { w: 0, d: 0, l: 0, gf: 0, ga: 0 };
  for (const x of list) {
    const r = resultFor(x, m.teamA);
    t.gf += r.my; t.ga += r.opp;
    if (r.res === "M") t.w++; else if (r.res === "K") t.l++; else t.d++;
  }
  return { list, ...t };
}

/** Juara turnamen. null bila final belum selesai. */
export function championInfo(matches) {
  const fin = matches.find((m) => m.stage === "final" && m.status === "ft");
  const w = winnerSide(fin);
  if (!w) return null;
  const pick = (m, s) => (s === "A" ? m.teamA : m.teamB);
  const third = matches.find((m) => m.stage === "third" && m.status === "ft");
  const tw = winnerSide(third);
  return {
    fin, champion: pick(fin, w), runnerUp: pick(fin, w === "A" ? "B" : "A"),
    third: tw ? pick(third, tw) : null, fourth: tw ? pick(third, tw === "A" ? "B" : "A") : null,
  };
}
