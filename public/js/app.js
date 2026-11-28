// Website publik Industropolis Batang Futsal League: router hash + tampilan realtime.
import { state, startStore, onChange, isReady } from "./store.js";
import {
  TOURNAMENT, STAGES, courtName, esc, timeStr, dayLong, dayShort, dayKey, toDate, sortByKickoff,
  clockText, computeStandings, computePlayerStats, computeKeeperStats, keeperDetail, topBy, computeBracket, winnerSide,
  livePill, ftText, addedText, eventMinute, eventCmp,
  QUALIFY_PER_GROUP, suspendedIn, suspReason, eventSide, syncServerTime, lineupIds, ballSvg, teamProgress,
  skeleton, shootout, penScoreText, penDots, tickRtClocks,
  groupDone as groupDoneU, standingStatus, standingsTableHtml, standingLegendHtml,
} from "./util.js";
import { teamSummary, playerProfile, headToHead, championInfo } from "./profile.js";
import { logoOf } from "./logos.js";
import { byEntry } from "./util.js";

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
  const base = sm ? "tbadge sm" : size ? `tbadge ${size}` : "tbadge";
  const lg = logoOf(team);
  if (lg) return `<span class="${base}${lg.wide ? " wide" : ""}"${lg.wide ? ` style="--r:${lg.ratio}"` : ""}><img src="${esc(lg.url)}" alt="" loading="lazy"></span>`;
  return `<span class="${base}" style="background:${colorFor(team)}">${esc(initials(team))}</span>`;
}
const tName = (id) => state.teamById[id]?.name ?? "Belum ditentukan";
// Logo + nama untuk satu sisi laga (A atau B). Tim yang belum pasti (babak gugur) memakai tanda tanya.
const sideBadge = (m, side) => {
  const t = state.teamById[side === "A" ? m.teamA : m.teamB];
  return t ? badge(t, true) : `<span class="tbadge sm ph" aria-hidden="true">?</span>`;
};
const vt = (m, side, extra = "") => `<span class="vt">${sideBadge(m, side)}<span class="n">${esc(sideName(m, side))}</span>${extra}</span>`;
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
const matchBase = (m) =>
  m.stage === "group" || !m.stage
    ? `Grup ${esc(m.group || "?")} · Matchday ${esc(m.matchday ?? 1)}`
    : STAGES[m.stage] || esc(m.stage);
// Label laga + lapangan, mis. "Grup A · Matchday 1 · Lapangan 2"
const matchLabel = (m) => matchBase(m) + (courtName(m) ? ` · ${esc(courtName(m))}` : "");

// "BABAK 2 · 11'", "JEDA · Cedera", "ISTIRAHAT", "ADU PENALTI" (kuning saat jam berhenti)
function statusPill(m) {
  if (m.status === "live") { const l = livePill(m); return `<span class="pill live ${l.halted ? "pause" : ""}" data-clock="${esc(m.id)}">${esc(l.text)}</span>`; }
  if (m.status === "ft") return `<span class="pill ft">${ftText(m)}</span>`;
  return `<span class="pill soon">${m.kickoff ? timeStr(m.kickoff) : "Segera"}</span>`;
}
const scoreText = (m) => `${m.scoreA ?? 0} – ${m.scoreB ?? 0}`;
// Skor besar: tanda "–" diberi jarak sendiri supaya tidak menempel ke angka.
const bigScore = (m) => `${m.scoreA ?? 0}<span class="sdash">–</span>${m.scoreB ?? 0}`;
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
    ["#/juara", "Juara & arsip", "juara"],
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
let jadwalCourt = 0; // 0 = semua lapangan
const openTeams = new Set();
let scrolledJadwal = false;
let lastKey = "";
let lastHtml = "";
// Skeleton shimmer sekilas tiap pindah halaman (selain saat data belum siap)
let skelOn = false, skelTimer;
const SKEL_KIND = { home: "home", laga: "detail", tim: "grid" };
function startSkeleton() {
  skelOn = true; clearTimeout(skelTimer);
  skelTimer = setTimeout(() => { skelOn = false; lastHtml = ""; render(); }, 350);
}

// ---------- Tampilan: Beranda ----------
function groupsOf(standings) { return Object.keys(standings).sort(); }

// Grup dianggap selesai bila SEMUA pertemuan round-robin grup itu sudah ada dan berstatus FT (sama dengan aturan bagan di util.js).
const groupDone = (g) => groupDoneU(state.matches, g, state.teams);
// Klasemen gaya liga: garis warna di kiri (biru lolos, merah gugur, emas menunggu adu penalti), label status, dan ikon form.
function standingsTable(rows, qualify, done = false) {
  return standingsTableHtml(rows, standingStatus(rows, done, qualify), {
    chips: false,
    badge: (id) => { const t = state.teamById[id]; return logoOf(t) ? badge(t, true) : ""; },
  });
}
const standingNote = (full = true) => standingLegendHtml(full);

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

