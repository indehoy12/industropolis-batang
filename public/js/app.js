// Website publik Industropolis Batang Futsal League: router hash + tampilan realtime.
import { state, startStore, onChange, isReady } from "./store.js";
import {
  TOURNAMENT, STAGES, esc, timeStr, dayLong, dayShort, dayKey, toDate, sortByKickoff,
  clockText, computeStandings, computePlayerStats, computeKeeperStats, keeperDetail, topBy, computeBracket, winnerSide,
  livePill, ftText, addedText, eventMinute, eventCmp, phaseOf,
  REGISTRATION, registrationState, QUALIFY_PER_GROUP, syncServerTime, nowMs, lineupIds, ballSvg,
  skeleton, shootout, penScoreText, penDots, rtClockHtml, tickRtClocks,
} from "./util.js";

const $app = document.getElementById("app");
const $nav = document.getElementById("nav");
const $bar = document.getElementById("sitebar");
const $burger = document.getElementById("burger");
const $scrim = document.getElementById("scrim");

// ---------- Helper tampilan ----------
const COLORS = ["#1f4fa8", "#c4570a", "#0f766e", "#6d3fb5", "#b4233f", "#2f7d3a", "#1b78a8", "#a1700a"];
function colorFor(team) {
  if (team?.color) return team.color;
  let h = 0;
  for (const c of team?.id || "x") h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}
function initials(team) {
  if (team?.short) return team.short.slice(0, 3).toUpperCase();
  const w = (team?.name || "?").trim().split(/\s+/);
  if (w.length > 1 && /^tim$/i.test(w[0])) return w.slice(1).join("").slice(0, 3).toUpperCase();
  return w.length > 1 ? (w[0][0] + w[1][0]).toUpperCase() : w[0].slice(0, 3).toUpperCase();
}
function badge(team, sm = false, size = "") {
  const cls = sm ? "tbadge sm" : size ? `tbadge ${size}` : "tbadge";
  if (team?.logoUrl && !team.logoUrl.startsWith("/assets/logos/")) return `<span class="${cls}"><img src="${esc(team.logoUrl)}" alt="" loading="lazy"></span>`;
  return `<span class="${cls}" style="background:${colorFor(team)}">${esc(initials(team))}</span>`;
}
const tName = (id) => state.teamById[id]?.name ?? "Belum ditentukan";
// Nama sisi laga; untuk babak gugur yang timnya belum pasti tampil "Juara A", "Pemenang QF1", dst.
let slotByMatch = new Map();
function sideName(m, side) {
  const id = side === "A" ? m.teamA : m.teamB;
  if (state.teamById[id]) return state.teamById[id].name;
  const slot = slotByMatch.get(m.id);
  if (!slot) return "Belum ditentukan";
  const rid = side === "A" ? slot.teamA : slot.teamB;
  return state.teamById[rid]?.name ?? (side === "A" ? slot.labelA : slot.labelB);
}
const pName = (id) => state.playerById[id]?.name ?? "–";
const stageChip = (m) => (m.stage === "group" || !m.stage ? `Grup ${esc(m.group || "?")}` : STAGES[m.stage] || esc(m.stage));
const matchLabel = (m) =>
  m.stage === "group" || !m.stage
    ? `Grup ${esc(m.group || "?")} · Matchday ${esc(m.matchday ?? 1)}`
    : STAGES[m.stage] || esc(m.stage);

// "BABAK 2 · 11'", "JEDA · Cedera", "ISTIRAHAT", "ADU PENALTI" (kuning saat jam berhenti)
function statusPill(m) {
  if (m.status === "live") { const l = livePill(m); return `<span class="pill live ${l.halted ? "pause" : ""}" data-clock="${esc(m.id)}">${esc(l.text)}</span>`; }
  if (m.status === "ft") return `<span class="pill ft">${ftText(m)}</span>`;
  return `<span class="pill soon">${m.kickoff ? timeStr(m.kickoff) : "Segera"}</span>`;
}
const scoreText = (m) => `${m.scoreA ?? 0} – ${m.scoreB ?? 0}`;
const penNote = (m) => {
  if (!(m.status === "ft" && m.stage && m.stage !== "group" && (m.scoreA ?? 0) === (m.scoreB ?? 0) && m.penWinner)) return "";
  const sc = penScoreText(m); // urutan Tim A–Tim B, searah dengan skor di baris yang sama
  return sc ? ` (pen ${sc})` : ` (pen: ${esc(tName(m.penWinner === "A" ? m.teamA : m.teamB))})`;
};

// Menu atas: Beranda, Bagan, dan satu cabang "Info" (Tim, Jadwal, Klasemen, Statistik).
const NAV = [
  { href: "#/", label: "Beranda", key: "home" },
  { href: "#/bagan", label: "Bagan", key: "bagan" },
  { label: "Info", key: "info", sub: [
    ["#/tim", "Tim", "tim"],
    ["#/jadwal", "Jadwal", "jadwal"],
    ["#/klasemen", "Klasemen", "klasemen"],
    ["#/statistik", "Statistik", "statistik"],
  ] },
];
let subOpen = false;

// ---------- Router ----------
function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  return { name: parts[0] || "home", id: parts[1], tab: parts[2] };
}

// state UI sederhana
let homeGroup = null;
let jadwalFilter = "all";
const openTeams = new Set();
let scrolledJadwal = false;
let lastKey = "";
let lastHtml = "";
let tvEnter = false; // true: layar TV baru memudar masuk
// Skeleton shimmer sekilas tiap pindah halaman (selain saat data belum siap)
let skelOn = false, skelTimer;
const SKEL_KIND = { home: "home", laga: "detail", tim: "grid" };
function startSkeleton() {
  skelOn = true; clearTimeout(skelTimer);
  skelTimer = setTimeout(() => { skelOn = false; lastHtml = ""; render(); }, 350);
}

// ---------- Tampilan: Beranda ----------
function groupsOf(standings) { return Object.keys(standings).sort(); }

// Penanda seri penuh (r.tied) tetap ada di HTML tetapi transparan, jadi tidak terlihat oleh penonton.
const tieMark = (r) => (r.tied ? ' <span class="tie" aria-hidden="true">*</span>' : "");
function standingsTable(rows, qualify) {
  if (!rows.length) return `<p class="empty">Belum ada tim di grup ini.</p>`;
  return `<table class="std"><thead><tr>
    <th>#</th><th class="tm">Tim</th><th>Main</th><th class="opt">M</th><th class="opt">S</th><th class="opt">K</th><th>GM</th><th class="opt">GK</th><th>SG</th><th>Poin</th>
  </tr></thead><tbody>${rows
    .map(
      (r, i) => `<tr class="${i < qualify && r.p > 0 ? "q" : ""}">
      <td class="rank">${i + 1}</td><td class="tm">${state.teamById[r.teamId]?.logoUrl && !state.teamById[r.teamId].logoUrl.startsWith("/assets/logos/") ? `<span class="tmrow">${badge(state.teamById[r.teamId], true)}${esc(r.name)}${tieMark(r)}</span>` : esc(r.name) + tieMark(r)}</td><td>${r.p}</td>
      <td class="opt">${r.w}</td><td class="opt">${r.d}</td><td class="opt">${r.l}</td>
      <td>${r.gf}</td><td class="opt">${r.ga}</td><td>${r.gf - r.ga > 0 ? "+" : ""}${r.gf - r.ga}</td><td class="pts">${r.pts}</td></tr>`
    )
    .join("")}</tbody></table>`;
}
const standingNote = () =>
  `<p class="note">Garis oranye: posisi yang lolos ke perempat final (2 teratas tiap grup). Urutan: poin, gol memasukkan (GM), head to head, selisih gol (SG), lalu kartu (kuning 1, merah 3; lebih sedikit lebih tinggi). Jika masih sama, ditentukan adu penalti oleh panitia.</p>`;

function statTiles(stats) {
  const li = (list, key) => {
    const rows = list.slice(0, 3).map((p) => `<div class="li"><span>${esc(p.name)}</span><b>${p[key]}</b></div>`);
    while (rows.length < 3) rows.push(`<div class="li empty-li"><span>–</span><span>–</span></div>`);
    return rows.join("");
  };
  const gk = state.playerById[state.settings.bestGkId];
  const gd = gk ? keeperDetail(gk.id, state.players, state.matches, state.teams, state.events) : null;
  return `<div class="mini-stats">
    <div class="sheet"><h3>Top scorer</h3>${li(topBy(stats, "goals", 3), "goals")}</div>
    <div class="sheet"><h3>Top assist</h3>${li(topBy(stats, "assists", 3), "assists")}</div>
  </div>
  <div class="sheet gkrow" style="margin-top:12px"><span class="muted">Kiper terbaik</span><b>${gk ? `${esc(gk.name)} <span class="muted small" style="font-family:var(--font);font-weight:400">· ${esc(tName(gk.teamId))}${gd && gd.played ? ` · CS ${gd.cleanSheets} · KB ${gd.conceded}` : ""}</span>` : `<span class="muted" style="font-family:var(--font);font-size:15px;font-weight:400">Dipilih panitia di akhir turnamen</span>`}</b></div>`;
}