// Galeri beranda: tiap kotak adalah carousel otomatis (fade halus). Bentuk kotak mengikuti arah foto supaya tidak ada yang terpotong:
// "gw" = landscape lebar, "gh" = landscape setengah baris, "gn" = potret (sempit). Satu kotak hanya berisi foto dengan arah yang sama.
// Berhenti sebentar saat kursor di atasnya atau setelah digeser; klik foto untuk memperbesar (foto utuh).
const GALLERY = [
  ["gw", "Suasana laga di lapangan", "Pemain bertanding di lapangan futsal Industropolis Batang", ["lapangan-1", "lapangan-2", "lapangan-3", "lapangan-4", "lapangan-5", "lapangan-6", "lapangan-7", "lapangan-8", "lapangan-9", "lapangan-10", "lapangan-11", "lapangan-12", "lapangan-13", "lapangan-14", "lapangan-15", "lapangan-16", "lapangan-17", "lapangan-18", "lapangan-19", "lapangan-20", "lapangan-21", "lapangan-22", "lapangan-23", "lapangan-24", "lapangan-25", "lapangan-26", "lapangan-27", "lapangan-28"]],
  ["gn", "Para pemain", "Pemain futsal Industropolis Batang Futsal League di lapangan", ["potret-1", "potret-2", "potret-3", "potret-4", "potret-5", "potret-6", "potret-7", "potret-8"]],
  ["gh", "Sportivitas", "Salaman dan pengundian koin bersama wasit sebelum pertandingan", ["sportivitas-1", "sportivitas-2", "sportivitas-3"]],
  ["gh", "Satu tim", "Foto bersama tim peserta di Sagara Futsal Arena", ["tim-1", "tim-2", "tim-3", "tim-4", "tim-5", "tim-6", "tim-7", "tim-8", "tim-9", "tim-10", "tim-11", "tim-12", "tim-13", "tim-14"]],
  ["gh", "Sagara Futsal Arena", "Pertandingan di Sagara Futsal Arena, KEK Industropolis Batang", ["sagara-1", "sagara-2", "sagara-3", "sagara-4", "sagara-5", "sagara-6", "sagara-7", "sagara-8", "sagara-9", "sagara-10", "sagara-11", "sagara-12", "sagara-13", "sagara-14"]],
  ["gh", "Momen laga", "Momen pemain di lapangan futsal Industropolis Batang", ["duel-1", "duel-2", "duel-3", "duel-4", "duel-5", "duel-6", "duel-7", "duel-8", "duel-9", "duel-10", "duel-11", "duel-12", "duel-13"]],
];
const gallery = `<div class="gallery">${GALLERY.map(([kind, cap, alt, photos], gi) => `<figure class="${kind}" data-g="${gi}" aria-label="${cap}">${photos.map((f, i) => `<div class="slide${i === 0 ? " on" : ""}"><img class="fg" src="assets/foto/${f}.jpg" alt="${alt}" ${i <= 1 ? "" : 'loading="lazy" '}decoding="async"></div>`).join("")}<figcaption>${cap}</figcaption><button type="button" class="gzoom" aria-label="Perbesar foto ${cap}"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg></button></figure>`).join("")}</div>`;
const GALLERY_EVERY = 5; // detik per foto; tiap kotak mulai bergeser 1 detik supaya tidak berganti bersamaan
let galleryTick = 0;
function galleryGo(fig, to) {
  const slides = [...fig.querySelectorAll(".slide")];
  const n = slides.length;
  if (n < 2) return;
  const cur = Math.max(0, slides.findIndex((sl) => sl.classList.contains("on")));
  const next = (((to === undefined ? cur + 1 : to) % n) + n) % n;
  slides.forEach((sl, k) => sl.classList.toggle("on", k === next));
  const nx = slides[(next + 1) % n].querySelector(".fg");
  if (nx) nx.loading = "eager"; // siapkan foto berikutnya supaya fade tidak kosong
}
setInterval(() => {
  if (document.visibilityState !== "visible" || document.body.classList.contains("lb-open")) return;
  galleryTick++;
  document.querySelectorAll(".gallery figure").forEach((fig, i) => {
    if ((galleryTick + i) % GALLERY_EVERY !== 0) return;
    if (fig.matches(":hover") || Date.now() - (+fig.dataset.hold || 0) < 8000) return;
    galleryGo(fig);
  });
}, 1000);
let galleryTouch = null;
document.addEventListener("touchstart", (e) => {
  const fig = e.target.closest?.(".gallery figure");
  galleryTouch = fig ? { fig, x: e.touches[0].clientX } : null;
}, { passive: true });
document.addEventListener("touchend", (e) => {
  if (!galleryTouch) return;
  const dx = e.changedTouches[0].clientX - galleryTouch.x;
  if (Math.abs(dx) > 40) {
    const fig = galleryTouch.fig;
    fig.dataset.hold = Date.now();
    const cur = [...fig.querySelectorAll(".slide")].findIndex((sl) => sl.classList.contains("on"));
    galleryGo(fig, cur + (dx < 0 ? 1 : -1));
  }
  galleryTouch = null;
}, { passive: true });
// Lightbox galeri: klik foto untuk memperbesar. Responsif (HP sampai monitor lebar), ada tombol silang, panah, geser, dan keyboard.
function openGalleryLightbox(gi, start) {
  const g = GALLERY[gi];
  if (!g) return;
  const [, cap, alt, photos] = g;
  const n = photos.length;
  let cur = Math.min(Math.max(start | 0, 0), n - 1);
  const prevFocus = document.activeElement;
  const lb = document.createElement("div");
  lb.className = "glb";
  lb.setAttribute("role", "dialog");
  lb.setAttribute("aria-modal", "true");
  lb.setAttribute("aria-label", cap);
  const ico = (d) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  lb.innerHTML = `<div class="glb-top"><div class="glb-title"><b>${cap}</b><span class="glb-count"></span></div><button type="button" class="glb-x" aria-label="Tutup">${ico('<path d="M6 6l12 12M18 6L6 18"/>')}</button></div>`
    + `<div class="glb-stage"><img class="glb-img" alt="">${n > 1 ? `<button type="button" class="glb-nav prev" aria-label="Foto sebelumnya">${ico('<path d="M15 5l-7 7 7 7"/>')}</button><button type="button" class="glb-nav next" aria-label="Foto berikutnya">${ico('<path d="M9 5l7 7-7 7"/>')}</button>` : ""}</div>`
    + (n > 1 ? `<div class="glb-thumbs">${photos.map((f, i) => `<button type="button" data-i="${i}" aria-label="Foto ${i + 1}"><img src="assets/foto/t/${f}.jpg" alt="" loading="lazy" decoding="async"></button>`).join("")}</div>` : "");
  document.body.appendChild(lb);
  document.body.classList.add("lb-open");
  const img = lb.querySelector(".glb-img");
  const count = lb.querySelector(".glb-count");
  const thumbs = [...lb.querySelectorAll(".glb-thumbs button")];
  const show = (i) => {
    cur = ((i % n) + n) % n;
    img.classList.add("out");
    const src = `assets/foto/hd/${photos[cur]}.jpg`; // versi HD untuk tampilan zoom
    const done = () => img.classList.remove("out");
    img.onload = done; img.onerror = done;
    img.src = src;
    if (img.complete) done();
    img.alt = `${alt} (${cur + 1} dari ${n})`;
    count.textContent = n > 1 ? `${cur + 1} / ${n}` : "";
    thumbs.forEach((t, k) => { t.classList.toggle("on", k === cur); if (k === cur) t.scrollIntoView({ block: "nearest", inline: "center" }); });
    [cur + 1, cur - 1].forEach((k) => { const nb = photos[((k % n) + n) % n]; if (nb) new Image().src = `assets/foto/hd/${nb}.jpg`; });
  };
  const close = () => {
    document.removeEventListener("keydown", onKey, true);
    lb.remove();
    document.body.classList.remove("lb-open");
    const fig = document.querySelector(`.gallery figure[data-g="${gi}"]`);
    if (fig) { fig.dataset.hold = Date.now(); galleryGo(fig, cur); }
    if (prevFocus && prevFocus.isConnected) prevFocus.focus();
  };
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); show(cur + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); show(cur - 1); }
    else if (e.key === "Tab") {
      const f = [...lb.querySelectorAll("button")];
      const i = f.indexOf(document.activeElement);
      e.preventDefault();
      f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    }
  };
  document.addEventListener("keydown", onKey, true);
  lb.addEventListener("click", (e) => {
    if (e.target.closest(".glb-x") || e.target.classList.contains("glb-stage")) return close();
    if (e.target.closest(".glb-nav.next")) return show(cur + 1);
    if (e.target.closest(".glb-nav.prev")) return show(cur - 1);
    const t = e.target.closest(".glb-thumbs button");
    if (t) show(+t.dataset.i);
  });
  let sx = null, sy = null;
  const stage = lb.querySelector(".glb-stage");
  stage.addEventListener("touchstart", (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  stage.addEventListener("touchend", (e) => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    sx = sy = null;
    if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) show(cur + (dx < 0 ? 1 : -1));
    else if (dy > 90 && Math.abs(dy) > Math.abs(dx)) close(); // geser ke bawah = tutup
  }, { passive: true });
  show(cur);
  lb.querySelector(".glb-x").focus();
}
document.addEventListener("click", (e) => {
  const fig = e.target.closest?.(".gallery figure");
  if (!fig) return;
  const cur = [...fig.querySelectorAll(".slide")].findIndex((sl) => sl.classList.contains("on"));
  openGalleryLightbox(+fig.dataset.g, Math.max(cur, 0));
});

// Bilah atas (HTML statis di index.html) mengikuti TOURNAMENT supaya nama cukup diubah di util.js
document.querySelectorAll(".brand-t b").forEach((el) => { el.textContent = TOURNAMENT.line1; });
document.querySelectorAll(".brand-t i").forEach((el) => { el.textContent = TOURNAMENT.line2; });
document.querySelector(".brand")?.setAttribute("aria-label", `${TOURNAMENT.name}, ke beranda`);

const footer = `<footer class="foot">${TOURNAMENT.name} · ${TOURNAMENT.venue}<br><a href="admin/">Login panitia</a></footer>`;
const dateRange = "20 Nov – 4 Des 2026";

let boardIdx = 0;
function boardItems(live, next) {
  const items = live.map((m) => ({ m, kind: "live" }));
  // Dua lapangan: tampilkan laga berikutnya di tiap lapangan yang sedang tidak dipakai laga live
  const busy = new Set(live.map((m) => m.court || 0)), seen = new Set();
  for (const m of next) {
    const c = m.court || 0;
    if (seen.has(c) || (c && busy.has(c))) continue;
    seen.add(c);
    items.push({ m, kind: "next" });
  }
  if (!items.some((i) => i.kind === "next") && next[0]) items.push({ m: next[0], kind: "next" });
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
      <div class="board-num ${kind === "next" ? "vs" : ""}">${kind === "next" ? "vs" : bigScore(m)}</div>
      <div class="board-team">${badge(B, false, "lg")}${esc(sideName(m, "B"))}</div>
    </div>
    <div class="board-foot">${kind === "live" ? statusPill(m) : `<span class="board-meta">${when}</span>`}<a class="board-link" href="#/laga/${esc(m.id)}">Detail pertandingan</a></div>
    ${items.length > 1 ? `<div class="board-tabs" role="tablist" aria-label="Pilih laga">${items.map((_, i) => `<button type="button" role="tab" aria-selected="${i === boardIdx}" class="${i === boardIdx ? "on" : ""}" data-board="${i}" aria-label="Laga ${i + 1}"></button>`).join("")}</div>` : ""}
  </div>`;
}

function homeView() {
  const { matches, settings } = state;
  const live = matches.filter((m) => m.status === "live").sort(sortByKickoff);
  const nextAll = matches.filter((m) => m.status === "scheduled").sort(sortByKickoff);
  const next = nextAll.slice(0, 3);
  const last = matches.filter((m) => m.status === "ft").sort((a, b) => sortByKickoff(b, a)).slice(0, 3);
  const standings = computeStandings(state.teams, matches, state.events);
  const groups = groupsOf(standings);
  if (!homeGroup || !standings[homeGroup]) homeGroup = live[0]?.group && standings[live[0].group] ? live[0].group : groups[0];
  const stats = computePlayerStats(state.players, state.events, state.teams, state.matches);
  const a = settings.announcement;

  let h = `<div class="banner-wrap"><section class="board" aria-label="Laga utama">${boardView(boardItems(live, nextAll))}</section>
    <div class="strip" aria-label="Informasi turnamen">
      <div><small>Tanggal</small><b>${dateRange}</b></div>
      <div><small>Lokasi</small><b>${esc(TOURNAMENT.venue)}</b></div>
      <div><small>Peserta</small><b>16 tim, 4 grup</b></div>
      <div><small>Format</small><b>Grup, lalu babak gugur</b></div>
    </div></div>`;

  if (a?.active && (a.title || a.body)) h += `<div class="announce"><h3>${esc(a.title)}</h3><p>${esc(a.body)}</p></div>`;
  if (champOn()) { const ci = championInfo(state.matches); h += `<a class="champ-banner" href="#/juara"><small>Turnamen selesai</small><b>Juara: ${esc(tName(ci.champion))}</b><span>Lihat juara dan arsip turnamen →</span></a>`; }
  h += '<div class="home-grid"><div class="hcol">';
  if (live.length) {
    h += `<div class="head"><h2>Sedang berlangsung</h2></div>` + live.map((m) => {
      const evs = state.events.filter((e) => e.matchId === m.id), fd = feedHtml(m, evs, { limit: 3 });
      return `<div class="livecard lf"><a class="lf-head" href="#/laga/${esc(m.id)}">
        <div class="top"><span>${matchLabel(m)}</span>${statusPill(m)}</div>
        <div class="scoreline"><span class="t">${sideBadge(m, "A")}<span class="n">${esc(sideName(m, "A"))}</span></span><span class="s">${scoreText(m)}</span><span class="t r"><span class="n">${esc(sideName(m, "B"))}</span>${sideBadge(m, "B")}</span></div></a>
        <div class="feed lf-feed">${evs.length ? fd : `<p class="fe-empty">Belum ada kejadian. Gol dan kartu muncul di sini.</p>`}</div>
        <a class="lf-more" href="#/laga/${esc(m.id)}">Semua kejadian dan line up</a></div>`;
    }).join("");
  }
  h += `<div class="head"><h2>Laga berikutnya</h2><a href="#/jadwal">Semua jadwal</a></div><div class="sheet">${next.length ? next.map(matchRow).join("") : `<p class="empty">Belum ada jadwal berikutnya.</p>`}</div>`;
  h += `<div class="head"><h2>Hasil terakhir</h2></div><div class="sheet">${last.length ? last.map(resultRow).join("") : `<p class="empty">Belum ada pertandingan yang selesai.</p>`}</div>`;
  h += '</div><div class="hcol">';
  h += `<div class="head"><h2>Klasemen${homeGroup ? " Grup " + esc(homeGroup) : ""}</h2><a href="#/klasemen">Semua grup</a></div>`;
  if (groups.length > 1) h += `<div class="chips">${groups.map((g) => `<button class="chip ${g === homeGroup ? "on" : ""}" data-group="${esc(g)}">Grup ${esc(g)}</button>`).join("")}</div>`;
  h += `<div class="sheet">${homeGroup ? standingsTable(standings[homeGroup], QUALIFY_PER_GROUP, groupDone(homeGroup)) : `<p class="empty">Klasemen tampil setelah tim dan grup dibuat.</p>`}</div>${homeGroup ? standingNote(false) : ""}`;
  h += `<div class="head"><h2>Statistik pemain</h2><a href="#/statistik">Selengkapnya</a></div>${statTiles(stats)}`;
  h += "</div></div>";
  h += `<div class="head"><h2>Suasana turnamen</h2></div>${gallery}`;
  h += `<div class="head"><h2>Penyelenggara</h2></div>${sponsors}${footer}`;
  return h;
}

function matchRow(m) {
  const today = dayKey(new Date()) === dayKey(m.kickoff);
  return `<a class="mrow" href="#/laga/${esc(m.id)}">
    <div class="when">${timeStr(m.kickoff)}${today ? "" : `<small>${dayShort(m.kickoff)}</small>`}</div>
    <div class="vs">${vt(m, "A")}${vt(m, "B")}<span class="sub">${matchLabel(m)}</span></div><span></span></a>`;
}
function resultRow(m) {
  const a = m.scoreA ?? 0, b = m.scoreB ?? 0;
  return `<a class="res" href="#/laga/${esc(m.id)}">
    <span class="tn ${a > b ? "win" : ""}">${sideBadge(m, "A")}<span class="n">${esc(sideName(m, "A"))}</span></span>
    <span class="sc">${a} – ${b}</span>
    <span class="tn r ${b > a ? "win" : ""}"><span class="n">${esc(sideName(m, "B"))}</span>${sideBadge(m, "B")}</span></a>`;
}

// ---------- Jadwal ----------
function jadwalView() {
  const all = [...state.matches].sort(sortByKickoff);
  const groups = [...new Set(all.filter((m) => m.stage === "group" || !m.stage).map((m) => m.group).filter(Boolean))].sort();
  const hasKo = all.some((m) => m.stage && m.stage !== "group");
  const filtered = all.filter((m) => {
    if (jadwalCourt && m.court !== jadwalCourt) return false;
    if (jadwalFilter === "all") return true;
    if (jadwalFilter === "ko") return m.stage && m.stage !== "group";
    return (m.stage === "group" || !m.stage) && m.group === jadwalFilter;
  });
  let h = `<div class="head"><h2>Jadwal</h2></div><div class="chips">
    <button class="chip ${jadwalFilter === "all" ? "on" : ""}" data-filter="all">Semua</button>
    ${groups.map((g) => `<button class="chip ${jadwalFilter === g ? "on" : ""}" data-filter="${esc(g)}">Grup ${esc(g)}</button>`).join("")}
    ${hasKo ? `<button class="chip ${jadwalFilter === "ko" ? "on" : ""}" data-filter="ko">Babak gugur</button>` : ""}</div>
    ${all.some((m) => m.court) ? `<div class="chips courts" aria-label="Pilih lapangan"><button class="chip ${jadwalCourt === 0 ? "on" : ""}" data-court="0">Semua lapangan</button>${TOURNAMENT.courts.map((c, i) => `<button class="chip ${jadwalCourt === i + 1 ? "on" : ""}" data-court="${i + 1}">${esc(c)}</button>`).join("")}</div>` : ""}`;
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
      const played = m.status !== "scheduled";
      const mid = `${vt(m, "A", played ? `<span class="s">${m.scoreA ?? 0}</span>` : "")}${vt(m, "B", played ? `<span class="s">${m.scoreB ?? 0}</span>` : "")}`;
      return `<a class="mrow ${m.status === "live" ? "liverow" : ""}" href="#/laga/${esc(m.id)}"><div class="when">${timeStr(m.kickoff)}</div><div class="vs">${mid}<span class="sub">${matchLabel(m)}${played ? penNote(m) : ""}</span></div>${m.status === "scheduled" ? "<span></span>" : statusPill(m)}</a>`;
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
    gs.map((g) => `<div class="sheet"><div class="gtitle">Grup ${esc(g)}</div>${standingsTable(standings[g], QUALIFY_PER_GROUP, groupDone(g))}</div>`).join("") +
    `</div>${standingNote()}`;
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
    <section class="round r-fn" aria-label="Final"><h3>Final</h3><div class="rc">${bracketCard(b.final, "final")}</div></section>
  </div>
  ${footer}`;
}