const sponsors = `<div class="sponsors">
  <img class="big" src="assets/logo-industropolis.png" alt="Industropolis Batang, Member of Danareksa">
  <hr>
  <img src="assets/logo-sez.png" alt="Indonesia SEZ - Dewan Nasional Kawasan Ekonomi Khusus">
  <hr>
  <img src="assets/logo-danantara.png" alt="Danantara Indonesia Sovereign Fund">
</div>`;

const gallery = `<div class="gallery">
  <figure class="g-main"><img src="assets/foto/foto-laga-indoprowel.jpg" alt="Pemain Indoprowel merayakan gol di lapangan futsal Industropolis Batang" width="2000" height="2500" loading="lazy" decoding="async"><figcaption>Suasana laga di lapangan Industropolis Batang</figcaption></figure>
  <figure class="g-wasit"><img src="assets/foto/wasit-salaman.jpg" alt="Kapten tim dan wasit berjabat tangan sebelum pertandingan" width="1600" height="2000" loading="lazy" decoding="async"><figcaption>Sportivitas</figcaption></figure>
  <figure class="g-gol"><img src="assets/foto/jaring-gawang.jpg" alt="Bola futsal tersangkut di jaring gawang" width="1600" height="2000" loading="lazy" decoding="async"><figcaption>Gol!</figcaption></figure>
  <figure class="g-tim"><img src="assets/foto/tim-foto.jpg" alt="Para pemain berpose bersama sebelum pertandingan" width="1600" height="2000" loading="lazy" decoding="async"><figcaption>Satu tim</figcaption></figure>
  <figure class="g-sup"><img src="assets/foto/suporter.jpg" alt="Suporter membawa thunderstick merah mendukung timnya" width="1600" height="2000" loading="lazy" decoding="async"><figcaption>Suporter</figcaption></figure>
  <figure class="g-arena"><img src="assets/foto/arena-udara.jpg" alt="Foto udara lapangan Sagara Futsal Arena di KEK Industropolis Batang" width="2000" height="1250" loading="lazy" decoding="async"><figcaption>Sagara Futsal Arena</figcaption></figure>
  <figure class="g-kick"><img src="assets/foto/bola-garis.jpg" alt="Bola futsal di atas garis lapangan" width="1600" height="2000" loading="lazy" decoding="async"><figcaption>Kick off</figcaption></figure>
  <figure class="g-siap"><img src="assets/foto/bola-lapangan.jpg" alt="Bola futsal di tengah lapangan, penonton menunggu di balik pagar" width="1600" height="2000" loading="lazy" decoding="async"><figcaption>Siap bertanding</figcaption></figure>
</div>`;

// Bilah atas (HTML statis di index.html) mengikuti TOURNAMENT supaya nama cukup diubah di util.js
document.querySelectorAll(".brand-t b").forEach((el) => { el.textContent = TOURNAMENT.line1; });
document.querySelectorAll(".brand-t i").forEach((el) => { el.textContent = TOURNAMENT.line2; });
document.querySelector(".brand")?.setAttribute("aria-label", `${TOURNAMENT.name}, ke beranda`);

const footer = `<footer class="foot">${TOURNAMENT.name} · ${TOURNAMENT.venue}<br><a href="admin/">Login panitia</a></footer>`;
const dateRange = "20 Nov – 4 Des 2026";

let boardIdx = 0;
function boardItems(live, next) {
  const items = live.map((m) => ({ m, kind: "live" }));
  if (next[0]) items.push({ m: next[0], kind: "next" });
  return items;
}
function boardView(items) {
  if (!items.length) {
    return `<div class="board-in"><div class="board-idle">
      <img class="idle-logo" src="assets/logo.png" alt="Logo ${esc(TOURNAMENT.name)}" width="150" height="181" data-sitelogo>
      <h1>${esc(TOURNAMENT.line1)}<em>${esc(TOURNAMENT.line2)}</em></h1>
      <div class="idle-facts"><span>16 Team</span><span>League System</span><span>31 Match</span></div>
      <p class="idle-when"><i>${dateRange}</i><b>${esc(TOURNAMENT.tagline)}</b></p>
      <div class="acts"><a class="board-link" href="#/jadwal">Lihat jadwal</a><a class="board-link ghost" href="#/klasemen">Klasemen</a></div>
    </div></div>`;
  }
  if (boardIdx >= items.length) boardIdx = 0;
  const { m, kind } = items[boardIdx];
  const A = state.teamById[m.teamA], B = state.teamById[m.teamB];
  const meta = kind === "live" ? matchLabel(m) : `Laga berikutnya · ${matchLabel(m)}`;
  const when = kind === "next" ? (m.kickoff ? `${dayLong(m.kickoff)}, ${timeStr(m.kickoff)} WIB` : "Waktu akan ditentukan") : "";
  return `<div class="board-in">
    <p class="board-meta">${meta}</p>
    <div class="board-score">
      <div class="board-team">${badge(A, false, "lg")}${esc(sideName(m, "A"))}</div>
      <div class="board-num ${kind === "next" ? "vs" : ""}">${kind === "next" ? "vs" : scoreText(m)}</div>
      <div class="board-team">${badge(B, false, "lg")}${esc(sideName(m, "B"))}</div>
    </div>
    <div class="board-foot">${kind === "live" ? statusPill(m) : `<span class="board-meta">${when}</span>`}<a class="board-link" href="#/laga/${esc(m.id)}">Detail pertandingan</a></div>
    ${items.length > 1 ? `<div class="board-tabs" role="tablist" aria-label="Pilih laga">${items.map((_, i) => `<button type="button" role="tab" aria-selected="${i === boardIdx}" class="${i === boardIdx ? "on" : ""}" data-board="${i}" aria-label="Laga ${i + 1}"></button>`).join("")}</div>` : ""}
  </div>`;
}

function homeView() {
  const { matches, settings } = state;
  const live = matches.filter((m) => m.status === "live").sort(sortByKickoff);
  const next = matches.filter((m) => m.status === "scheduled").sort(sortByKickoff).slice(0, 3);
  const last = matches.filter((m) => m.status === "ft").sort((a, b) => sortByKickoff(b, a)).slice(0, 3);
  const standings = computeStandings(state.teams, matches, state.events);
  const groups = groupsOf(standings);
  if (!homeGroup || !standings[homeGroup]) homeGroup = live[0]?.group && standings[live[0].group] ? live[0].group : groups[0];
  const stats = computePlayerStats(state.players, state.events, state.teams, state.matches);
  const a = settings.announcement;
  const st = registrationState();

  let h = `<div class="banner-wrap"><section class="board" aria-label="Laga utama">${boardView(boardItems(live, next))}</section>
    <div class="strip" aria-label="Informasi turnamen">
      <div><small>Tanggal</small><b>${dateRange}</b></div>
      <div><small>Lokasi</small><b>${esc(TOURNAMENT.venue)}</b></div>
      <div><small>Peserta</small><b>16 tim, 4 grup</b></div>
      <div><small>Format</small><b>Grup, lalu babak gugur</b></div>
    </div></div>`;

  if (a?.active && (a.title || a.body)) h += `<div class="announce"><h3>${esc(a.title)}</h3><p>${esc(a.body)}</p></div>`;
  if (st !== "closed") {
    h += `<div class="regbar"><div><b>${st === "open" ? "Pendaftaran tim dibuka" : "Pendaftaran tim segera dibuka"}</b>
      <span>${st === "open" ? `Ditutup ${dayLong(REGISTRATION.close)}, ${timeStr(REGISTRATION.close)} WIB` : `Mulai ${dayLong(REGISTRATION.open)}`}</span></div>${regCta("")}</div>`;
  }

  h += '<div class="home-grid"><div class="hcol">';
  if (live.length) {
    h += `<div class="head"><h2>Sedang berlangsung</h2></div>` + live.map((m) => `<a class="livecard" href="#/laga/${esc(m.id)}">
      <div class="top"><span>${matchLabel(m)}</span>${statusPill(m)}</div>
      <div class="scoreline"><span class="t">${esc(sideName(m, "A"))}</span><span class="s">${scoreText(m)}</span><span class="t r">${esc(sideName(m, "B"))}</span></div></a>`).join("");
  }
  h += `<div class="head"><h2>Laga berikutnya</h2><a href="#/jadwal">Semua jadwal</a></div><div class="sheet">${next.length ? next.map(matchRow).join("") : `<p class="empty">Belum ada jadwal berikutnya.</p>`}</div>`;
  h += `<div class="head"><h2>Hasil terakhir</h2></div><div class="sheet">${last.length ? last.map(resultRow).join("") : `<p class="empty">Belum ada pertandingan yang selesai.</p>`}</div>`;
  h += '</div><div class="hcol">';
  h += `<div class="head"><h2>Klasemen${homeGroup ? " Grup " + esc(homeGroup) : ""}</h2><a href="#/klasemen">Semua grup</a></div>`;
  if (groups.length > 1) h += `<div class="chips">${groups.map((g) => `<button class="chip ${g === homeGroup ? "on" : ""}" data-group="${esc(g)}">Grup ${esc(g)}</button>`).join("")}</div>`;
  h += `<div class="sheet">${homeGroup ? standingsTable(standings[homeGroup], QUALIFY_PER_GROUP) : `<p class="empty">Klasemen tampil setelah tim dan grup dibuat.</p>`}</div>${homeGroup ? standingNote() : ""}`;
  h += `<div class="head"><h2>Statistik pemain</h2><a href="#/statistik">Selengkapnya</a></div>${statTiles(stats)}`;
  h += "</div></div>";
  h += `<div class="head"><h2>Info turnamen</h2></div><div id="bn-slot"></div>`;
  h += `<div class="head"><h2>Suasana turnamen</h2></div>${gallery}`;
  h += `<div class="head"><h2>Penyelenggara</h2></div>${sponsors}${footer}`;
  return h;
}

function matchRow(m) {
  const today = dayKey(new Date()) === dayKey(m.kickoff);
  return `<a class="mrow" href="#/laga/${esc(m.id)}">
    <div class="when">${timeStr(m.kickoff)}${today ? "" : `<small>${dayShort(m.kickoff)}</small>`}</div>
    <div class="vs">${esc(sideName(m, "A"))} vs ${esc(sideName(m, "B"))}<span class="sub">${matchLabel(m)}</span></div><span></span></a>`;
}
function resultRow(m) {
  const a = m.scoreA ?? 0, b = m.scoreB ?? 0;
  return `<a class="res" href="#/laga/${esc(m.id)}">
    <span class="tn ${a > b ? "win" : ""}">${esc(sideName(m, "A"))}</span>
    <span class="sc">${a} – ${b}</span>
    <span class="tn r ${b > a ? "win" : ""}">${esc(sideName(m, "B"))}</span></a>`;
}

// ---------- Jadwal ----------
function jadwalView() {
  const all = [...state.matches].sort(sortByKickoff);
  const groups = [...new Set(all.filter((m) => m.stage === "group" || !m.stage).map((m) => m.group).filter(Boolean))].sort();
  const hasKo = all.some((m) => m.stage && m.stage !== "group");
  const filtered = all.filter((m) => {
    if (jadwalFilter === "all") return true;
    if (jadwalFilter === "ko") return m.stage && m.stage !== "group";
    return (m.stage === "group" || !m.stage) && m.group === jadwalFilter;
  });
  let h = `<div class="head"><h2>Jadwal</h2></div><div class="chips">
    <button class="chip ${jadwalFilter === "all" ? "on" : ""}" data-filter="all">Semua</button>
    ${groups.map((g) => `<button class="chip ${jadwalFilter === g ? "on" : ""}" data-filter="${esc(g)}">Grup ${esc(g)}</button>`).join("")}
    ${hasKo ? `<button class="chip ${jadwalFilter === "ko" ? "on" : ""}" data-filter="ko">Babak gugur</button>` : ""}</div>`;
  if (!filtered.length) return h + `<div class="sheet"><p class="empty">Belum ada jadwal.</p></div>`;
  const byDay = new Map();
  for (const m of filtered) {
    const k = dayKey(m.kickoff);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(m);
  }
  const todayKey = dayKey(new Date());
  let anchored = false;
  h += `<div class="days">`;
  for (const [k, list] of byDay) {
    const isAnchor = !anchored && k !== "tbd" && k >= todayKey;
    if (isAnchor) anchored = true;
    h += `<div class="day"><div class="daygroup" ${isAnchor ? 'id="today-anchor"' : ""}>${k === "tbd" ? "Waktu akan ditentukan" : dayLong(list[0].kickoff)}${k === todayKey ? " (hari ini)" : ""}</div><div class="sheet">`;
    h += list.map((m) => {
      const mid = m.status === "scheduled"
        ? `${esc(sideName(m, "A"))} vs ${esc(sideName(m, "B"))}`
        : `${esc(sideName(m, "A"))} <b>${scoreText(m)}</b> ${esc(sideName(m, "B"))}${penNote(m)}`;
      return `<a class="mrow ${m.status === "live" ? "liverow" : ""}" href="#/laga/${esc(m.id)}"><div class="when">${timeStr(m.kickoff)}</div><div class="vs">${mid}<span class="sub">${matchLabel(m)}</span></div>${m.status === "scheduled" ? "<span></span>" : statusPill(m)}</a>`;
    }).join("");
    h += `</div></div>`;
  }
  return h + `</div>`;
}

// ---------- Klasemen ----------
function klasemenView() {
  const standings = computeStandings(state.teams, state.matches, state.events);
  const gs = groupsOf(standings);
  if (!gs.length) return `<div class="head"><h2>Klasemen</h2></div><div class="sheet"><p class="empty">Klasemen tampil setelah tim dan grup dibuat.</p></div>`;
  return `<div class="head"><h2>Klasemen</h2></div><div class="groups-grid">` +
    gs.map((g) => `<div class="sheet"><div class="gtitle">Grup ${esc(g)}</div>${standingsTable(standings[g], QUALIFY_PER_GROUP)}</div>`).join("") +
    `</div>${standingNote()}<p class="note">M menang, S seri, K kalah, GM gol memasukkan, GK gol kemasukan, SG selisih gol. Poin: menang 3, seri 1, kalah 0.</p>`;
}

// ---------- Bagan ----------
function bracketTeam(slot, side, m) {
  const id = side === "A" ? slot.teamA : slot.teamB;
  const label = side === "A" ? slot.labelA : slot.labelB;
  const team = id ? state.teamById[id] : null;
  const w = m && winnerSide(m);
  const score = m && m.status !== "scheduled" ? (side === "A" ? m.scoreA : m.scoreB) ?? 0 : null;
  const won = w === side;
  return `<div class="bt ${team ? "" : "tbd"} ${won ? "win" : ""} ${w && !won ? "lose" : ""}">
    ${team ? badge(team, true) : `<span class="tbadge sm ph" aria-hidden="true">?</span>`}
    <span class="nm">${team ? esc(team.name) : esc(label)}</span>${score !== null ? `<b class="sc">${score}</b>` : ""}</div>`;
}
function bracketCard(slot, cls = "") {
  const m = slot.match;
  const when = m?.kickoff ? `${dayShort(m.kickoff)}, ${timeStr(m.kickoff)}` : "Waktu akan ditentukan";
  const tie = m && m.status === "ft" && (m.scoreA ?? 0) === (m.scoreB ?? 0) && m.penWinner;
  const penTeam = tie ? state.teamById[m.penWinner === "A" ? slot.teamA : slot.teamB] : null;
  const right = m?.status === "live" ? statusPill(m) : m?.status === "ft" ? "FT" : esc(when);
  const body = `<div class="bhead"><span>${esc(slot.name)}</span><span>${right}</span></div>
    ${bracketTeam(slot, "A", m)}${bracketTeam(slot, "B", m)}${m?.status === "ft" ? `<div class="bnote">${esc(when)}${penTeam ? `. Menang adu penalti: ${esc(penTeam.name)}${penScoreText(m, true) ? ` (${penScoreText(m, true)})` : ""}` : ""}</div>` : ""}`;
  return m
    ? `<a class="bm ${cls}" href="#/laga/${esc(m.id)}" aria-label="${esc(slot.name)}: lihat detail laga">${body}</a>`
    : `<div class="bm ${cls}">${body}</div>`;
}
function baganView() {
  const b = computeBracket(state.teams, state.matches, state.events);
  const empty = !b.qf.some((s) => s.match) && !b.sf.some((s) => s.match) && !b.final.match;
  const champ = (() => {
    const m = b.final.match, w = m && winnerSide(m);
    return w ? state.teamById[w === "A" ? b.final.teamA : b.final.teamB] : null;
  })();
  return `<div class="head"><h2>Bagan babak gugur</h2></div>
  ${champ ? `<div class="champ"><span>Juara IBFL 2026</span><div class="tmrow">${badge(champ)}<b>${esc(champ.name)}</b></div></div>` : ""}
  ${empty ? `<p class="note" style="margin:0 0 10px">Jadwal babak gugur belum dibuat. Pasangan terisi otomatis setelah fase grup selesai.</p>` : ""}
  <div class="bracket" role="group" aria-label="Bagan perempat final, semifinal, dan final">
    <section class="round r-qf" aria-label="Perempat final"><h3>Perempat final</h3><div class="rc">${b.qf.map((s) => bracketCard(s)).join("")}</div></section>
    <section class="round r-sf" aria-label="Semifinal"><h3>Semifinal</h3><div class="rc">${b.sf.map((s) => bracketCard(s)).join("")}</div></section>
    <section class="round r-fn" aria-label="Final"><h3>Final</h3><div class="rc">${bracketCard(b.final, "final")}${b.third ? `<h3 class="third">Juara 3</h3>${bracketCard(b.third)}` : ""}</div></section>
  </div>
  <p class="note">Juara dan runner-up grup terisi otomatis setelah semua laga grupnya selesai. Laga seri di babak gugur ditentukan lewat adu penalti.</p>${footer}`;
}