// ---------- Statistik ----------
// Peringkat dengan nilai sama berbagi nomor (1, 1, 1, 4, ...). Foto pemain diganti nomor punggung; di bawah nama ada logo kecil + nama tim.
const rankOf = (list, i, val) => { let r = i; while (r > 0 && val(list[r - 1]) === val(list[i])) r--; return r + 1; };
const jersey = (p) => `<span class="jno">${p.number != null && p.number !== "" ? esc(p.number) : "–"}</span>`;
const teamLine = (teamId, extra = "") => `<span class="tmline">${badge(state.teamById[teamId], true)}<em>${esc(tName(teamId))}${extra}</em></span>`;
function playerRows(list, key, unit) {
  if (!list.length) return `<p class="empty">Belum ada data.</p>`;
  return `<div class="prow-h"><span>Pemain</span><span>${esc(unit.charAt(0).toUpperCase() + unit.slice(1))}</span></div><div class="scrollbox">`
    + list.map((p, i) => `<div class="prow pl"><span class="n">${rankOf(list, i, (x) => x[key])}</span>${jersey(p)}<span class="who"><b><a class="plink" href="#/pemain/${esc(p.id)}">${esc(p.name)}</a></b>${teamLine(p.teamId)}</span><span class="v">${p[key]}</span></div>`).join("")
    + `</div>`;
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
  const keepers = computeKeeperStats(state.players, state.matches, state.teams, state.events);
  const gk = state.playerById[state.settings.bestGkId];
  const carded = stats.filter((p) => p.yellow + p.red > 0).sort((a, b) => b.red - a.red || b.yellow - a.yellow);
  return `<div class="head"><h2>Statistik pemain</h2></div><div class="stats-grid">
  ${gk ? keeperAward(gk) : `<div class="sheet gkaward idle"><span class="gk-tag">Kiper terbaik</span><p class="muted">Belum ditentukan. Dipilih panitia di akhir turnamen; peringkat kiper ada di bawah.</p></div>`}
  <div class="sheet"><h3>Top scorer</h3>${playerRows(topBy(stats, "goals", Infinity), "goals", "gol")}</div>
  <div class="sheet"><h3>Top assist</h3>${playerRows(topBy(stats, "assists", Infinity), "assists", "assist")}</div>
  <div class="sheet"><h3>Peringkat kiper</h3>${keepers.length ? `<div class="scrollbox"><table class="tbl-sm"><thead><tr><th>Kiper</th><th>Main</th><th>CS</th><th>KB</th><th>Rata²</th></tr></thead><tbody>${keepers.map((k) => `<tr><td><div class="who-cell">${jersey(k)}<div><b>${esc(k.name)}</b>${teamLine(k.teamId, ` · <span class="${k.progress.out ? "gk-out" : ""}">${esc(k.progress.label)}</span>`)}</div></div></td><td>${k.played}</td><td><b>${k.cleanSheets}</b></td><td>${k.conceded}</td><td>${k.avg.toFixed(1)}</td></tr>`).join("")}</tbody></table></div><p class="note" style="padding:8px 16px 12px">CS = tidak kebobolan (lawan 0 gol). KB = jumlah gol kemasukan. Perpanjangan waktu dihitung, adu penalti tidak.</p>` : `<p class="empty">Belum ada data. Dihitung dari laga selesai.</p>`}</div>
  <div class="sheet"><h3>Kartu</h3>${carded.length ? `<div class="prow-h"><span>Pemain</span><span>Kartu</span></div><div class="scrollbox">${carded.map((p, i) => `<div class="prow pl"><span class="n">${rankOf(carded, i, (x) => x.red + "-" + x.yellow)}</span>${jersey(p)}<span class="who"><b><a class="plink" href="#/pemain/${esc(p.id)}">${esc(p.name)}</a></b>${teamLine(p.teamId)}</span><span class="v" style="font-size:18px">${p.yellow ? `<span class="ico yc"></span>${p.yellow}` : ""} ${p.red ? `<span class="ico rc"></span>${p.red}` : ""}</span></div>`).join("")}</div>` : `<p class="empty">Belum ada kartu.</p>`}</div>
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
    ${byGroup[g].sort(byEntry).map((t) => {
      const roster = state.players.filter((p) => p.teamId === t.id && p.role !== "official").sort((a, b) => (a.number ?? 999) - (b.number ?? 999));
      const officials = state.players.filter((p) => p.teamId === t.id && p.role === "official");
      return `<details class="team" data-team="${esc(t.id)}" ${openTeams.has(t.id) ? "open" : ""}>
        <summary>${badge(t)}<span>${esc(t.name)}</span><span class="c">${roster.length} pemain</span></summary>
        <div class="roster"><a class="tprofile" href="#/tim/${esc(t.id)}">Profil dan riwayat tim →</a>${roster.length ? roster.map((p) => `<div class="pl"><span class="no">${p.number ?? ""}</span><span><a class="plink" href="#/pemain/${esc(p.id)}">${esc(p.name)}</a></span>${p.isGK ? '<span class="badge-gk">GK</span>' : ""}${p.isCaptain ? '<span class="badge-gk badge-cap">C</span>' : ""}</div>`).join("") : `<p class="muted small" style="padding:6px 0">Pemain belum diinput.</p>`}${officials.length ? `<p class="muted small ofs">Official: ${officials.map((o) => esc(o.name)).join(", ")}</p>` : ""}</div></details>`;
    }).join("")}</div>`).join("") + `</div>${footer}`;
}