// ---------- Statistik ----------
function playerRows(list, key, unit) {
  if (!list.length) return `<p class="empty">Belum ada data.</p>`;
  return list.map((p, i) => `<div class="prow"><span class="n">${i + 1}</span>
    <span class="who"><b>${esc(p.name)}</b><span>${esc(tName(p.teamId))}</span></span><span class="v">${p[key]}${unit ? ` <small>${unit}</small>` : ""}</span></div>`).join("");
}
function keeperAward(gk) {
  const d = keeperDetail(gk.id, state.players, state.matches, state.teams, state.events);
  if (!d) return "";
  const team = state.teamById[d.teamId];
  const box = (v, l) => `<div><b>${v}</b><small>${l}</small></div>`;
  const cards = d.yellow || d.red ? ` Kartu: ${d.yellow} kuning, ${d.red} merah.` : "";
  return `<div class="sheet gkaward">
    <span class="gk-tag">Kiper terbaik</span>
    <div class="gk-who"><div class="tmrow">${badge(team)}<div><h3>${esc(d.name)}</h3><p>${esc(tName(d.teamId))}${d.number != null ? ` · No. ${esc(d.number)}` : ""}</p></div></div>
      <span class="gk-prog ${d.progress.out ? "out" : ""}">${esc(d.progress.label)}</span></div>
    <div class="gk-grid">${box(d.played, "Main")}${box(d.cleanSheets, "Clean sheet")}${box(d.conceded, "Kebobolan")}${box(d.played ? d.avg.toFixed(1) : "–", "Rata-rata kebobolan")}${box(d.goals, "Gol")}${box(d.assists, "Assist")}</div>
    <p class="sub">Dipilih panitia.${d.rank ? ` Peringkat ${d.rank} dari ${d.total} kiper menurut clean sheet.` : ""}${cards} Dihitung dari kiper di susunan inti laga selesai; gol adu penalti tidak dihitung.</p></div>`;
}
function statistikView() {
  const stats = computePlayerStats(state.players, state.events, state.teams, state.matches);
  const keepers = computeKeeperStats(state.players, state.matches, state.teams, state.events).slice(0, 10);
  const gk = state.playerById[state.settings.bestGkId];
  const carded = stats.filter((p) => p.yellow + p.red > 0).sort((a, b) => b.red - a.red || b.yellow - a.yellow).slice(0, 8);
  return `<div class="head"><h2>Statistik pemain</h2></div><div class="stats-grid">
  ${gk ? keeperAward(gk) : `<div class="sheet gkaward idle"><span class="gk-tag">Kiper terbaik</span><p class="muted">Belum ditentukan. Dipilih panitia di akhir turnamen; peringkat kiper ada di bawah.</p></div>`}
  <div class="sheet"><h3>Top scorer</h3>${playerRows(topBy(stats, "goals"), "goals", "gol")}</div>
  <div class="sheet"><h3>Top assist</h3>${playerRows(topBy(stats, "assists"), "assists", "assist")}</div>
  <div class="sheet"><h3>Peringkat kiper</h3>${keepers.length ? `<table class="tbl-sm"><thead><tr><th>Kiper</th><th>Main</th><th>CS</th><th>KB</th><th>Rata²</th></tr></thead><tbody>${keepers.map((k) => `<tr><td><b>${esc(k.name)}</b><br><span class="muted small">${esc(tName(k.teamId))} · <span class="${k.progress.out ? "gk-out" : ""}">${esc(k.progress.label)}</span></span></td><td>${k.played}</td><td><b>${k.cleanSheets}</b></td><td>${k.conceded}</td><td>${k.avg.toFixed(1)}</td></tr>`).join("")}</tbody></table><p class="note" style="padding:8px 16px 12px">CS = clean sheet (lawan tidak mencetak gol), KB = kebobolan. Perpanjangan waktu dihitung, adu penalti tidak.</p>` : `<p class="empty">Belum ada data. Dihitung dari laga selesai.</p>`}</div>
  <div class="sheet"><h3>Kartu</h3>${carded.length ? carded.map((p, i) => `<div class="prow"><span class="n">${i + 1}</span><span class="who"><b>${esc(p.name)}</b><span>${esc(tName(p.teamId))}</span></span><span class="v" style="font-size:18px">${p.yellow ? `<span class="ico yc"></span>${p.yellow}` : ""} ${p.red ? `<span class="ico rc"></span>${p.red}` : ""}</span></div>`).join("") : `<p class="empty">Belum ada kartu.</p>`}</div>
  </div>${footer}`;
}

// ---------- Tim ----------
function timView() {
  const byGroup = {};
  for (const t of state.teams) (byGroup[t.group || "–"] ||= []).push(t);
  const keys = Object.keys(byGroup).sort();
  if (!keys.length) return `<div class="head"><h2>Tim peserta</h2></div><div class="sheet"><p class="empty">Daftar tim belum tersedia.</p></div>`;
  return `<div class="head"><h2>Tim peserta</h2></div><div class="tgroups">` + keys.map((g) => `<div class="tgroup">
    <div class="daygroup">Grup ${esc(g)}</div>
    ${byGroup[g].sort((a, b) => a.name.localeCompare(b.name, "id")).map((t) => {
      const roster = state.players.filter((p) => p.teamId === t.id && p.role !== "official").sort((a, b) => (a.number ?? 999) - (b.number ?? 999));
      const officials = state.players.filter((p) => p.teamId === t.id && p.role === "official");
      return `<details class="team" data-team="${esc(t.id)}" ${openTeams.has(t.id) ? "open" : ""}>
        <summary>${badge(t)}<span>${esc(t.name)}</span><span class="c">${roster.length} pemain</span></summary>
        <div class="roster">${roster.length ? roster.map((p) => `<div class="pl"><span class="no">${p.number ?? ""}</span><span>${esc(p.name)}</span>${p.isGK ? '<span class="badge-gk">GK</span>' : ""}${p.isCaptain ? '<span class="badge-gk badge-cap">C</span>' : ""}</div>`).join("") : `<p class="muted small" style="padding:6px 0">Pemain belum diinput.</p>`}${officials.length ? `<p class="muted small ofs">Official: ${officials.map((o) => esc(o.name)).join(", ")}</p>` : ""}</div></details>`;
    }).join("")}</div>`).join("") + `</div>${footer}`;
}

// ---------- Detail laga ----------
function eventIcon(e) {
  if (e.type === "goal") return `<span class="evic">${ballSvg()}${e.pen ? '<i class="evtag">P</i>' : ""}</span>`;
  if (e.type === "own_goal") return `<span class="evic">${ballSvg("og")}<i class="evtag og">OG</i></span>`;
  if (e.type === "yellow") return `<span class="evic"><span class="ico yc"></span></span>`;
  if (e.type === "red") return `<span class="evic"><span class="ico rc"></span></span>`;
  return `<span class="evic"><span class="ico dot"></span></span>`;
}
function eventText(m, e) {
  const who = `${esc(pName(e.playerId))} (${esc(tName(e.teamId))})`;
  if (e.type === "goal") return `<b>${e.pen ? "Gol penalti" : "Gol"}, ${who}</b>${e.assistId ? `<small>Assist: ${esc(pName(e.assistId))}</small>` : ""}`;
  if (e.type === "own_goal") return `<b>Gol bunuh diri, ${who}</b>`;
  if (e.type === "yellow") return `<b>Kartu kuning, ${who}</b>`;
  if (e.type === "red") return `<b>Kartu merah, ${who}</b>${e.second ? "<small>Kartu kuning kedua</small>" : ""}`;
  return `<b>${esc(e.note || "Kejadian")}</b>`;
}
const evSort = eventCmp;

function scorersList(m, side) {
  const me = side === "A" ? m.teamA : m.teamB;
  const list = state.events
    .filter((e) => e.matchId === m.id && ((e.type === "goal" && e.teamId === me) || (e.type === "own_goal" && e.teamId !== me)))
    .sort(evSort);
  return list.map((e) => `<p>${ballSvg(e.type === "own_goal" ? "og" : "")} ${esc(pName(e.playerId))} ${eventMinute(e)}${e.pen ? ' <i class="evtag">P</i>' : ""}${e.type === "own_goal" ? ' <i class="evtag og">OG</i>' : ""}</p>`).join("");
}

function lineupCol(m, side, events) {
  const lu = m["lineup" + side] || {};
  const row = (id, sub) => {
    const p = state.playerById[id];
    if (!p) return "";
    const goals = events.filter((e) => e.type === "goal" && e.playerId === id).length;
    const pen = events.some((e) => e.type === "goal" && e.pen && e.playerId === id);
    const ogs = events.filter((e) => e.type === "own_goal" && e.playerId === id).length;
    const yc = events.some((e) => e.type === "yellow" && e.playerId === id);
    const rc = events.some((e) => e.type === "red" && e.playerId === id);
    return `<div class="lp ${sub ? "sub" : ""}"><span class="no">${p.number ?? ""}</span><span>${esc(p.name)}</span><span class="badges">${p.isGK ? '<span class="badge-gk">GK</span>' : ""}${p.isCaptain ? '<span class="badge-gk badge-cap">C</span>' : ""}${goals ? `${ballSvg()}${goals > 1 ? `<b class="gcnt">${goals}</b>` : ""}${pen ? '<i class="evtag">P</i>' : ""}` : ""}${ogs ? `${ballSvg("og")}<i class="evtag og">OG</i>` : ""}${yc ? '<span class="ico yc"></span>' : ""}${rc ? '<span class="ico rc"></span>' : ""}</span></div>`;
  };
  const starters = (lu.starters || []).map((id) => row(id, false)).join("");
  const subs = (lu.subs || []).map((id) => row(id, true)).join("");
  return `<div class="col ${side === "B" ? "b" : "a"}"><h3>${esc(sideName(m, side))}</h3>
    ${starters || `<p class="muted small" style="padding:10px 0">Belum diumumkan.</p>`}
    ${subs ? `<div class="sub-title">Cadangan</div>${subs}` : ""}</div>`;
}

function cmpRow(label, a, b) {
  const max = Math.max(a, b, 1);
  return `<div class="cmp"><div class="lab"><span>${a}</span><em>${label}</em><span>${b}</span></div>
    <div class="bars"><div class="bar" style="justify-content:flex-end"><i style="width:${(a / max) * 100}%"></i></div><div class="bar r"><i style="width:${(b / max) * 100}%"></i></div></div></div>`;
}

function matchView(r) {
  const m = state.matchById[r.id];
  if (!m) return `<a class="back" href="#/">← Beranda</a><div class="sheet"><p class="empty">Pertandingan tidak ditemukan.</p></div>`;
  const tab = ["lineup", "statistik"].includes(r.tab) ? r.tab : "ringkasan";
  const A = state.teamById[m.teamA], B = state.teamById[m.teamB];
  const events = state.events.filter((e) => e.matchId === m.id);
  const evA = events.filter((e) => e.teamId === m.teamA), evB = events.filter((e) => e.teamId === m.teamB);

  const head = `<div class="scorebox">
    <div class="meta"><span>${matchLabel(m)}, ${m.kickoff ? dayShort(m.kickoff) + (m.status === "scheduled" ? " " + timeStr(m.kickoff) : "") : "waktu akan ditentukan"}</span>${statusPill(m)}</div>
    <div class="teams"><div class="tm">${badge(A, false, "lg")}<b>${esc(sideName(m, "A"))}</b></div>
      <div class="bigscore ${m.status === "scheduled" ? "vs" : ""}">${m.status === "scheduled" ? "vs" : scoreText(m)}</div>
      <div class="tm">${badge(B, false, "lg")}<b>${esc(sideName(m, "B"))}</b></div></div>
    <div class="clockbig" ${m.status === "live" ? `data-clockbig="${esc(m.id)}"` : ""}>${m.status === "live" ? clockText(m) : ""}</div>
    ${addedText(m) ? `<div class="addednote">${esc(addedText(m))}</div>` : ""}
    ${shootout(m).any && (m.scoreA ?? 0) === (m.scoreB ?? 0) ? `<div class="addednote">Adu penalti ${penScoreText(m)}</div>` : ""}
    <div class="scorers"><div>${scorersList(m, "A")}</div><div>${scorersList(m, "B")}</div></div></div>`;

  const tabs = `<div class="tabs">${[["ringkasan", "Ringkasan"], ["lineup", "Line up"], ["statistik", "Statistik"]]
    .map(([k, l]) => `<a class="${tab === k ? "on" : ""}" href="#/laga/${esc(m.id)}${k === "ringkasan" ? "" : "/" + k}">${l}</a>`).join("")}</div>`;

  let body = "";
  if (tab === "ringkasan") {
    const sorted = [...events].sort((a, b) => evSort(b, a));
    const rows = [];
    if (m.status === "ft") {
      const tie = (m.scoreA ?? 0) === (m.scoreB ?? 0), pw = tie && m.penWinner ? tName(m.penWinner === "A" ? m.teamA : m.teamB) : "";
      rows.push(`<div class="tl"><span class="min">${m.wo ? "WO" : "FT"}</span><span class="ico dot"></span><div class="ev"><b>${m.wo ? "Menang WO" : "Pertandingan selesai"}</b>${m.wo ? "<small>Lawan tidak hadir. Hasil ditetapkan panitia.</small>" : ""}${m.etPlayed ? "<small>Setelah perpanjangan waktu</small>" : ""}${pw ? `<small>Menang adu penalti: ${esc(pw)}${penScoreText(m, true) ? ` (${penScoreText(m, true)})` : ""}</small>` : ""}</div></div>`);
    }
    sorted.forEach((e) => rows.push(`<div class="tl"><span class="min">${eventMinute(e)}</span>${eventIcon(e)}<div class="ev">${eventText(m, e)}</div></div>`));
    if (m.status !== "scheduled" && !m.wo) rows.push(`<div class="tl"><span class="min">0'</span><span class="ico dot"></span><div class="ev"><b>Kick-off</b></div></div>`);
    const so = shootout(m);
    const penCard = so.any ? `<div class="sheet pen-card"><h3>Adu penalti <b>${penScoreText(m)}</b></h3>
      <div class="pen-row"><span>${esc(sideName(m, "A"))}</span><span class="pk-dots">${penDots(m, "A")}</span></div>
      <div class="pen-row"><span>${esc(sideName(m, "B"))}</span><span class="pk-dots">${penDots(m, "B")}</span></div></div>` : "";
    body = `${penCard}<div class="sheet"><h3 style="font-family:var(--font-d);font-size:22px;padding:12px 16px 4px">Jalannya laga</h3>${rows.length ? rows.join("") : `<p class="empty">Pertandingan belum dimulai.</p>`}</div>`;
  } else if (tab === "lineup") {
    const ready = (m.lineupA?.starters || []).length && (m.lineupB?.starters || []).length;
    body = `<div class="sheet"><div class="lu-head"><h2>Line up</h2><span class="muted small">Susunan awal, 5 pemain</span></div>
      ${ready ? `<div class="lu">${lineupCol(m, "A", evA)}${lineupCol(m, "B", evB)}</div>` : `<p class="lu-wait">Line up belum diumumkan. Susunan muncul di sini setelah panitia mengisinya, sebelum laga dimulai.</p>`}</div>`;
  } else {
    const c = (list, f) => list.filter(f).length;
    const gA = c(events, (e) => (e.type === "goal" && e.teamId === m.teamA) || (e.type === "own_goal" && e.teamId === m.teamB));
    const gB = c(events, (e) => (e.type === "goal" && e.teamId === m.teamB) || (e.type === "own_goal" && e.teamId === m.teamA));
    body = `<div class="sheet"><div class="cmp-teams"><span>${esc(sideName(m, "A"))}</span><span>${esc(sideName(m, "B"))}</span></div>
      ${cmpRow("Gol", gA, gB)}
      ${cmpRow("Assist", c(evA, (e) => e.type === "goal" && e.assistId), c(evB, (e) => e.type === "goal" && e.assistId))}
      ${cmpRow("Kartu kuning", c(evA, (e) => e.type === "yellow"), c(evB, (e) => e.type === "yellow"))}
      ${cmpRow("Kartu merah", c(evA, (e) => e.type === "red"), c(evB, (e) => e.type === "red"))}
      ${cmpRow("Gol bunuh diri", c(evA, (e) => e.type === "own_goal"), c(evB, (e) => e.type === "own_goal"))}</div>`;
  }

  const motm = m.motmId && state.playerById[m.motmId]
    ? `<div class="motm"><div class="tag">Man of the Match</div><p class="name">${esc(pName(m.motmId))}</p><p>${esc(tName(state.playerById[m.motmId].teamId))}</p></div>`
    : m.status === "ft" ? "" : `<div class="motm"><div class="tag">Man of the Match</div><p>Dipilih panitia setelah laga selesai.</p></div>`;

  return `<a class="back" href="#/">← Kembali</a>${head}${tabs}${body}${motm}`;
}

// ---------- Banner geser (otomatis + bisa digeser) ----------
/** Video tanpa suara, berulang. Pengunjung yang meminta gerak dikurangi hanya melihat gambar pembuka. */
function mediaVideo(b, controls) {
  const play = controls || !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  return `<video class="bn-video" src="${b.video}" poster="${b.src}" width="1920" height="912" muted loop playsinline preload="${play ? "auto" : "none"}" ${play ? "autoplay" : ""} ${controls ? "controls" : ""} aria-label="${esc(b.alt)}"></video>`;
}
const BANNERS = [
  { video: "assets/promo.mp4", src: "assets/promo-poster.jpg", tvVideo: "assets/promo-tv-1.mp4", tvSrc: "assets/promo-tv-1-poster.jpg", dur: 8, title: "Video Industropolis Batang Futsal League", alt: "Video pembuka Industropolis Batang Futsal League: 16 team, league system, 31 match, November sampai Desember 2026, khusus karyawan tenant Industropolis Batang" },
  { video: "assets/promo-banner-2.mp4", src: "assets/promo-banner-2.jpg", tvVideo: "assets/promo-tv-2.mp4", tvSrc: "assets/promo-tv-2-poster.jpg", dur: 15, title: "Jadwal babak grup", alt: "Video jadwal babak grup: Matchday 1 sampai 3 pada 20, 26, dan 27 November, sesi 1 Grup A dan B, sesi 2 Grup C dan D, pukul 18.00 sampai 21.20 WIB, beserta susunan laga" },
  { video: "assets/promo-banner-3.mp4", src: "assets/promo-banner-3.jpg", tvVideo: "assets/promo-tv-3.mp4", tvSrc: "assets/promo-tv-3-poster.jpg", dur: 15, title: "Bagan babak gugur", alt: "Video bagan babak gugur 3 sampai 4 Desember: perempat final, semifinal, dan final" },
];
const BN = { idx: 0, hold: 0, hover: false, at: Date.now() };
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let bannerEl = null;
const bnTrack = () => bannerEl?.querySelector(".bn-track");