// ---------- Profil tim dan pemain ----------
const sbox = (v, l) => `<div><b>${v}</b><span>${l}</span></div>`;
const resChip = (r) => (r ? `<span class="rchip r-${r.res}" title="${r.res === "M" ? "Menang" : r.res === "K" ? "Kalah" : "Seri"}">${r.res}</span>` : "");
const evIcons = (rw) => [
  rw.goals.length ? `<span class="pe">${ballSvg()}${rw.goals.map((e) => eventMinute(e)).join(", ")}${rw.goals.some((e) => e.pen) ? ' <i class="evtag">P</i>' : ""}</span>` : "",
  rw.og.length ? `<span class="pe">${ballSvg("og")}${rw.og.map((e) => eventMinute(e)).join(", ")} <i class="evtag og">OG</i></span>` : "",
  rw.assists.length ? `<span class="pe">Assist ${rw.assists.length}</span>` : "",
  rw.yellow.length ? `<span class="pe"><span class="ico yc"></span>${rw.yellow.length}</span>` : "",
  rw.red.length ? `<span class="pe"><span class="ico rc"></span>${rw.red.length}</span>` : "",
].join("");
function teamProfileView(id) {
  const t = state.teamById[id];
  if (!t) return `<a class="back" href="#/tim">← Tim</a><div class="sheet"><p class="empty">Tim tidak ditemukan.</p></div>`;
  const s = teamSummary(id, state), prog = teamProgress(id, state.teams, state.matches, state.events);
  const played = (pid) => state.matches.filter((m) => m.status !== "scheduled" && (lineupIds(m, "A").includes(pid) || lineupIds(m, "B").includes(pid))).length;
  const hist = s.history.length ? s.history.map(({ m, opp, r }) => `<a class="hrow" href="#/laga/${esc(m.id)}"><span class="hw">${resChip(r)}</span>
      <span class="hv">${m.teamA === id ? "" : "@ "}${esc(opp ? tName(opp) : "Belum ditentukan")}<small>${matchLabel(m)}${m.kickoff ? " · " + dayShort(m.kickoff) : ""}</small></span>
      <b>${r ? `${r.my} – ${r.opp}${r.pen ? ` <small>(pen ${r.pen === "menang" ? "menang" : "kalah"})</small>` : ""}` : m.status === "live" ? "LIVE" : timeStr(m.kickoff)}</b></a>`).join("") : `<p class="empty">Belum ada jadwal.</p>`;
  return `<a class="back" href="#/tim">← Tim</a>
    <div class="ph"><div class="ph-top">${badge(t, false, "lg")}<div><h2>${esc(t.name)}</h2><p>${t.group ? `Grup ${esc(t.group)} · ` : ""}${esc(prog.label)}</p></div></div>
    <div class="sgrid">${sbox(s.played, "Main")}${sbox(`${s.w}-${s.d}-${s.l}`, "M-S-K")}${sbox(s.gf, "Gol")}${sbox(s.ga, "Kebobolan")}${sbox(s.assists, "Assist")}${sbox(s.yellow, "Kuning")}${sbox(s.red, "Merah")}</div></div>
    <div class="head"><h2>Pemain</h2></div>
    <div class="sheet" style="overflow-x:auto">${s.roster.length ? `<table class="std ptbl"><thead><tr><th>#</th><th class="tm">Pemain</th><th>Main</th><th>Gol</th><th>Ast</th><th><span class="ico yc"></span></th><th><span class="ico rc"></span></th></tr></thead><tbody>${s.roster.map((p) => `<tr><td class="rank">${p.number ?? ""}</td><td class="tm"><a class="plink" href="#/pemain/${esc(p.id)}">${esc(p.name)}</a>${p.isGK ? ' <span class="badge-gk">GK</span>' : ""}${p.isCaptain ? ' <span class="badge-gk badge-cap">C</span>' : ""}</td><td>${played(p.id)}</td><td>${p.goals}</td><td>${p.assists}</td><td>${p.yellow}</td><td>${p.red}</td></tr>`).join("")}</tbody></table>` : `<p class="empty">Pemain belum diinput.</p>`}</div>
    <div class="head"><h2>Riwayat laga</h2></div><div class="sheet">${hist}</div>${footer}`;
}
function playerProfileView(id) {
  const d = playerProfile(id, state);
  if (!d || d.p.role === "official") return `<a class="back" href="#/tim">← Tim</a><div class="sheet"><p class="empty">Pemain tidak ditemukan.</p></div>`;
  const { p, stat, rows, keeper } = d, t = state.teamById[p.teamId];
  const boxes = [sbox(d.played, "Main"), sbox(stat.goals, "Gol"), sbox(stat.assists, "Assist"), sbox(stat.yellow, "Kuning"), sbox(stat.red, "Merah")];
  if (stat.ownGoals) boxes.push(sbox(stat.ownGoals, "Gol bunuh diri"));
  if (keeper && keeper.played) boxes.push(sbox(keeper.cleanSheets, "Clean sheet"), sbox(keeper.conceded, "Kebobolan"));
  const hist = rows.length ? [...rows].reverse().map((rw) => `<a class="hrow" href="#/laga/${esc(rw.m.id)}"><span class="hw">${resChip(rw.r)}</span>
      <span class="hv">vs ${esc(rw.opp ? tName(rw.opp) : "–")}<small>${matchLabel(rw.m)}${rw.m.kickoff ? " · " + dayShort(rw.m.kickoff) : ""}</small><span class="pes">${evIcons(rw) || '<span class="muted small">Tanpa catatan</span>'}</span></span>
      <b>${rw.r ? `${rw.r.my} – ${rw.r.opp}` : "LIVE"}</b></a>`).join("") : `<p class="empty">Belum ada laga.</p>`;
  return `<a class="back" href="${t ? "#/tim/" + esc(t.id) : "#/tim"}">← ${esc(t?.name || "Tim")}</a>
    <div class="ph"><div class="ph-top"><span class="ph-no">${p.number ?? ""}</span><div><h2>${esc(p.name)}</h2><p>${t ? `<a class="plink" href="#/tim/${esc(t.id)}">${esc(t.name)}</a>` : ""}${p.isGK ? ' <span class="badge-gk">GK</span>' : ""}${p.isCaptain ? ' <span class="badge-gk badge-cap">C</span>' : ""}</p></div></div>
    <div class="sgrid">${boxes.join("")}</div></div>
    <div class="head"><h2>Riwayat laga</h2></div><div class="sheet">${hist}</div>${footer}`;
}

// ---------- Juara dan arsip ----------
const champOn = () => isReady() && !!championInfo(state.matches);
function juaraView() {
  const info = championInfo(state.matches);
  const done = state.matches.filter((m) => m.status === "ft");
  const stats = computePlayerStats(state.players, state.events, state.teams, state.matches);
  const std = computeStandings(state.teams, state.matches, state.events);
  const goals = state.events.filter((e) => e.type === "goal" || e.type === "own_goal").length;
  const cards = (ty) => state.events.filter((e) => e.type === ty).length;
  const gk = state.playerById[state.settings.bestGkId];
  const place = (label, id) => id ? `<a class="podrow" href="#/tim/${esc(id)}">${badge(state.teamById[id], true)}<span><small>${label}</small><b>${esc(tName(id))}</b></span></a>` : "";
  const top = (key, label) => { const p = topBy(stats, key, 1)[0]; return `<div class="aw"><small>${label}</small><b>${p ? `<a class="plink" href="#/pemain/${esc(p.id)}">${esc(p.name)}</a>` : "–"}</b><span>${p ? `${esc(tName(p.teamId))} · ${p[key]}` : "Belum ada"}</span></div>`; };
  const hero = info
    ? `<div class="champ"><small>Juara</small>${badge(state.teamById[info.champion], false, "lg")}<h2>${esc(tName(info.champion))}</h2>
        <p>Final: ${esc(sideName(info.fin, "A"))} ${info.fin.scoreA ?? 0} – ${info.fin.scoreB ?? 0} ${esc(sideName(info.fin, "B"))}${penNote(info.fin)}</p><a class="tprofile" href="#/laga/${esc(info.fin.id)}">Lihat laga final →</a></div>
       <div class="podium">${place("Runner-up", info.runnerUp)}</div>`
    : `<div class="champ idle"><h2>Turnamen belum selesai</h2><p>Halaman ini menampilkan juara setelah final selesai. Sementara itu, arsip hasil di bawah terus bertambah.</p></div>`;
  const awards = `<div class="awards">${top("goals", "Top scorer")}${top("assists", "Top assist")}<div class="aw"><small>Kiper terbaik</small><b>${gk ? `<a class="plink" href="#/pemain/${esc(gk.id)}">${esc(gk.name)}</a>` : "–"}</b><span>${gk ? esc(tName(gk.teamId)) : "Dipilih panitia"}</span></div></div>`;
  const nums = `<div class="sgrid">${sbox(done.length, "Laga")}${sbox(goals, "Gol")}${sbox(done.length ? (goals / done.length).toFixed(1) : "0", "Gol per laga")}${sbox(cards("yellow"), "Kuning")}${sbox(cards("red"), "Merah")}</div>`;
  const order = ["final", "sf", "qf"];
  const arch = order.map((st) => ({ st, l: done.filter((m) => m.stage === st).sort((a, b) => sortByKickoff(b, a)) })).filter((x) => x.l.length)
    .map((x) => `<div class="daygroup">${STAGES[x.st]}</div><div class="sheet">${x.l.map(resultRow).join("")}</div>`).join("");
  const groups = groupsOf(std).map((g) => {
    const l = done.filter((m) => (m.stage === "group" || !m.stage) && m.group === g).sort(sortByKickoff);
    return `<div class="daygroup">Grup ${esc(g)}</div><div class="sheet">${standingsTable(std[g], QUALIFY_PER_GROUP, groupDone(g))}</div>${l.length ? `<div class="sheet">${l.map(resultRow).join("")}</div>` : ""}`;
  }).join("");
  return `${hero}<div class="head"><h2>Penghargaan</h2></div>${awards}<div class="head"><h2>Angka turnamen</h2></div>${nums}
    <div class="head"><h2>Arsip hasil</h2></div>${arch}${groups || (!arch ? `<p class="empty">Belum ada pertandingan yang selesai.</p>` : "")}${footer}`;
}

// ---------- Detail laga ----------
function eventIcon(e) {
  if (e.type === "goal") return `<span class="evic">${ballSvg()}${e.pen ? '<i class="evtag">P</i>' : ""}</span>`;
  if (e.type === "own_goal") return `<span class="evic">${ballSvg("og")}<i class="evtag og">OG</i></span>`;
  if (e.type === "sub") return `<span class="evic"><span class="subic" aria-hidden="true">⇄</span></span>`;
  if (e.type === "yellow") return `<span class="evic"><span class="ico yc"></span></span>`;
  if (e.type === "red") return `<span class="evic"><span class="ico rc"></span></span>`;
  return `<span class="evic"><span class="ico dot"></span></span>`;
}
function eventText(m, e) {
  const who = `${esc(pName(e.playerId))} (${esc(tName(e.teamId))})`;
  if (e.type === "goal") return `<b>${e.pen ? "Gol penalti" : "Gol"}, ${who}</b>${e.assistId ? `<small>Assist: ${esc(pName(e.assistId))}</small>` : ""}`;
  if (e.type === "own_goal") return `<b>Gol bunuh diri, ${who}</b>`;
  if (e.type === "sub") return `<b>Pergantian (${esc(tName(e.teamId))})</b><small>Masuk: ${esc(pName(e.playerId))} · Keluar: ${esc(pName(e.outId))}</small>`;
  if (e.type === "yellow") return `<b>Kartu kuning, ${who}</b>`;
  if (e.type === "red") return `<b>Kartu merah, ${who}</b>${e.second ? "<small>Kartu kuning kedua</small>" : ""}`;
  return `<b>${esc(e.note || "Kejadian")}</b>`;
}
const evSort = eventCmp;
// Baris jalannya laga: tim A di kiri, tim B di kanan, menit di tengah; FT, kick-off, dan catatan fase di tengah.
const tlC = (min, inner) => `<div class="tl tl2 s-c"><span class="min">${min}</span>${inner}</div>`;
function tlRow(m, e) {
  const sd = eventSide(m, e);
  if (sd === "c") return tlC(eventMinute(e), `<div class="ev">${eventText(m, e)}</div>`);
  const body = `<div class="tl-body">${eventIcon(e)}<div class="ev">${eventText(m, e)}</div></div>`;
  return `<div class="tl tl2 s-${sd}"><div class="tl-l">${sd === "a" ? body : ""}</div><span class="min">${eventMinute(e)}</span><div class="tl-r">${sd === "b" ? body : ""}</div></div>`;
}

/** Gol dikelompokkan per pemain (urut menurut gol pertamanya) supaya nama yang sama tampil sekali dengan menit dipisah koma. */
function groupGoals(list) {
  const map = new Map();
  for (const e of list) { const k = e.playerId + (e.type === "own_goal" ? "|og" : ""); if (!map.has(k)) map.set(k, []); map.get(k).push(e); }
  return [...map.values()];
}
function scorersList(m, side) {
  const me = side === "A" ? m.teamA : m.teamB;
  const list = state.events
    .filter((e) => e.matchId === m.id && ((e.type === "goal" && e.teamId === me) || (e.type === "own_goal" && e.teamId !== me)))
    .sort(evSort);
  return groupGoals(list).map((g) => {
    const og = g[0].type === "own_goal", ic = ballSvg(og ? "og" : "");
    const txt = `<span class="sn">${esc(pName(g[0].playerId))} ${g.map((e) => eventMinute(e) + (e.pen ? ' <i class="evtag">P</i>' : "")).join(", ")}${og ? ' <i class="evtag og">OG</i>' : ""}</span>`;
    return `<p>${side === "B" ? txt + ic : ic + txt}</p>`; // tim kanan: bola di tepi kanan supaya lurus satu kolom
  }).join("");
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

// ---------- Riwayat pertemuan ----------
function h2hCard(m) {
  const h = headToHead(m, state.matches);
  if (!h) return "";
  const A = esc(sideName(m, "A")), B = esc(sideName(m, "B"));
  const inner = h.list.length
    ? `<div class="h2h-sum"><div><b>${h.w}</b><span>${A} menang</span></div><div><b>${h.d}</b><span>Seri</span></div><div><b>${h.l}</b><span>${B} menang</span></div></div>
       <p class="h2h-goals">Total gol: ${A} ${h.gf} – ${h.ga} ${B}</p>
       ${h.list.map((x) => `<div class="h2h-item">${resultRow(x)}<small>${matchLabel(x)}${x.kickoff ? " · " + dayShort(x.kickoff) : ""}</small></div>`).join("")}`
    : `<p class="empty">Belum ada pertemuan sebelumnya antara kedua tim di turnamen ini.</p>`;
  return `<div class="sheet h2h"><h3 style="font-family:var(--font-d);font-size:22px;padding:12px 16px 4px">Riwayat pertemuan</h3>${inner}</div>`;
}

// ---------- Feed kejadian ala Google: kartu gol berwarna tim, kartu kuning/merah, pergantian, penanda babak ----------
const evInH1 = (m, e) => (e.p ? e.p === "h1" : (m.cfg?.half || 0) > 0 && (e.minute ?? 0) <= (m.cfg?.half || 0));
const feTeam = (t) => (t ? `<span class="fe-tm">${badge(t, true)}<span>${esc(t.name)}</span></span>` : "");
function feedHtml(m, events, { limit = 0 } = {}) {
  const asc = [...events].sort(evSort);
  let ga = 0, gb = 0;
  const score = new Map();
  for (const e of asc) {
    if (e.type === "goal" || e.type === "own_goal") { if (eventSide(m, e) === "a") ga++; else gb++; }
    score.set(e.id, [ga, gb]);
  }
  const colorOf = (id) => { const t = state.teamById[id]; return t ? colorFor(t) : "#435a73"; };
  const who = (e, note) => {
    const p = state.playerById[e.playerId], t = state.teamById[e.teamId], no = p?.number;
    return `<div class="fe-body"><div class="fe-who"><b>${esc(pName(e.playerId))}</b>
      <span class="fe-sub">${t ? badge(t, true) : ""}<span>${esc(t?.name || "")}${p?.isGK ? " · Kiper" : ""}${no != null && no !== "" ? " · #" + esc(no) : ""}</span></span>${note || ""}</div>
      <span class="fe-av" style="--tc:${colorOf(e.teamId)}">${no != null && no !== "" ? esc(no) : ""}</span></div>`;
  };
  const card = (e) => {
    const min = esc(eventMinute(e)), sd = eventSide(m, e);
    if (e.type === "goal" || e.type === "own_goal") {
      const og = e.type === "own_goal", sc = score.get(e.id) || [0, 0];
      const tc = colorOf(sd === "a" ? m.teamA : m.teamB);
      const note = og ? `<span class="fe-note">Gol bunuh diri</span>` : `${e.pen ? `<span class="fe-note ok">Gol penalti</span>` : ""}${e.assistId ? `<span class="fe-note mute">Umpan gol: ${esc(pName(e.assistId))}</span>` : ""}`;
      return `<article class="fe fe-goal" style="--tc:${tc}"><header><span class="fe-ball">${ballSvg(og ? "og" : "")}</span><b>${og ? "GOL BUNUH DIRI" : "GOOOLLL!!!"}</b><span class="fe-min">${min}</span></header>
        <div class="fe-score"><span>${esc(sideName(m, "A"))}</span><b>${sc[0]}</b><i>–</i><b>${sc[1]}</b><span>${esc(sideName(m, "B"))}</span></div>${who(e, note)}</article>`;
    }
    if (e.type === "yellow" || e.type === "red") {
      const red = e.type === "red";
      return `<article class="fe fe-card"><header><span class="fe-chip ${red ? "rc" : "yc"}"></span><b>${red ? "KARTU MERAH" : "KARTU KUNING"}</b><span class="fe-min">${min}</span></header>${who(e, red && e.second ? `<span class="fe-note mute">Kartu kuning kedua</span>` : "")}</article>`;
    }
    if (e.type === "sub") {
      const t = state.teamById[e.teamId];
      return `<article class="fe fe-card"><header><span class="fe-swap" aria-hidden="true">⇅</span><b>PERGANTIAN</b><span class="fe-min">${min}</span></header>
        <div class="fe-body fe-in"><div class="fe-who"><small class="in">MASUK</small><b>${esc(pName(e.playerId))}</b></div></div>
        <div class="fe-body fe-out"><div class="fe-who"><small class="out">KELUAR</small><b>${esc(pName(e.outId))}</b><span class="fe-sub">${t ? badge(t, true) : ""}<span>${esc(t?.name || "")}</span></span></div></div></article>`;
    }
    return `<div class="fe-div"><span>${min} · ${esc(e.note || "Kejadian")}</span></div>`;
  };
  const ht = htScore(m, events);
  const htDiv = ht ? `<div class="fe-div ht"><b>ISTIRAHAT</b><span>${esc(sideName(m, "A"))} ${ht[0]} – ${ht[1]} ${esc(sideName(m, "B"))}</span></div>` : "";
  const out = [];
  if (m.status === "ft") {
    const tie = (m.scoreA ?? 0) === (m.scoreB ?? 0), pw = tie && m.penWinner ? tName(m.penWinner === "A" ? m.teamA : m.teamB) : "";
    out.push(`<div class="fe-div ft"><b>${m.wo ? "MENANG WO" : "PERTANDINGAN SELESAI"}</b><span>${esc(sideName(m, "A"))} ${scoreText(m)} ${esc(sideName(m, "B"))}</span>${m.wo ? "<small>Lawan tidak hadir. Hasil ditetapkan panitia.</small>" : ""}${m.etPlayed ? "<small>Setelah perpanjangan waktu</small>" : ""}${pw ? `<small>Menang adu penalti: ${esc(pw)}${penScoreText(m, true) ? ` (${penScoreText(m, true)})` : ""}</small>` : ""}</div>`);
  }
  let placed = !ht;
  for (const e of [...asc].reverse()) {
    if (!placed && evInH1(m, e)) { out.push(htDiv); placed = true; }
    out.push(card(e));
  }
  if (!placed) out.push(htDiv);
  if (m.status !== "scheduled" && !m.wo) out.push(`<div class="fe-div"><b>KICK-OFF</b></div>`);
  return (limit ? out.slice(0, limit) : out).join("");
}

/** Skor akhir babak 1 (HT) dari kejadian. Data lama tanpa cap babak dipisah lewat menit. Kosong bila belum/tidak ada babak 2. */
function htScore(m, events) {
  const c = m.cfg || {};
  if (m.wo || m.status === "scheduled" || (c.halves && c.halves < 2)) return null;
  if (m.status !== "ft" && (!m.phase || m.phase === "h1")) return null;
  const half = c.half || 0;
  let a = 0, b = 0;
  for (const e of events) {
    if (e.type !== "goal" && e.type !== "own_goal") continue;
    const inH1 = e.p ? e.p === "h1" : half > 0 && (e.minute ?? 0) <= half;
    if (!inH1) continue;
    const forA = (e.type === "goal" && e.teamId === m.teamA) || (e.type === "own_goal" && e.teamId === m.teamB);
    if (forA) a++; else b++;
  }
  return [a, b];
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
      <div class="bigscore ${m.status === "scheduled" ? "vs" : ""}">${m.status === "scheduled" ? "vs" : bigScore(m)}</div>
      <div class="tm">${badge(B, false, "lg")}<b>${esc(sideName(m, "B"))}</b></div></div>
    <div class="clockbig" ${m.status === "live" ? `data-clockbig="${esc(m.id)}"` : ""}>${m.status === "live" ? clockText(m) : ""}</div>
    ${addedText(m) ? `<div class="addednote">${esc(addedText(m))}</div>` : ""}
    ${(() => { const ht = htScore(m, events); return ht ? `<div class="htnote">Babak 1: ${ht[0]} – ${ht[1]}</div>` : ""; })()}
    ${shootout(m).any && (m.scoreA ?? 0) === (m.scoreB ?? 0) ? `<div class="addednote">Adu penalti ${penScoreText(m)}</div>` : ""}
    <div class="scorers"><div>${scorersList(m, "A")}</div><div>${scorersList(m, "B")}</div></div></div>`;

  const tabs = `<div class="tabs">${[["ringkasan", "Ringkasan"], ["lineup", "Line up"], ["statistik", "Statistik"]]
    .map(([k, l]) => `<a class="${tab === k ? "on" : ""}" href="#/laga/${esc(m.id)}${k === "ringkasan" ? "" : "/" + k}">${l}</a>`).join("")}</div>`;

  let body = "";
  if (tab === "ringkasan") {
    const so = shootout(m);
    const penCard = so.any ? `<div class="sheet pen-card"><h3>Adu penalti <b>${penScoreText(m)}</b></h3>
      <div class="pen-row"><span>${esc(sideName(m, "A"))}</span><span class="pk-dots">${penDots(m, "A")}</span></div>
      <div class="pen-row"><span>${esc(sideName(m, "B"))}</span><span class="pk-dots">${penDots(m, "B")}</span></div></div>` : "";
    body = `${penCard}<div class="feed"><h3 class="feed-h">Jalannya laga</h3>${m.status === "scheduled" ? `<div class="sheet"><p class="empty">Pertandingan belum dimulai.</p></div>` : feedHtml(m, events)}</div>`;
  } else if (tab === "lineup") {
    const ready = (m.lineupA?.starters || []).length && (m.lineupB?.starters || []).length;
    body = `<div class="sheet"><div class="lu-head"><h2>Line up</h2><span class="muted small">5 pemain inti dan cadangan (maksimal 10 pemain)</span></div>
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
      ${cmpRow("Gol bunuh diri", c(evA, (e) => e.type === "own_goal"), c(evB, (e) => e.type === "own_goal"))}
</div>`;
  }

  if (tab === "ringkasan") body += h2hCard(m);

  const motm = m.motmId && state.playerById[m.motmId]
    ? `<div class="motm"><div class="tag">Man of the Match</div><p class="name">${esc(pName(m.motmId))}</p><p>${esc(tName(state.playerById[m.motmId].teamId))}</p></div>`
    : m.status === "ft" ? "" : `<div class="motm"><div class="tag">Man of the Match</div><p>Dipilih panitia setelah laga selesai.</p></div>`;

  const susp = m.status === "ft" ? "" : ["A", "B"].flatMap((side) => {
    const t = side === "A" ? m.teamA : m.teamB;
    return [...suspendedIn(m, t, state.matches, state.events, state.players, state.settings.suspOverrides || {}).values()].map((o) => `<li><b>${esc(pName(o.playerId))}</b> (${esc(sideName(m, side))}): ${esc(suspReason(o))}</li>`);
  });
  const suspBox = susp.length ? `<div class="sheet susp-pub"><h3>Skorsing</h3><ul>${susp.join("")}</ul><p class="note">Pemain di atas tidak boleh bermain di laga ini.</p></div>` : "";
  return `<a class="back" href="#/">← Kembali</a>${head}${suspBox}${tabs}${body}${motm}`;
}