function bnSync() {
  if (!bannerEl) return;
  BN.at = Date.now();
  bannerEl.querySelectorAll(".bn-slide video").forEach((v, i) => { // hanya slide yang tampil yang diputar, mulai dari awal
    if (i === BN.idx) { if (v.paused || v.dataset.on !== "1") { try { v.currentTime = 0; } catch {} v.play?.().catch(() => {}); } v.dataset.on = "1"; }
    else { v.pause?.(); v.dataset.on = "0"; }
  });
  bannerEl.querySelectorAll(".bn-dots button").forEach((d, i) => {
    d.classList.toggle("on", i === BN.idx);
    d.setAttribute("aria-current", String(i === BN.idx));
  });
  bannerEl.querySelector(".bn-cap").textContent = `${BN.idx + 1}/${BANNERS.length} · ${BANNERS[BN.idx].title}`;
}
function bnGo(i, smooth = true) {
  const t = bnTrack();
  if (!t) return;
  BN.idx = (i + BANNERS.length) % BANNERS.length;
  t.scrollTo({ left: BN.idx * t.clientWidth, behavior: smooth && !reduceMotion.matches ? "smooth" : "auto" });
  bnSync();
}
function buildBanner() {
  const el = document.createElement("section");
  el.className = "bn";
  el.setAttribute("aria-roledescription", "carousel");
  el.setAttribute("aria-label", "Informasi turnamen");
  el.innerHTML = `<div class="bn-view">
    <div class="bn-track" tabindex="0" aria-label="Geser untuk melihat info lainnya">${BANNERS.map((b, i) =>
      `<figure class="bn-slide" role="group" aria-roledescription="slide" aria-label="${i + 1} dari ${BANNERS.length}">${b.video ? mediaVideo(b, false) : `<img src="${b.src}" alt="${esc(b.alt)}" width="1200" height="570" draggable="false">`}</figure>`).join("")}</div>
    <button type="button" class="bn-arrow prev" data-bn="prev" aria-label="Slide sebelumnya"></button>
    <button type="button" class="bn-arrow next" data-bn="next" aria-label="Slide berikutnya"></button>
  </div>
  <div class="bn-foot"><span class="bn-cap"></span><div class="bn-dots">${BANNERS.map((_, i) => `<button type="button" data-bn="${i}" aria-label="Slide ${i + 1}"></button>`).join("")}</div></div>
  <p class="bn-tip">Ketuk gambar untuk memperbesar.</p>`;
  bannerEl = el;
  const t = bnTrack();
  let timer;
  t.addEventListener("scroll", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!t.clientWidth) return; // sedang terlepas dari halaman
      const i = Math.min(BANNERS.length - 1, Math.round(t.scrollLeft / t.clientWidth));
      if (i !== BN.idx) { BN.idx = i; bnSync(); }
    }, 60);
  }, { passive: true });
  // pengunjung menyentuh / menggeser / memakai keyboard: jeda putar otomatis 10 detik
  ["pointerdown", "touchstart", "wheel", "keydown", "focusin"].forEach((ev) => el.addEventListener(ev, () => { BN.hold = Date.now() + 10000; }, { passive: true }));
  el.addEventListener("mouseenter", () => { BN.hover = true; });
  el.addEventListener("mouseleave", () => { BN.hover = false; });
  t.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") { e.preventDefault(); bnGo(BN.idx + 1); }
    if (e.key === "ArrowLeft") { e.preventDefault(); bnGo(BN.idx - 1); }
  });
  bnSync();
}
/** Banner disimpan di memori dan dipasang ulang tiap beranda dirender, jadi posisi geser tidak hilang saat skor berubah. */
function mountBanner() {
  const slot = $app.querySelector("#bn-slot");
  if (!slot) return;
  if (!bannerEl) buildBanner();
  slot.replaceWith(bannerEl);
  const t = bnTrack();
  t.scrollLeft = BN.idx * t.clientWidth;
}
setInterval(() => {
  if (!bannerEl || !bannerEl.isConnected || reduceMotion.matches || document.hidden || BN.hover || Date.now() < BN.hold) return;
  const r = bannerEl.getBoundingClientRect();
  if (r.bottom < 0 || r.top > window.innerHeight) return;
  if (BANNERS[BN.idx].video && Date.now() - BN.at < ((BANNERS[BN.idx].dur || 8) + 1.5) * 1000) return; // biarkan video selesai satu putaran
  bnGo(BN.idx + 1);
}, 5000);
window.addEventListener("resize", () => { if (bannerEl?.isConnected) bnGo(BN.idx, false); });

function openLightbox(i) {
  const b = BANNERS[i];
  if (!b) return;
  const prev = document.activeElement;
  const lb = document.createElement("div");
  lb.className = "lb";
  lb.setAttribute("role", "dialog");
  lb.setAttribute("aria-modal", "true");
  lb.setAttribute("aria-label", b.title);
  lb.innerHTML = `<button type="button" class="lb-x">Tutup ✕</button><div class="lb-scroll">${b.video ? mediaVideo(b, true) : `<img src="${b.src}" alt="${esc(b.alt)}">`}</div>`;
  document.body.appendChild(lb);
  document.body.classList.add("lb-open");
  const close = () => {
    document.removeEventListener("keydown", onKey, true);
    lb.remove();
    document.body.classList.remove("lb-open");
    if (prev && prev.isConnected) prev.focus();
  };
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    if (e.key === "Tab") { e.preventDefault(); lb.querySelector(".lb-x").focus(); }
  };
  document.addEventListener("keydown", onKey, true);
  lb.addEventListener("click", (e) => { if (e.target.closest(".lb-x") || e.target === lb || e.target.classList.contains("lb-scroll")) close(); });
  lb.querySelector(".lb-x").focus();
}
document.addEventListener("click", (e) => {
  const c = e.target.closest("[data-bn]");
  if (c) {
    BN.hold = Date.now() + 10000;
    const v = c.dataset.bn;
    bnGo(v === "next" ? BN.idx + 1 : v === "prev" ? BN.idx - 1 : Number(v));
    return;
  }
  const sl = e.target.closest(".bn-slide");
  if (sl) openLightbox([...sl.parentNode.children].indexOf(sl));
});

// ---------- Render ----------
function regCta(cls) {
  const st = registrationState();
  if (st === "closed") return "";
  const label = st === "open" ? "Daftar tim" : "Dibuka 9 Nov";
  return `<a class="${cls}" href="${esc(REGISTRATION.url)}" target="_blank" rel="noopener noreferrer">${label}<span class="sr-only"> (membuka Google Form di tab baru)</span></a>`;
}
function renderNav(name) {
  const active = name === "laga" ? "jadwal" : name;
  $nav.innerHTML = NAV.map((n) => {
    if (!n.sub) return `<a href="${n.href}" class="${n.key === active ? "on" : ""}" ${n.key === active ? 'aria-current="page"' : ""}>${n.label}</a>`;
    const on = n.sub.some((x) => x[2] === active);
    return `<div class="has-sub ${on ? "on" : ""} ${subOpen ? "open" : ""}">
      <button type="button" class="subbtn" data-sub aria-expanded="${subOpen}" aria-haspopup="true">${n.label}<i class="caret" aria-hidden="true"></i></button>
      <div class="submenu">${n.sub.map(([href, label, key]) => `<a href="${href}" class="${key === active ? "on" : ""}" ${key === active ? 'aria-current="page"' : ""}>${label}</a>`).join("")}</div></div>`;
  }).join("") + regCta("navcta");
}
function setSub(open) {
  subOpen = open;
  const box = $nav.querySelector(".has-sub");
  if (!box) return;
  box.classList.toggle("open", open);
  box.querySelector("[data-sub]").setAttribute("aria-expanded", String(open));
}

// Menu hamburger (layar < 900px). Satu <nav> yang sama dipakai desktop dan mobile.
const desktopNav = window.matchMedia("(min-width: 900px)");
function setMenu(open, { focus = true } = {}) {
  $bar.classList.toggle("open", open);
  $scrim.hidden = !open;
  document.body.classList.toggle("menu-open", open);
  $burger.setAttribute("aria-expanded", String(open));
  $burger.setAttribute("aria-label", open ? "Tutup menu" : "Buka menu");
  if (focus) (open ? $nav.querySelector("a") : $burger)?.focus();
}
$burger.addEventListener("click", () => setMenu(!$bar.classList.contains("open")));
$scrim.addEventListener("click", () => setMenu(false, { focus: false }));
$nav.addEventListener("click", (e) => {
  if (e.target.closest("[data-sub]")) { setSub(!subOpen); return; }
  if (e.target.closest("a")) { setSub(false); setMenu(false, { focus: false }); }
});
document.addEventListener("click", (e) => { if (subOpen && !e.target.closest(".has-sub")) setSub(false); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && subOpen) { setSub(false); $nav.querySelector("[data-sub]")?.focus(); }
  if (e.key === "Escape" && $bar.classList.contains("open")) { setMenu(false); return; }
  if (e.key === "Tab" && $bar.classList.contains("open")) {
    const f = [$burger, ...[...$nav.querySelectorAll("a, button")].filter((el) => el.offsetParent !== null)];
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
});
desktopNav.addEventListener("change", () => setMenu(false, { focus: false }));

function render() {
  const r = route();
  renderNav(r.name);
  $app.dataset.view = r.name;
  document.body.classList.toggle("tv-mode", r.name === "tv");
  tvWake(r.name === "tv");
  if (r.name === "tv") tvWarm();
  if (isReady()) {
    const b = computeBracket(state.teams, state.matches, state.events);
    slotByMatch = new Map([...b.qf, ...b.sf, b.final, ...(b.third ? [b.third] : [])].filter((x) => x.match).map((x) => [x.match.id, x]));
  }

  let html;
  if (state.error && !isReady()) {
    html = `<div class="error-box">Data belum bisa dimuat (${esc(state.error.code || state.error.message)}). Coba muat ulang halaman beberapa saat lagi.</div>`;
  } else if (!isReady() || skelOn) {
    html = skeleton(SKEL_KIND[r.name] || "list");
  } else {
    switch (r.name) {
      case "jadwal": html = jadwalView(); break;
      case "klasemen": html = klasemenView(); break;
      case "bagan": html = baganView(); break;
      case "statistik": html = statistikView(); break;
      case "tim": html = timView(); break;
      case "laga": html = matchView(r); break;
      case "tv": html = tvView(); break;
      default: html = homeView();
    }
  }
  const key = location.hash;
  if (html !== lastHtml || key !== lastKey) {
    const routeChanged = key !== lastKey;
    $app.innerHTML = html;
    mountBanner();
    if (r.name === "tv") setTimeout(() => $app.querySelector(".tv-fullvideo video")?.classList.add("ready"), 2500); // jaga-jaga bila peristiwa "playing" tidak datang
    if (tvEnter && r.name === "tv") { $app.querySelector(".tv")?.classList.add("tv-in"); tvEnter = false; }
    if (routeChanged) { window.scrollTo(0, 0); scrolledJadwal = false; }
    lastHtml = html; lastKey = key;
  }
  if (r.name === "jadwal" && !scrolledJadwal && isReady() && !skelOn) {
    scrolledJadwal = true;
    const el = document.getElementById("today-anchor");
    if (el) setTimeout(() => el.scrollIntoView({ block: "start" }), 0);
  }
  const titles = { home: "", jadwal: "Jadwal · ", klasemen: "Klasemen · ", bagan: "Bagan · ", statistik: "Statistik · ", tim: "Tim · ", laga: "Pertandingan · ", tv: "Layar TV · " };
  document.title = (titles[r.name] ?? "") + TOURNAMENT.name;
}

// Interaksi (delegasi event)
document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-group]");
  if (g) { homeGroup = g.dataset.group; lastHtml = ""; render(); return; }
  const f = e.target.closest("[data-filter]");
  if (f) { jadwalFilter = f.dataset.filter; lastHtml = ""; scrolledJadwal = true; render(); }
});
document.addEventListener("toggle", (e) => {
  const d = e.target;
  if (d?.matches?.("details.team")) d.open ? openTeams.add(d.dataset.team) : openTeams.delete(d.dataset.team);
}, true);

// Pilih laga di papan skor beranda
document.addEventListener("click", (e) => {
  const d = e.target.closest("[data-board]");
  if (!d) return;
  boardIdx = Number(d.dataset.board);
  lastHtml = ""; render();
});


// ---------- Layar TV / proyektor (#/tv) ----------
// Tanpa menu, huruf besar, skor + jam + kejadian terbaru. Beberapa laga live: bergantian tiap 15 detik.
let tvIdx = 0;
const tvTop = (label) => `<header class="tv-top"><span class="tv-brand"><img src="assets/logo.png" alt="" data-sitelogo><span class="tv-brand-t"><b>${esc(TOURNAMENT.line1.toUpperCase())}</b><i>${esc(TOURNAMENT.line2.toUpperCase())}</i></span></span><span class="tv-label">${label}</span>${rtClockHtml("tvc")}</header>`;
const tvSponsors = `<footer class="tv-sponsors"><img src="assets/logo-industropolis.png" alt="Industropolis Batang"><i></i><img src="assets/logo-sez.png" alt="Indonesia SEZ"><i></i><img src="assets/logo-danantara.png" alt="Danantara Indonesia"></footer>`;
const tvTeam = (m, side) => `<div class="tv-team">${badge(state.teamById[side === "A" ? m.teamA : m.teamB], false, "lg")}<b>${esc(sideName(m, side))}</b></div>`;
// Line up untuk layar TV: inti (kiper di atas), cadangan satu baris. Null bila salah satu tim belum diisi.
const tvLuReady = (m) => (m.lineupA?.starters || []).length && (m.lineupB?.starters || []).length;
function tvLineup(m) {
  const col = (side) => {
    const lu = m["lineup" + side] || {};
    const ps = (ids) => ids.map((id) => state.playerById[id]).filter(Boolean);
    const st = ps(lu.starters || []).sort((a, b) => (b.isGK ? 1 : 0) - (a.isGK ? 1 : 0) || (a.number ?? 999) - (b.number ?? 999));
    const sb = ps(lu.subs || []).sort((a, b) => (a.number ?? 999) - (b.number ?? 999));
    return `<div class="tv-lucol"><h3>${esc(sideName(m, side))}</h3>
      ${st.map((p) => `<div class="tv-lu"><span class="no">${p.number ?? ""}</span><span class="nm">${esc(p.name)}</span>${p.isGK ? '<span class="gk">GK</span>' : ""}${p.isCaptain ? '<span class="gk cap">C</span>' : ""}</div>`).join("")}
      ${sb.length ? `<p class="tv-sub">Cadangan: ${sb.map((p) => `${p.number ?? ""} ${esc(p.name)}`).join(" · ")}</p>` : ""}</div>`;
  };
  return `<h3 class="tv-h">Line up</h3><div class="tv-lu2">${col("A")}${col("B")}</div>`;
}
let tvPane = 0; // nomor bagian bawah layar; naik tiap 15 detik (sama dengan durasi video TV) saat tidak ada laga live
const tvRows = (title, rows) => `<h3 class="tv-h">${title}</h3>${rows}`;
const tvSchedule = (list) => tvRows("Jadwal berikutnya", list.map((m) => `<div class="tv-row"><span class="tv-when">${m.kickoff ? `${esc(dayLong(m.kickoff).replace(/\s\d{4}$/, ""))}, ${esc(timeStr(m.kickoff))}` : "Waktu akan ditentukan"}</span><span class="tv-teams">${esc(sideName(m, "A"))} <i>vs</i> ${esc(sideName(m, "B"))}</span><span class="tv-grp">${matchLabel(m)}</span></div>`).join(""));
const tvResults = (list) => tvRows("Hasil terakhir", list.map((m) => `<div class="tv-row"><span class="tv-when">${matchLabel(m)}</span><span class="tv-teams">${esc(sideName(m, "A"))} <b>${scoreText(m)}</b> ${esc(sideName(m, "B"))}${penNote(m)}</span></div>`).join(""));
function tvStats(stats) {
  const col = (title, key) => {
    const l = topBy(stats, key, 3);
    return `<div class="tv-statcol"><h3>${title}</h3>${l.length ? l.map((p) => `<div class="tv-pl"><span>${esc(p.name)} <small>${esc(state.teamById[p.teamId]?.name || "")}</small></span><b>${p[key]}</b></div>`).join("") : `<p class="tv-sub">Belum ada.</p>`}</div>`;
  };
  const gk = state.playerById[state.settings.bestGkId];
  return `<h3 class="tv-h">Statistik</h3><div class="tv-lu2">${col("Top scorer", "goals")}${col("Top assist", "assists")}</div>${gk ? `<p class="tv-sub">Kiper terbaik: ${esc(gk.name)} (${esc(state.teamById[gk.teamId]?.name || "")})</p>` : ""}`;
}
// Ubah ke true bila layar TV saat tidak ada laga live hanya boleh memutar 3 video (tanpa line up, klasemen, jadwal, hasil, statistik).
const TV_VIDEO_ONLY = false;
// Bagian bawah layar saat tidak ada laga live: line up, klasemen tiap grup, jadwal, hasil, statistik, dan banner, bergantian.
function tvPaneList(next) {
  const ms = state.matches, std = computeStandings(state.teams, ms, state.events);
  const groups = Object.keys(std).filter((g) => g && std[g]?.length).sort((a, b) => a.localeCompare(b)); // urut A, B, C, D
  // klasemen semua grup digabung dalam satu layar (2 x 2)
  const gp = groups.length ? [() => tvRows("Klasemen", `<div class="tv-std4">${groups.map((g) => `<div class="tv-std"><h4>Grup ${esc(g)}</h4>${standingsTable(std[g], QUALIFY_PER_GROUP)}</div>`).join("")}</div>`)] : [];
  const upcoming = ms.filter((m) => m.status === "scheduled").sort(sortByKickoff).slice(0, 5);
  const done = ms.filter((m) => m.status === "ft").sort((a, b) => sortByKickoff(b, a)).slice(0, 4);
  const stats = computePlayerStats(state.players, state.events, state.teams, state.matches);
  const hasStats = topBy(stats, "goals", 1).length || topBy(stats, "assists", 1).length;
  // video TV: tampil satu layar penuh (tanpa header, hitung mundur, atau logo sponsor tambahan; logo sudah ada di dalam video)
  const vp = BANNERS.filter((b) => b.tvVideo).map((b) => { const f = () => `<video src="${b.tvVideo}" poster="${b.tvSrc || b.src}" muted autoplay playsinline preload="auto"${b.tvFit === "cover" ? ' class="cover"' : ""}></video>`; f.full = true; f.dur = (b.dur || 15) + 0.2; return f; }); // tanpa loop: di akhir video berhenti di bingkai terakhir lalu memudar ke jeda kosong, tidak mengulang dari awal
  const dataPanes = [
    next && tvLuReady(next) ? () => tvLineup(next) : null,
    ...gp, // satu layar klasemen untuk semua grup
    upcoming.length ? () => tvSchedule(upcoming) : null,
    hasStats ? () => tvStats(stats) : null, done.length ? () => tvResults(done) : null,
  ].filter(Boolean);
  if (TV_VIDEO_ONLY) return vp;
  return [...dataPanes, ...vp]; // layar data dulu, 3 video berurutan di akhir (video pembuka 8 dtk, lalu 2 video acara 15 dtk)
}
const tvDots = (n) => n > 1 ? `<div class="tv-dots">${Array.from({ length: n }, (_, i) => `<i class="${i === tvPane % n ? "on" : ""}"></i>`).join("")}</div>` : "";
function tvView() {
  const ms = state.matches;
  const live = ms.filter((m) => m.status === "live").sort(sortByKickoff);
  const next = ms.filter((m) => m.status === "scheduled").sort(sortByKickoff)[0];
  const last = ms.filter((m) => m.status === "ft").sort((a, b) => sortByKickoff(b, a))[0];

  if (live.length) {
    const m = live[tvIdx % live.length];
    const evs = state.events.filter((e) => e.matchId === m.id).sort((a, b) => evSort(b, a)).slice(0, 4);
    const so = shootout(m).any && (m.scoreA ?? 0) === (m.scoreB ?? 0) ? `<div class="tv-note">Adu penalti ${penScoreText(m)}</div>` : "";
    return `<div class="tv">${tvTop(matchLabel(m))}
      <section class="tv-main">${tvTeam(m, "A")}
        <div class="tv-mid"><div class="tv-score">${scoreText(m)}</div>
          <div class="tv-clock" data-clockbig="${esc(m.id)}">${esc(clockText(m))}</div>
          <div class="tv-status">${statusPill(m)}</div>
          ${addedText(m) ? `<div class="tv-note">${esc(addedText(m))}</div>` : ""}${so}</div>
        ${tvTeam(m, "B")}</section>
      <section class="tv-feed">${evs.length ? evs.map((e) => `<div class="tv-ev"><span class="tv-min">${eventMinute(e)}</span>${eventIcon(e)}<div>${eventText(m, e)}</div></div>`).join("") : `<p class="tv-empty">Belum ada kejadian.</p>`}
        ${live.length > 1 ? `<div class="tv-dots">${live.map((_, i) => `<i class="${i === tvIdx % live.length ? "on" : ""}"></i>`).join("")}</div>` : ""}</section>${tvSponsors}</div>`;
  }

  if (next) {
    const ko = toDate(next.kickoff)?.getTime();
    const panes = tvPaneList(next), cur = panes.length ? panes[tvPane % panes.length] : null, feed = cur ? cur() : "";
    tvCurDur = (cur?.dur || 15) * 1000;
    if (cur?.full) return `<div class="tv tv-fullvideo">${feed}</div>`;
    return `<div class="tv tv-next">${tvTop(`Laga berikutnya · ${matchLabel(next)}`)}
      <section class="tv-main">${tvTeam(next, "A")}
        <div class="tv-mid"><div class="tv-score vs">vs</div>
          <div class="tv-clock">${ko ? `<span data-tvcount="${ko}">${tvCountText(ko)}</span>` : ""}</div>
          <div class="tv-note">${next.kickoff ? `${esc(dayLong(next.kickoff))}, ${esc(timeStr(next.kickoff))} WIB` : "Waktu akan ditentukan"}</div></div>
        ${tvTeam(next, "B")}</section>
      <section class="tv-feed">${feed}${tvDots(panes.length)}</section>${tvSponsors}</div>`;
  }

  const ip = tvPaneList(null), icur = ip.length ? ip[tvPane % ip.length] : null, ifeed = icur ? icur() : "";
  tvCurDur = (icur?.dur || 15) * 1000;
  if (icur?.full) return `<div class="tv tv-fullvideo">${ifeed}</div>`;
  return `<div class="tv tv-idle">${tvTop("")}<section class="tv-main tv-solo"><div><h1>${esc(TOURNAMENT.name)}</h1>
    <p class="tv-note">${last ? `Hasil terakhir: ${esc(sideName(last, "A"))} ${scoreText(last)} ${esc(sideName(last, "B"))}` : `${dateRange}, ${esc(TOURNAMENT.venue)}`}</p></div></section><section class="tv-feed">${ifeed}${tvDots(ip.length)}</section>${tvSponsors}</div>`;
}