// ---------- Render ----------
function renderNav(name) {
  const active = name === "laga" ? "jadwal" : name === "pemain" ? "tim" : name;
  $nav.innerHTML = NAV.map((n) => {
    if (!n.sub) return `<a href="${n.href}" class="${n.key === active ? "on" : ""}" ${n.key === active ? 'aria-current="page"' : ""}>${n.label}</a>`;
    const on = n.sub.some((x) => x[2] === active);
    return `<div class="has-sub ${on ? "on" : ""} ${subOpen ? "open" : ""}">
      <button type="button" class="subbtn" data-sub aria-expanded="${subOpen}" aria-haspopup="true">${n.label}<i class="caret" aria-hidden="true"></i></button>
      <div class="submenu">${n.sub.filter(([, , key]) => key !== "juara" || champOn()).map(([href, label, key]) => `<a href="${href}" class="${key === active ? "on" : ""}" ${key === active ? 'aria-current="page"' : ""}>${label}</a>`).join("")}</div></div>`;
  }).join("");
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
  if (isReady()) {
    const b = computeBracket(state.teams, state.matches, state.events);
    slotByMatch = new Map([...b.qf, ...b.sf, b.final].filter((x) => x.match).map((x) => [x.match.id, x]));
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
      case "tim": html = r.id ? teamProfileView(r.id) : timView(); break;
      case "pemain": html = playerProfileView(r.id); break;
      case "juara": html = juaraView(); break;
      case "laga": html = matchView(r); break;
      default: html = homeView();
    }
  }
  const key = location.hash;
  if (html !== lastHtml || key !== lastKey) {
    const routeChanged = key !== lastKey;
    $app.innerHTML = html;
    if (routeChanged) { window.scrollTo(0, 0); scrolledJadwal = false; }
    lastHtml = html; lastKey = key;
  }
  if (r.name === "jadwal" && !scrolledJadwal && isReady() && !skelOn) {
    scrolledJadwal = true;
    const el = document.getElementById("today-anchor");
    if (el) setTimeout(() => el.scrollIntoView({ block: "start" }), 0);
  }
  const titles = { home: "", jadwal: "Jadwal · ", klasemen: "Klasemen · ", bagan: "Bagan · ", statistik: "Statistik · ", tim: "Tim · ", laga: "Pertandingan · " };
  document.title = (titles[r.name] ?? "") + TOURNAMENT.name;
}

// Interaksi (delegasi event)
document.addEventListener("click", (e) => {
  const g = e.target.closest("[data-group]");
  if (g) { homeGroup = g.dataset.group; lastHtml = ""; render(); return; }
  const f = e.target.closest("[data-filter]");
  if (f) { jadwalFilter = f.dataset.filter; lastHtml = ""; scrolledJadwal = true; render(); return; }
  const c = e.target.closest("[data-court]");
  if (c) { jadwalCourt = Number(c.dataset.court) || 0; lastHtml = ""; scrolledJadwal = true; render(); }
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