// jam dinding, hitung mundur, dan putar laga live (tanpa render ulang)
const tvCountText = (ko) => {
  const s = Math.floor((ko - nowMs()) / 1000);
  if (s <= 0) return "Segera dimulai";
  const h = Math.floor(s / 3600), mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0"), ss = String(s % 60).padStart(2, "0");
  if (h >= 24) return `${Math.floor(h / 24)} hari ${String(h % 24).padStart(2, "0")}:${mm}:${ss}`;
  return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
};
setInterval(() => {
  document.querySelectorAll("[data-tvcount]").forEach((el) => { el.textContent = tvCountText(Number(el.dataset.tvcount)); });
}, 1000);
// Pergantian layar TV: isi layar memudar keluar (jeda singkat di warna latar), lalu layar berikut memudar masuk.
// Video baru baru ditampilkan setelah siap diputar, supaya tidak ada kedipan poster atau layar kosong.
let tvWarmed = null, tvPaneAt = Date.now(), tvCurDur = 15000; // tvCurDur: lama layar yang sedang tampil (video mengikuti durasinya)
setInterval(() => { // tanpa laga live: layar bawah berganti sesuai durasinya (data 15 dtk, video pembuka 8 dtk, video acara 15 dtk)
  if (route().name !== "tv" || !isReady() || state.matches.some((m) => m.status === "live")) { tvPaneAt = Date.now(); return; }
  if (Date.now() - tvPaneAt >= tvCurDur) { tvPaneAt = Date.now() + 5000; tvAdvance(); }
}, 500);
function tvWarm() { // muat video TV lebih awal agar langsung siap saat gilirannya
  if (tvWarmed) return;
  tvWarmed = BANNERS.filter((b) => b.tvVideo).map((b) => { const v = document.createElement("video"); v.muted = true; v.preload = "auto"; v.src = b.tvVideo; v.load(); return v; });
}
function tvAdvance() {
  tvWarm();
  const el = $app.querySelector(".tv");
  const go = () => { if (route().name !== "tv") return; tvPane++; tvEnter = true; tvPaneAt = Date.now(); lastHtml = ""; render(); };
  if (!el) return go();
  el.classList.add("tv-out");
  setTimeout(go, 950); // 0,55 dtk memudar keluar + jeda kosong singkat, baru layar berikut memudar masuk
}
document.addEventListener("loadeddata", (e) => { if (e.target.matches?.(".tv-fullvideo video")) e.target.classList.add("ready"); }, true);
document.addEventListener("playing", (e) => { if (e.target.matches?.(".tv-fullvideo video")) e.target.classList.add("ready"); }, true);
setInterval(() => {
  if (route().name !== "tv" || !isReady()) return;
  const liveN = state.matches.filter((m) => m.status === "live").length;
  if (liveN > 1) { tvIdx++; lastHtml = ""; render(); }
  
}, 15000);

// layar tidak boleh mati saat dipakai sebagai papan skor; klik dua kali atau tekan F = layar penuh
let wakeLock = null;
async function tvWake(on) {
  try {
    if (on && !wakeLock && "wakeLock" in navigator) { wakeLock = await navigator.wakeLock.request("screen"); wakeLock.addEventListener("release", () => { wakeLock = null; }); }
    else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { wakeLock = null; }
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && route().name === "tv") tvWake(true); });
const tvFull = () => { if (document.fullscreenElement) document.exitFullscreen?.(); else document.documentElement.requestFullscreen?.(); };
document.addEventListener("dblclick", () => { if (route().name === "tv") tvFull(); });
document.addEventListener("keydown", (e) => { if ((e.key === "f" || e.key === "F") && route().name === "tv" && !e.ctrlKey && !e.metaKey) tvFull(); });

// Jam LIVE bergerak tiap detik tanpa render ulang
setInterval(() => {
  document.querySelectorAll("[data-clock]").forEach((el) => {
    const m = state.matchById[el.dataset.clock];
    if (m && m.status === "live") el.textContent = livePill(m).text;
  });
  document.querySelectorAll("[data-clockbig]").forEach((el) => {
    const m = state.matchById[el.dataset.clockbig];
    if (m && m.status === "live") el.textContent = clockText(m);
  });
}, 1000);

window.addEventListener("hashchange", () => { subOpen = false; setMenu(false, { focus: false }); startSkeleton(); render(); });
onChange(render);
syncServerTime().then(() => { lastHtml = ""; render(); });
setInterval(syncServerTime, 5 * 60 * 1000);
startStore();
render();

tickRtClocks();
