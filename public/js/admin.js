// Panel admin IFL 2026. Hanya akun yang terdaftar di firestore.rules yang bisa menulis data.
import {
  db, auth, collection, doc, setDoc, updateDoc, deleteDoc, writeBatch, increment,
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
} from "./firebase.js";
import { state, startStore, onChange, isReady } from "./store.js";
import { parseFile, buildPlan, buildOps, LIMITS } from "./importer.js";
import { LOGO_LIBRARY, logoPath } from "./logos.js";
import {
  STAGES, esc, timeStr, dayShort, sortByKickoff, toLocalInput, fromLocalInput, elapsedSec, clockText,
  planKnockout, computeBracket, finalScore, scoreFromEvents, matchReadiness, lineupIds, FUTSAL_STARTERS, nowMs, syncServerTime, ballSvg,
  phaseOf, isPlayPhase, stampAt, stampNow, eventMinute, minuteNow, eventCmp, livePill, ftText, isReadyToStart, phaseActions,
  timingOf, cfgFor, isKnockout, PHASE_NAME, PAUSE_REASONS, periodLimitSec, computeKeeperStats, keeperDetail, teamProgress, skeleton,
} from "./util.js";

const $app = document.getElementById("app");
const $bar = document.getElementById("bar");
const $toast = document.getElementById("toast");

let user; // undefined = belum tahu, null = belum login

// ---------- Util kecil ----------
let toastTimer;
function toast(msg, err = false) {
  $toast.textContent = msg;
  $toast.className = "toast" + (err ? " err" : "");
  $toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($toast.hidden = true), err ? 6000 : 2200);
}
function errMsg(e) {
  if (e?.code === "permission-denied") return "Ditolak: akun ini belum diizinkan menulis. Cek UID admin di firestore.rules (lihat README).";
  if (e?.code === "auth/invalid-credential" || e?.code === "auth/wrong-password" || e?.code === "auth/user-not-found") return "Email atau password salah.";
  if (e?.code === "auth/too-many-requests") return "Terlalu banyak percobaan. Tunggu beberapa menit lalu coba lagi.";
  if (e?.code === "auth/network-request-failed") return "Tidak ada koneksi internet.";
  return e?.message || "Terjadi kesalahan.";
}
async function act(fn, ok) {
  try { await fn(); if (ok) toast(ok); } catch (e) { console.error(e); toast(errMsg(e), true); }
}
const byNumber = (a, b) => (a.number ?? 999) - (b.number ?? 999) || (a.name || "").localeCompare(b.name || "", "id");
const isOfficial = (p) => p.role === "official";
const playersOf = (teamId) => state.players.filter((p) => p.teamId === teamId && !isOfficial(p)).sort(byNumber);
const officialsOf = (teamId) => state.players.filter((p) => p.teamId === teamId && isOfficial(p)).sort((a, b) => (a.name || "").localeCompare(b.name || "", "id"));
// state tampilan sementara (lembar kejadian, draft line up, tab tim di HP)
const ui = { sheet: null, draft: null, side: "A", tabs: {} };
let importState = null; // { fileName, rows, replace }
const tName = (id) => state.teamById[id]?.name ?? "Belum ditentukan";
// Laga babak gugur yang timnya belum pasti tampil sebagai "Juara A", "Pemenang QF1", dst.
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
// Lencana tim: logo bila ada, kalau tidak lingkaran berwarna berisi singkatan (sama seperti website publik)
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
function badge(team, size = "") {
  const cls = size ? `tbadge ${size}` : "tbadge";
  if (team?.logoUrl) return `<span class="${cls}"><img src="${esc(team.logoUrl)}" alt="" loading="lazy"></span>`;
  return `<span class="${cls}" style="background:${esc(colorFor(team))}">${esc(initials(team))}</span>`;
}
const matchRef = (id) => doc(db, "matches", id);

function teamOptions(sel, blank = "— belum ditentukan —") {
  const ts = [...state.teams].sort((a, b) => (a.group || "").localeCompare(b.group || "") || a.name.localeCompare(b.name, "id"));
  return `<option value="">${blank}</option>` + ts.map((t) => `<option value="${esc(t.id)}" ${t.id === sel ? "selected" : ""}>${esc(t.group ? `[${t.group}] ` : "")}${esc(t.name)}</option>`).join("");
}
const stageOptions = (sel) => Object.entries(STAGES).map(([k, v]) => `<option value="${k}" ${k === (sel || "group") ? "selected" : ""}>${v}</option>`).join("");

function statusPill(m) {
  if (m.status === "live") { const l = livePill(m); return `<span class="pill live ${l.halted ? "pause" : ""}" data-clock="${esc(m.id)}">${esc(l.text)}</span>`; }
  if (m.status === "ft") return `<span class="pill ft">${ftText(m)}</span>`;
  return `<span class="pill soon">Terjadwal</span>`;
}

// ---------- Modal (pengganti alert / confirm / prompt bawaan browser) ----------
const nl2br = (t) => esc(t).replace(/\n/g, "<br>");
/**
 * Buka dialog. Mengembalikan Promise: nilai form (objek) / true bila OK, null bila dibatalkan.
 * opts: { title, message, fields (HTML), ok, cancel, danger, read(root) -> nilai, validate(nilai) -> pesan galat }
 */
function openModal(opts) {
  return new Promise((resolve) => {
    const prev = document.activeElement;
    const root = document.createElement("div");
    root.className = "modal-bg";
    root.innerHTML = `<div class="modal" role="${opts.fields ? "dialog" : "alertdialog"}" aria-modal="true" aria-labelledby="m-title" ${opts.message ? 'aria-describedby="m-msg"' : ""}>
      <h2 id="m-title">${esc(opts.title || "Konfirmasi")}</h2>
      ${opts.message ? `<p class="modal-msg" id="m-msg">${nl2br(opts.message)}</p>` : ""}
      ${opts.fields ? `<form class="modal-form" novalidate>${opts.fields}</form>` : ""}
      <p class="modal-err" role="alert" hidden></p>
      <div class="modal-actions">
        ${opts.cancel === false ? "" : `<button type="button" class="btn ghost" data-m="cancel">${esc(opts.cancel || "Batal")}</button>`}
        <button type="button" class="btn ${opts.danger ? "danger-solid" : "orange"}" data-m="ok">${esc(opts.ok || "Oke")}</button>
      </div></div>`;
    document.body.appendChild(root);
    document.body.classList.add("modal-open");
    const box = root.querySelector(".modal"), err = root.querySelector(".modal-err");
    const close = (val) => {
      document.removeEventListener("keydown", onKey, true);
      root.remove();
      if (!document.querySelector(".modal-bg")) document.body.classList.remove("modal-open");
      if (prev && prev.isConnected) prev.focus();
      resolve(val);
    };
    const submit = () => {
      const val = opts.read ? opts.read(root) : true;
      const msg = opts.validate ? opts.validate(val) : "";
      if (msg) { err.textContent = msg; err.hidden = false; return; }
      close(val);
    };
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(null); return; }
      if (e.key === "Enter" && e.target.matches?.("input:not([type=checkbox]), select") && opts.fields) { e.preventDefault(); submit(); return; }
      if (e.key === "Tab") {
        const f = [...box.querySelectorAll("input, select, textarea, button")].filter((el) => !el.disabled && el.offsetParent !== null);
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (!box.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey, true);
    root.addEventListener("click", (e) => {
      const b = e.target.closest("[data-m]");
      if (b) { b.dataset.m === "ok" ? submit() : close(null); return; }
      if (e.target === root) close(null);
    });
    const first = opts.fields ? box.querySelector("input:not([type=checkbox]), select") : null;
    (first || box.querySelector(opts.danger ? '[data-m="cancel"]' : '[data-m="ok"]') || box.querySelector("button"))?.focus();
    if (first?.select) first.select();
  });
}
/** Pengganti confirm(): resolve true bila OK, false bila batal. */
async function confirmBox(message, { title = "Konfirmasi", ok = "Ya, lanjutkan", cancel = "Batal", danger = false } = {}) {
  return !!(await openModal({ title, message, ok, cancel, danger }));
}
/** Konfirmasi berat: pengguna harus mengetik kata tertentu (mis. HAPUS). Resolve true / false. */
async function typeConfirm(message, word, { title, ok }) {
  return !!(await openModal({
    title, message, ok, danger: true,
    fields: `<label for="mc-w">Ketik <b>${esc(word)}</b> untuk melanjutkan</label><input id="mc-w" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="${esc(word)}">`,
    read: (r) => r.querySelector("#mc-w").value.trim().toUpperCase(),
    validate: (v) => (v === word ? "" : `Ketik ${word} dulu untuk melanjutkan.`),
  }));
}
/** Hapus banyak dokumen sekaligus (dipecah per 400 karena batas Firestore). */
async function deleteMany(refs) {
  for (let i = 0; i < refs.length; i += 400) {
    const b = writeBatch(db);
    refs.slice(i, i + 400).forEach((r) => b.delete(r));
    await b.commit();
  }
}
/** Pengganti prompt() ubah pemain: nomor, nama, kiper. Resolve objek atau null. */
function playerBox(p, others) {
  return openModal({
    title: "Ubah pemain", ok: "Simpan",
    fields: `<div class="grid3" style="align-items:end"><div><label for="mp-no">No.</label><input id="mp-no" type="number" name="number" min="0" max="99" value="${p.number ?? ""}"></div>
      <div style="grid-column:span 2"><label for="mp-nm">Nama pemain</label><input id="mp-nm" type="text" name="name" value="${esc(p.name)}" maxlength="60" autocomplete="off"></div></div>
      <label class="check"><input type="checkbox" name="gk" ${p.isGK ? "checked" : ""}> Kiper (GK)</label>`,
    read: (r) => ({ number: r.querySelector('[name="number"]').value.trim(), name: r.querySelector('[name="name"]').value.trim(), isGK: r.querySelector('[name="gk"]').checked }),
    validate: (v) => {
      if (!v.name) return "Nama tidak boleh kosong.";
      if (v.number !== "" && (!/^\d{1,2}$/.test(v.number))) return "Nomor punggung harus angka 0–99.";
      if (v.number !== "" && others.some((x) => x.number === Number(v.number))) return `No punggung ${v.number} sudah dipakai pemain lain di tim ini.`;
      return "";
    },
  });
}
/** Tab pilihan di dalam kartu (menggantikan lipatan +/–). */
const tabsNav = (group, items, cur) => `<div class="mtabs" role="tablist">${items.map(([k, l]) => `<button type="button" role="tab" aria-selected="${k === cur}" class="${k === cur ? "on" : ""}" data-act="tab" data-group="${group}" data-tab="${k}">${l}</button>`).join("")}</div>`;

// ---------- Routing ----------
function route() {
  const [name, id] = location.hash.replace(/^#\/?/, "").split("/");
  return { name: name || "matches", id };
}

// ---------- Tampilan ----------
function loginView() {
  return `<div class="login"><img src="../assets/ifl-emblem.png" alt="IFL">
    <h2 class="a" style="text-align:center">Login panitia</h2>
    <form data-form="login">
      <label>Email</label><input type="email" name="email" autocomplete="username" required>
      <label>Password</label><input type="password" name="password" autocomplete="current-password" required>
      <div class="form-actions"><button class="btn orange big" type="submit">Masuk</button></div>
    </form><p class="hint" style="text-align:center"><a href="../">← Ke website publik</a></p></div>`;
}

// Menu bercabang. Kunci = nama halaman di alamat (#kunci).
const NAV = [
  { title: "Pertandingan", items: [["matches", "Semua pertandingan"], ["match-add", "Tambah pertandingan"]] },
  { title: "Tim & Pemain", items: [["teams", "Daftar tim"], ["team-add", "Tambah tim"]] },
  { title: "Pengaturan", items: [["set-announce", "Pengumuman"], ["set-timing", "Durasi pertandingan"], ["set-keeper", "Kiper terbaik"], ["set-reset", "Hapus data"]] },
];
const NAV_ALIAS = { match: "matches", team: "teams", settings: "set-announce" };
const navGroup = (key) => NAV.find((g) => g.items.some(([k]) => k === key));
const navKey = (r = route()) => { const k = NAV_ALIAS[r.name] || r.name; return navGroup(k) ? k : "matches"; };

function topBar() {
  const key = navKey();
  const cur = navGroup(key);
  const liveNow = state.matches.filter((m) => m.status === "live").length;
  const dot = (g) => (g === NAV[0] && liveNow ? `<i class="livedot" title="Ada laga LIVE"></i>` : "");
  const tree = NAV.map((g) => `<div class="side-group ${g === cur ? "cur" : ""}"><div class="side-title">${esc(g.title)} ${dot(g)}</div>
      <div class="side-sub">${g.items.map(([k, l]) => `<a class="${k === key ? "on" : ""}" href="#${k}" ${k === key ? 'aria-current="page"' : ""}>${l}</a>`).join("")}</div></div>`).join("");
  return `<aside class="side" id="side">
    <div class="side-brand"><img src="../assets/ifl-emblem.png" alt=""><div><b>Admin IFL</b><small>Panel panitia 2026</small></div></div>
    <nav class="side-tree" aria-label="Menu admin">${tree}</nav>
    <div class="side-foot">
      <a class="side-link" href="../" target="_blank" rel="noopener">Lihat website publik ↗</a>
      <span class="who" title="UID: ${esc(user.uid)}">${esc(user.email)}</span>
      <button class="btn sm ghost" data-act="logout">Keluar</button>
    </div>
  </aside>
  <nav class="tabbar" aria-label="Menu admin">${NAV.map((g) => `<a class="${g === cur ? "on" : ""}" href="#${g.items[0][0]}">${esc(g.title)} ${dot(g)}</a>`).join("")}<button type="button" data-act="logout">Keluar</button></nav>`;
}
// Di HP menu cabang tampil sebagai deretan tombol bulat di atas halaman (sidebar hanya ada di layar lebar).
function subNav() {
  const r = route();
  if (r.name === "match" || r.name === "team") return "";
  const key = navKey(r), g = navGroup(key);
  return `<nav class="subnav" aria-label="${esc(g.title)}">${g.items.map(([k, l]) => `<a class="${k === key ? "on" : ""}" href="#${k}">${l}</a>`).join("")}</nav>`;
}

// --- Daftar pertandingan ---
function matchForm(m) {
  const k = m || {};
  return `<form data-form="match" ${m ? `data-id="${esc(m.id)}"` : ""}>
    <div class="grid2"><div><label>Fase</label><select name="stage">${stageOptions(k.stage)}</select></div>
      <div><label>Matchday</label><input type="number" name="matchday" min="1" value="${k.matchday ?? 1}"></div></div>
    <div class="grid2"><div><label>Tim A</label><select name="teamA">${teamOptions(k.teamA)}</select></div>
      <div><label>Tim B</label><select name="teamB">${teamOptions(k.teamB)}</select></div></div>
    <label>Tanggal &amp; jam (WIB)</label><input type="datetime-local" name="kickoff" value="${toLocalInput(k.kickoff)}">
    <div class="form-actions"><button class="btn orange" type="submit">${m ? "Simpan jadwal" : "Tambah pertandingan"}</button></div>
  </form>`;
}

function addMatchCard() {
  const tab = ui.tabs.addMatch || "manual";
  const body = tab === "paste"
    ? `<form data-form="import-matches">
      <p class="hint">Satu laga per baris, dipisah tanda <b>|</b>:<br><code>tanggal jam | grup atau fase | matchday | tim A | tim B</code><br>
      Contoh:<br><code>2026-11-09 19:00 | A | 1 | Tim A1 | Tim A2</code><br><code>2026-12-04 19:30 | final | 1 | | </code><br>
      Fase: huruf grup (A, B, …) atau <b>qf</b>, <b>sf</b>, <b>third</b>, <b>final</b>. Nama tim harus sama dengan yang sudah dibuat; untuk fase gugur tim boleh dikosongkan dulu.<br>Bila jam belum ditentukan, tulis <b>TBD</b> di kolom tanggal: <code>TBD | final | 5 | | </code>.</p>
      <textarea name="text" placeholder="2026-11-09 19:00 | A | 1 | Tim A1 | Tim A2"></textarea>
      <div class="form-actions"><button class="btn orange" type="submit">Impor jadwal</button></div></form>`
    : (state.teams.length ? matchForm(null) : `<p class="hint">Buat tim dulu lewat menu <a class="lnk" href="#team-add">Tambah tim</a>.</p>`);
  return `<div class="panel tabcard">${tabsNav("addMatch", [["manual", "Manual"], ["paste", "Tempel banyak"]], tab)}${body}</div>`;
}
function matchAddView() {
  return `<h1 class="page">Tambah pertandingan</h1>${addMatchCard()}`;
}

function matchesView() {
  const all = [...state.matches];
  const live = all.filter((m) => m.status === "live").sort(sortByKickoff);
  const sched = all.filter((m) => m.status === "scheduled").sort(sortByKickoff);
  const done = all.filter((m) => m.status === "ft").sort((a, b) => sortByKickoff(b, a));
  const row = (m) => {
    const miss = m.status === "scheduled" ? matchReadiness(m, state.players) : [];
    const sub = m.stage === "group" || !m.stage ? "Grup " + esc(m.group || "?") + ", matchday " + esc(m.matchday ?? 1) : STAGES[m.stage] || "";
    const flag = m.status === "scheduled" ? (miss.length ? `<span class="flag warn">Line up kurang</span>` : `<span class="flag ok">Siap dimulai</span>`) : m.status === "live" ? statusPill(m) : "";
    return `<a class="arow ${m.status === "live" ? "is-live" : ""}" href="#match/${esc(m.id)}">
      <div class="when">${m.kickoff ? dayShort(m.kickoff) : "–"}<b>${timeStr(m.kickoff)}</b></div>
      <div class="vs"><span>${esc(sideName(m, "A"))} ${m.status === "scheduled" ? "vs" : `<em>${m.scoreA ?? 0} – ${m.scoreB ?? 0}</em>`} ${esc(sideName(m, "B"))}</span><small>${sub}</small></div>
      <div class="rt">${flag}<span class="go">${m.status === "live" ? "Kontrol" : m.status === "ft" ? "Lihat" : "Kelola"}</span></div></a>`;
  };
  const sec = (title, list) => list.length ? `<h2 class="sect">${title} <span>${list.length}</span></h2><div class="panel list">${list.map(row).join("")}</div>` : "";
  const plan = planKnockout(state.teams, state.matches);
  const koCard = plan.length ? `<div class="panel ko-fill"><h2 class="a">Babak gugur siap diisi</h2>
    <p class="hint">Tim berikut sudah pasti dan bisa dimasukkan otomatis: <b>${plan.map((x) => esc(x.name)).join(", ")}</b>.</p>
    <div class="btns"><button class="btn orange" data-act="fill-ko">Isi pasangan otomatis</button></div></div>` : "";
  return `<h1 class="page">Pertandingan</h1>${koCard}
  ${sec("Sedang berlangsung", live)}${sec("Akan datang", sched)}${sec("Selesai", done)}
  ${all.length ? "" : `<div class="panel"><p class="empty">Belum ada pertandingan. Tambahkan lewat menu <a class="lnk" href="#match-add">Tambah pertandingan</a>.</p></div>`}`;
}

// Adu penalti: hanya untuk babak gugur yang skornya seri
function penForm(m) {
  if (!isKnockout(m) || m.status === "scheduled" || (m.scoreA ?? 0) !== (m.scoreB ?? 0)) return "";
  // selama babak biasa/ET masih berjalan, penalti belum relevan; muncul saat fase adu penalti, setelah FT, atau saat koreksi
  if (m.status === "live" && phaseOf(m) !== "pen" && !m.correcting) return "";
  return `<div class="panel warnbox"><h2 class="a">${phaseOf(m) === "pen" ? "Adu penalti: pilih pemenang" : "Skor seri, pilih pemenang adu penalti"}</h2><form data-form="pen" data-id="${esc(m.id)}">
    <p class="hint">Wajib dipilih sebelum laga bisa diakhiri. Gol adu penalti tidak dicatat sebagai gol, jadi tidak masuk top scorer dan skor tetap seri. Pemenang otomatis lanjut ke babak berikutnya.</p>
    <div class="grid2"><select name="pen"><option value="">— belum dipilih —</option><option value="A" ${m.penWinner === "A" ? "selected" : ""}>${esc(sideName(m, "A"))}</option><option value="B" ${m.penWinner === "B" ? "selected" : ""}>${esc(sideName(m, "B"))}</option></select>
    <button class="btn orange" type="submit">Simpan</button></div></form></div>`;
}

// ---------- Line up (draft di memori sampai disimpan) ----------
const luSig = (m) => JSON.stringify([m.lineupA || null, m.lineupB || null]);
const draftOf = (m) => {
  // dibangun ulang bila ganti laga, atau bila belum diubah tapi data tersimpan berubah (mis. baru disimpan)
  if (!ui.draft || ui.draft.id !== m.id || (!ui.draft.dirty && ui.draft.sig !== luSig(m))) {
    const mk = (side) => {
      const lu = m["lineup" + side] || {};
      const o = {};
      (lu.starters || []).forEach((id) => (o[id] = "S"));
      (lu.subs || []).forEach((id) => (o[id] = "B"));
      return o;
    };
    ui.draft = { id: m.id, A: mk("A"), B: mk("B"), dirty: false, sig: luSig(m) };
  }
  return ui.draft;
};
function draftProblems(m, d) {
  const out = [];
  for (const side of ["A", "B"]) {
    const teamId = side === "A" ? m.teamA : m.teamB;
    const list = playersOf(teamId);
    const st = list.filter((p) => d[side][p.id] === "S");
    const name = sideName(m, side);
    if (st.length !== FUTSAL_STARTERS) out.push(`${name}: inti ${st.length}/${FUTSAL_STARTERS}`);
    else if (!st.some((p) => p.isGK)) out.push(`${name}: belum ada kiper di susunan inti`);
  }
  return out;
}
function lineupEditor(m) {
  const d = draftOf(m);
  const col = (side) => {
    const teamId = side === "A" ? m.teamA : m.teamB;
    const list = playersOf(teamId);
    const st = list.filter((p) => d[side][p.id] === "S").length;
    const bn = list.filter((p) => d[side][p.id] === "B").length;
    return `<div class="lu-col"><div class="lu-title"><b>${esc(sideName(m, side))}</b><span class="${st === FUTSAL_STARTERS ? "okc" : "badc"}">Inti ${st}/${FUTSAL_STARTERS}</span><span class="muted">Cadangan ${bn}</span></div>
      <div class="tiles">${list.map((p) => {
        const v = d[side][p.id] || "";
        return `<button type="button" class="tile ${v === "S" ? "is-s" : v === "B" ? "is-b" : ""}" data-act="lu-toggle" data-id="${esc(p.id)}" data-side="${side}" aria-pressed="${v ? "true" : "false"}">
          <span class="no">${p.number ?? "–"}</span><span class="nm">${esc(p.name)}</span><span class="st">${p.isGK ? "GK · " : ""}${v === "S" ? "Inti" : v === "B" ? "Cadangan" : "Ketuk untuk pilih"}</span></button>`;
      }).join("") || `<p class="hint">Belum ada pemain di tim ini.</p>`}</div></div>`;
  };
  const probs = draftProblems(m, d);
  return `<p class="hint">Ketuk pemain: sekali = Inti, dua kali = Cadangan, tiga kali = batal. Inti harus 5 pemain dan ada kiper.</p>
    <div class="lu-cols">${col("A")}${col("B")}</div>
    ${probs.length ? `<p class="problems">${probs.map(esc).join(" · ")}</p>` : `<p class="okline">Susunan inti lengkap.</p>`}
    <div class="btns"><button class="btn orange" data-act="lu-save" data-id="${esc(m.id)}" ${d.dirty ? "" : "disabled"}>Simpan line up</button>
      ${d.dirty ? `<button class="btn ghost" data-act="lu-reset" data-id="${esc(m.id)}">Batalkan perubahan</button>` : ""}</div>`;
}

// ---------- POS: satu pertandingan ----------
const typeLabel = { goal: "Gol", penalty: "Gol penalti", own_goal: "Gol bunuh diri", yellow: "Kartu kuning", red: "Kartu merah" };
const evLabel = (e) => (e.type === "phase" ? e.note : e.type === "goal" && e.pen ? typeLabel.penalty : e.type === "red" && e.second ? "Kartu merah (kuning kedua)" : typeLabel[e.type] || e.type);
const evIcon = (e) => e.type === "goal" ? `<span class="evic">${ballSvg()}${e.pen ? '<i class="evtag">P</i>' : ""}</span>`
  : e.type === "own_goal" ? `<span class="evic">${ballSvg("og")}<i class="evtag og">OG</i></span>`
  : e.type === "yellow" ? `<span class="evic"><i class="card y"></i></span>` : e.type === "red" ? `<span class="evic"><i class="card r"></i></span>` : "";

function playerTile(m, side, p) {
  const evs = state.events.filter((e) => e.matchId === m.id && e.playerId === p.id);
  const g = evs.filter((e) => e.type === "goal").length, pen = evs.some((e) => e.type === "goal" && e.pen);
  const og = evs.filter((e) => e.type === "own_goal").length;
  const yc = evs.some((e) => e.type === "yellow"), rc = evs.some((e) => e.type === "red");
  const starter = (m["lineup" + side]?.starters || []).includes(p.id);
  const marks = `${g ? `<i class="mk g">${ballSvg()}${g > 1 ? `<b>${g}</b>` : ""}${pen ? '<b class="evtag">P</b>' : ""}</i>` : ""}${og ? `<i class="mk og">${ballSvg("og")}<b class="evtag og">OG</b></i>` : ""}${yc ? `<i class="mk y"></i>` : ""}${rc ? `<i class="mk r"></i>` : ""}`;
  return `<button type="button" class="ptile ${starter ? "" : "bench"} ${rc ? "out" : ""}" data-act="pick" data-side="${side}" data-id="${esc(p.id)}">
    <span class="no">${p.number ?? "–"}</span><span class="nm">${esc(p.name)}</span><span class="tg">${p.isGK ? "GK" : starter ? "" : "Cad."}</span><span class="marks">${marks}</span></button>`;
}

function sheetView(m) {
  const s = ui.sheet;
  if (!s || s.matchId !== m.id) return "";
  const p = state.playerById[s.playerId];
  if (!p) return "";
  const teamName = sideName(m, s.side);
  if (s.step === "assist") {
    const mates = lineupIds(m, s.side).filter((id) => id !== p.id).map((id) => state.playerById[id]).filter(Boolean).sort(byNumber);
    return `<div class="sheet-bg" data-act="close-sheet"></div><div class="sheet-box" role="dialog" aria-label="Pilih assist">
      <div class="sheet-head"><div><b>Gol ${esc(p.name)}</b><small>${esc(teamName)}, menit ${minuteNow(m)}</small></div><button class="x" data-act="close-sheet" aria-label="Tutup">Tutup</button></div>
      <p class="sheet-q">Siapa yang assist?</p>
      <div class="sheet-grid">${mates.map((a) => `<button class="opt" data-act="assist" data-pick="${esc(a.id)}"><b>${a.number ?? "–"}</b>${esc(a.name)}</button>`).join("")}
        <button class="opt none" data-act="assist" data-pick="">Tanpa assist</button></div></div>`;
  }
  return `<div class="sheet-bg" data-act="close-sheet"></div><div class="sheet-box" role="dialog" aria-label="Catat kejadian">
    <div class="sheet-head"><div><b>${p.number ?? "–"} · ${esc(p.name)}</b><small>${esc(teamName)}, menit ${minuteNow(m)}</small></div><button class="x" data-act="close-sheet" aria-label="Tutup">Tutup</button></div>
    <div class="sheet-grid acts">
      <button class="opt goal" data-act="ev" data-type="goal">${ballSvg("lg")} Gol</button>
      <button class="opt pen" data-act="ev" data-type="penalty">${ballSvg()} Gol penalti <i class="evtag">P</i></button>
      <button class="opt own" data-act="ev" data-type="own_goal">${ballSvg("og")} Gol bunuh diri <i class="evtag og">OG</i></button>
      <button class="opt yel" data-act="ev" data-type="yellow"><i class="card y"></i> Kartu kuning</button>
      <button class="opt red" data-act="ev" data-type="red"><i class="card r"></i> Kartu merah</button>
    </div></div>`;
}

function manageCard(m, allPlayers) {
  const id = m.id;
  const tabs = [];
  if (m.status !== "scheduled" && allPlayers.length) tabs.push(["motm", "Man of the Match"]);
  tabs.push(["jadwal", "Ubah jadwal &amp; tim"], ["koreksi", "Koreksi &amp; hapus"]);
  const cur = tabs.some((t) => t[0] === ui.tabs.matchMgmt) ? ui.tabs.matchMgmt : tabs[0][0];
  let body;
  if (cur === "motm") {
    body = `<form data-form="motm" data-id="${esc(id)}">
      <select name="motm" aria-label="Man of the Match"><option value="">— belum dipilih —</option>${allPlayers.map((p) => `<option value="${esc(p.id)}" ${m.motmId === p.id ? "selected" : ""}>${esc(p.name)} (${esc(tName(p.teamId))})</option>`).join("")}</select>
      <div class="form-actions"><button class="btn orange" type="submit">Simpan</button></div></form>`;
  } else if (cur === "jadwal") {
    body = matchForm(m);
  } else {
    body = `<form data-form="score" data-id="${esc(id)}"><p class="hint">Skor otomatis dari gol yang dicatat. Pakai ini hanya bila skor perlu dipaksa (misalnya menang WO). Koreksi tetap berlaku bila ada gol baru.</p>
      <div class="grid2"><div><label>Skor ${esc(sideName(m, "A"))}</label><input type="number" name="a" min="0" value="${m.scoreA ?? 0}"></div>
      <div><label>Skor ${esc(sideName(m, "B"))}</label><input type="number" name="b" min="0" value="${m.scoreB ?? 0}"></div></div>
      <div class="form-actions"><button class="btn ghost" type="submit">Simpan skor</button></div></form>
    <div class="btns"><button class="btn danger" data-act="del-match" data-id="${esc(id)}">Hapus pertandingan ini</button></div>`;
  }
  return `<div class="panel tabcard"><h2 class="a">Kelola laga</h2>${tabsNav("matchMgmt", tabs, cur)}${body}</div>`;
}

/** Tombol kontrol sesuai fase: satu tombol utama yang berubah + jeda darurat. */
function liveControls(m, miss) {
  const id = esc(m.id), p = phaseOf(m), c = m.clock || {};
  const playing = isPlayPhase(p), ready = isReadyToStart(m);
  const stopped = playing && !c.running && !ready && !m.correcting;
  const tied = (m.scoreA ?? 0) === (m.scoreB ?? 0);
  const out = [];
  if (ready) out.push(`<button class="btn go big" data-act="resume" data-id="${id}">Mulai ${PHASE_NAME[p]}</button>`);
  if (stopped) out.push(`<button class="btn go big" data-act="resume" data-id="${id}">Lanjutkan jam</button>`);
  if (!ready) {
    for (const a of phaseActions(m)) {
      const off = a.act === "finish" && (miss.length || (isKnockout(m) && tied && !m.penWinner));
      out.push(`<button class="btn ${a.kind} big" data-act="${a.act}" data-id="${id}" ${off ? "disabled" : ""}>${a.label}</button>`);
    }
  }
  if (playing && c.running && !m.correcting) out.push(`<button class="btn ghost" data-act="pause" data-id="${id}">Jeda darurat</button>`);
  return out.join("");
}
function phaseNote(m) {
  const p = phaseOf(m);
  if (m.correcting) return "Laga dibuka untuk koreksi. Perbaiki kejadian atau pemenang penalti, lalu tekan Selesai (FT).";
  if (isReadyToStart(m)) return "Menunggu peluit. Jam mulai saat tombol Mulai ditekan.";
  if (p === "ht" || p === "etb") return `${PHASE_NAME[p]}: hitung mundur hanya pengingat. Tekan tombol Mulai saat peluit babak berikutnya.`;
  if (p === "pen") return "Adu penalti: pilih pemenang di bawah. Gol adu penalti tidak dicatat sebagai gol.";
  if (m.pause) return `Jam berhenti (${m.pause.label}) dan tampil di layar penonton. Tekan Lanjutkan jam saat laga bermain lagi.`;
  const tieKo = isKnockout(m) && (m.scoreA ?? 0) === (m.scoreB ?? 0) && (p === "h2");
  return "Jam berjalan otomatis dan menit kejadian terisi sendiri. Di akhir babak jam tidak berhenti paksa (tampil +1', +2'); tekan tombol Akhiri saat wasit meniup peluit." + (tieKo ? " Skor seri di babak gugur: pilih perpanjangan waktu atau langsung adu penalti." : "");
}

function matchAdminView(id) {
  const m = state.matchById[id];
  if (!m) return `<a class="back" href="#matches">← Daftar laga</a><div class="panel"><p class="empty">Laga tidak ditemukan.</p></div>`;
  const evs = state.events.filter((e) => e.matchId === id).sort((a, b) => eventCmp(b, a));
  const p = phaseOf(m);
  const miss = matchReadiness(m, state.players);
  const sub = m.stage === "group" || !m.stage ? "Grup " + esc(m.group || "?") + ", matchday " + esc(m.matchday ?? 1) : STAGES[m.stage];
  const when = m.kickoff ? dayShort(m.kickoff) + ", " + timeStr(m.kickoff) : "Waktu akan ditentukan";

  // papan skor + tombol jam
  let ctrl = "";
  if (m.status === "scheduled") ctrl = `<button class="btn go big" data-act="start" data-id="${esc(id)}" ${miss.length ? "disabled" : ""}>Mulai laga</button>`;
  if (m.status === "live") ctrl = liveControls(m, miss);
  if (m.status === "ft") ctrl = `<button class="btn ghost big" data-act="reopen" data-id="${esc(id)}">Buka kembali untuk koreksi</button>`;

  const board = `<div class="board ${m.status === "live" ? "is-live" : ""}">
    <div class="b-meta"><span>${sub} · ${when}</span>${statusPill(m)}</div>
    <div class="b-row"><div class="b-team">${esc(sideName(m, "A"))}</div><div class="b-score">${m.scoreA ?? 0}<i>–</i>${m.scoreB ?? 0}</div><div class="b-team r">${esc(sideName(m, "B"))}</div></div>
    ${m.status === "live" ? `<div class="b-phase">${esc(PHASE_NAME[p] || "")}</div><div class="b-clock" data-clockbig="${esc(id)}">${clockText(m)}</div>` : ""}
    ${m.status === "ft" ? `<div class="b-phase">${ftText(m)}</div>` : ""}
    ${m.status === "live" && isPlayPhase(p) && !m.correcting ? `<div class="b-added"><span>Tambahan waktu (pengingat di layar)</span>
      <button type="button" class="btn ghost sm" data-act="added-dec" data-id="${esc(id)}" aria-label="Kurangi tambahan waktu">−</button><b>+${m.addedMin || 0}'</b>
      <button type="button" class="btn ghost sm" data-act="added-inc" data-id="${esc(id)}" aria-label="Tambah tambahan waktu">+</button></div>` : ""}
    <div class="b-ctrl">${ctrl}</div>
    ${m.status === "live" ? `<p class="b-note">${esc(phaseNote(m))}</p>` : ""}
  </div>`;

  // syarat mulai
  const readiness = m.status === "scheduled" ? `<div class="panel ${miss.length ? "warnbox" : "okbox"}"><h2 class="a">${miss.length ? "Belum bisa dimulai" : "Siap dimulai"}</h2>
      ${miss.length ? `<ul class="need">${miss.map((x) => `<li>${esc(x)}</li>`).join("")}</ul><p class="hint">Isi line up di bawah, lalu tombol Mulai laga aktif.</p>` : `<p class="hint">Kedua line up sudah lengkap. Tekan Mulai laga saat peluit pertama.</p>`}</div>`
    : (m.status === "live" && miss.length) ? `<div class="panel warnbox"><h2 class="a">Line up belum lengkap</h2><ul class="need">${miss.map((x) => `<li>${esc(x)}</li>`).join("")}</ul><p class="hint">Laga ini dimulai sebelum aturan line up. Lengkapi dulu di bawah agar bisa diakhiri.</p></div>` : "";

  // papan pemain (POS)
  let pos = "";
  if (m.status === "live") {
    const grid = (side) => {
      const ids = lineupIds(m, side);
      const list = ids.map((x) => state.playerById[x]).filter(Boolean).sort((a, b) => {
        const sa = (m["lineup" + side].starters || []).includes(a.id) ? 0 : 1, sb = (m["lineup" + side].starters || []).includes(b.id) ? 0 : 1;
        return sa - sb || byNumber(a, b);
      });
      return `<section class="pcol ${ui.side === side ? "show" : ""}" data-side="${side}"><h3>${esc(sideName(m, side))}</h3><div class="pgrid">${list.map((p) => playerTile(m, side, p)).join("") || `<p class="hint">Line up kosong.</p>`}</div></section>`;
    };
    pos = `<div class="panel"><h2 class="a">Catat kejadian</h2><p class="hint">Ketuk pemain, pilih kejadian. Menit mengikuti jam laga.</p>
      <div class="seg" role="tablist"><button type="button" class="${ui.side === "A" ? "on" : ""}" data-act="side" data-side="A">${esc(sideName(m, "A"))}</button><button type="button" class="${ui.side === "B" ? "on" : ""}" data-act="side" data-side="B">${esc(sideName(m, "B"))}</button></div>
      <div class="pcols">${grid("A")}${grid("B")}</div></div>`;
  }

  const evList = evs.length ? evs.map((e, i) => e.type === "phase"
    ? `<div class="aev note"><b>${eventMinute(e)}</b><span class="evic"><i class="dotc"></i></span><span class="muted">${esc(e.note)}</span><span></span></div>`
    : `<div class="aev ${i === 0 && m.status === "live" ? "latest" : ""}"><b>${eventMinute(e)}</b>${evIcon(e)}
      <span>${evLabel(e)} · ${esc(pName(e.playerId))} <span class="muted">(${esc(tName(e.teamId))})</span>${e.assistId ? `<br><span class="muted small">Assist: ${esc(pName(e.assistId))}</span>` : ""}</span>
      ${m.status === "live" ? `<button class="btn sm danger mini" data-act="del-event" data-id="${esc(e.id)}">Batalkan</button>` : ""}</div>`).join("") : `<p class="hint">${m.status === "scheduled" ? "Kejadian muncul di sini setelah laga dimulai." : "Belum ada kejadian."}</p>`;

  const allPlayers = [...lineupIds(m, "A"), ...lineupIds(m, "B")].map((x) => state.playerById[x]).filter(Boolean);

  return `<a class="back" href="#matches">← Daftar laga</a>${board}${readiness}${penForm(m)}${pos}
  <div class="panel"><h2 class="a">Riwayat kejadian <span class="cntb">${evs.filter((e) => e.type !== "phase").length}</span></h2>${evList}${m.status === "live" ? `<p class="hint">Salah catat? Batalkan, skor ikut menyesuaikan.</p>` : ""}</div>
  <details class="panel fold" ${m.status === "scheduled" || miss.length ? "open" : ""}><summary>Line up ${miss.length ? '<span class="flag warn">perlu diisi</span>' : '<span class="flag ok">lengkap</span>'}</summary>${lineupEditor(m)}</details>
  ${manageCard(m, allPlayers)}
  ${sheetView(m)}`;
}

// --- Impor dari Excel / CSV ---
function importBody() {
  const st = importState;
  let preview = "";
  if (st) {
    const p = st.plan;
    const list = (arr, cls) => arr.length ? `<ul class="imp-list ${cls}">${arr.slice(0, 25).map((x) => `<li>${esc(x)}</li>`).join("")}${arr.length > 25 ? `<li>…dan ${arr.length - 25} lainnya</li>` : ""}</ul>` : "";
    const rows = p.teams.map((t) => `<details class="imp-team"><summary><span class="nm">${esc(t.name)}</span><span class="chip">${t.existing ? "Diperbarui" : "Baru"}</span><span class="chip">Grup ${esc(t.group || t.existing?.group || "–")}</span><span class="cnt">${t.players.length} pemain · ${t.officials.length} official</span></summary>
      <div class="imp-body">${[...t.players].sort((a, b) => (a.number ?? 999) - (b.number ?? 999)).map((x) => `<div class="imp-pl"><b>${x.number ?? "?"}</b><span>${esc(x.name)}</span>${x.isGK ? '<span class="badge-gk">GK</span>' : ""}</div>`).join("")}
      ${t.officials.map((x) => `<div class="imp-pl"><b>–</b><span>${esc(x.name)}</span><span class="chip">Official</span></div>`).join("")}</div></details>`).join("");
    preview = `<div class="imp-sum"><b>${esc(st.fileName)}</b>: ${p.totals.teams} tim, ${p.totals.players} pemain, ${p.totals.officials} official</div>
      ${p.errors.length ? `<div class="imp-box err"><b>${p.errors.length} masalah harus diperbaiki di file, lalu pilih ulang file:</b>${list(p.errors, "e")}</div>` : ""}
      ${p.warnings.length ? `<div class="imp-box warn"><b>Perhatian (tidak menghalangi impor):</b>${list(p.warnings, "w")}</div>` : ""}
      ${rows}
      <label class="check"><input type="checkbox" data-import-replace ${st.replace ? "checked" : ""}> Ganti total: hapus pemain/official lama di tim yang ada di file bila tidak tercantum di file</label>
      <div class="btns"><button class="btn orange" data-act="apply-import" ${p.errors.length || !p.teams.length ? "disabled" : ""}>Impor ${p.totals.teams} tim &amp; ${p.totals.players + p.totals.officials} orang</button>
      <button class="btn ghost" data-act="clear-import">Batal</button></div>`;
  }
  return `<p class="hint">Satu baris = satu orang. Kolom: <b>Tim, Grup, Peran, No, Nama</b>. Peran: <b>Pemain</b>, <b>Kiper</b>, atau <b>Official</b>. No punggung wajib untuk pemain dan kiper, 0–99, tidak boleh kembar dalam satu tim.
    Impor aman diulang: tim dicocokkan lewat nama, pemain lewat no punggung.</p>
    <p class="hint">Unduh contoh: <a href="../templates/template-tim-pemain.xlsx" download>Excel (.xlsx)</a> · <a href="../templates/template-tim-pemain.csv" download>CSV</a>.
    Jangan menaruh NIK atau nomor telepon di file; kolom di luar daftar di atas diabaikan dan tidak disimpan karena data website bersifat publik.</p>
    <label for="impfile">Pilih file .xlsx atau .csv</label>
    <input id="impfile" type="file" accept=".xlsx,.xlsm,.csv,.tsv,.txt" data-import-file>
    ${preview}`;
}

// --- Tim & pemain ---
const playerRow = (p) => `<div class="player-line"><b>${p.number ?? ""}</b><span>${esc(p.name)} ${p.isGK ? '<span class="badge-gk">GK</span>' : ""}</span>
  <button class="btn sm ghost mini" data-act="edit-player" data-id="${esc(p.id)}">Ubah</button><button class="btn sm danger mini" data-act="del-player" data-id="${esc(p.id)}">Hapus</button></div>`;

// Daftar tim: kotak per grup, sama seperti halaman "Tim peserta" di website. Ketuk tim untuk membuka dan mengubahnya.
function teamsView() {
  const byGroup = {};
  for (const t of state.teams) (byGroup[t.group || ""] ||= []).push(t);
  const keys = Object.keys(byGroup).sort((a, b) => (a === "") - (b === "") || a.localeCompare(b));
  const head = `<h1 class="page">Tim peserta <span class="cntb">${state.teams.length}</span></h1>${state.teams.length ? `` : ""}`;
  if (!keys.length) return `${head}<div class="panel"><p class="empty">Belum ada tim. Tambahkan lewat menu <a class="lnk" href="#team-add">Tambah tim</a>.</p></div>`;
  let i = 0;
  return `${head}<div class="tgroups">${keys.map((g) => `<section class="tgroup"><h2 class="gtitle">${g ? "Grup " + esc(g) : "Tanpa grup"}</h2>
    ${byGroup[g].sort((a, b) => a.name.localeCompare(b.name, "id")).map((t) => `<a class="tcard" style="--i:${i++}" href="#team/${esc(t.id)}">${badge(t)}<span class="tc-t"><b>${esc(t.name)}</b><small>${playersOf(t.id).length} pemain</small></span></a>`).join("")}</section>`).join("")}</div>`;
}

// Satu tim: info, logo, pemain, official.
function teamView(id) {
  const t = state.teamById[id];
  if (!t) return `<a class="back" href="#teams">← Daftar tim</a><div class="panel"><p class="empty">Tim tidak ditemukan. Mungkin sudah dihapus.</p></div>`;
  const roster = playersOf(t.id), offs = officialsOf(t.id);
  return `<a class="back" href="#teams">← Daftar tim</a>
    <div class="team-hero">${badge(t, "lg")}<div><h1 class="page">${esc(t.name)}</h1>
      <div class="meta"><span class="chip">${t.group ? "Grup " + esc(t.group) : "Tanpa grup"}</span><span>${roster.length} pemain · ${offs.length} official</span></div></div></div>
    <div class="panel"><h2 class="a">Info tim</h2>
      <form data-form="team" data-id="${esc(t.id)}" class="grid3" style="align-items:end"><div style="grid-column:span 2"><label>Nama tim</label><input type="text" name="name" value="${esc(t.name)}" required></div>
        <div><label>Grup</label><input type="text" name="group" value="${esc(t.group || "")}" maxlength="2"></div>
        <div style="grid-column:1 / -1"><button class="btn orange" type="submit">Simpan info tim</button></div></form></div>
    <div class="panel"><h2 class="a">Logo tim</h2>
      <div class="logo-edit">${badge(t, "lg")}
        <div><input type="file" accept="image/*" data-logo="${esc(t.id)}">${t.logoUrl ? `<button class="btn sm danger mini" style="margin-top:8px" data-act="del-logo" data-id="${esc(t.id)}">Hapus logo</button>` : ""}</div></div>
      <p class="hint">Pilih gambar logo (PNG/JPG/SVG). Otomatis dikecilkan (maks. 256 px) dan langsung tampil di website. Latar transparan lebih bagus.</p>
      <details class="fold"><summary>Pilih dari pustaka logo klub (${LOGO_LIBRARY.length})</summary>
        <div class="logo-lib">${LOGO_LIBRARY.map((l) => `<button type="button" class="logo-pick${t.logoUrl === logoPath(l.file) ? " on" : ""}" data-act="pick-logo" data-id="${esc(t.id)}" data-file="${esc(l.file)}" title="${esc(l.name)}"><img src="${esc(logoPath(l.file))}" alt="${esc(l.name)}" loading="lazy"><span>${esc(l.name)}</span></button>`).join("")}</div></details></div>
    <div class="panel"><h2 class="a">Pemain <span class="cntb">${roster.length}/${LIMITS.players}</span></h2>
      ${roster.map(playerRow).join("") || `<p class="hint">Belum ada pemain.</p>`}
      <form data-form="player" data-id="${esc(t.id)}" class="addform"><h3 class="a">Tambah pemain</h3><div class="grid3" style="align-items:end"><div><label>No.</label><input type="number" name="number" min="0" max="99"></div>
        <div style="grid-column:span 2"><label>Nama pemain</label><input type="text" name="name" required></div></div>
        <label class="check"><input type="checkbox" name="gk"> Kiper (GK)</label>
        <div class="form-actions"><button class="btn orange" type="submit">Tambah pemain</button></div></form>
      <details class="fold"><summary>Tempel banyak pemain</summary><form data-form="bulk-players" data-id="${esc(t.id)}">
        <p class="hint">Satu pemain per baris: <code>nomor, nama, gk</code> (kata <b>gk</b> hanya untuk kiper).<br><code>1, Dedi, gk</code><br><code>7, Andi</code></p>
        <textarea name="text"></textarea><div class="form-actions"><button class="btn orange" type="submit">Tambahkan semua</button></div></form></details></div>
    <div class="panel"><h2 class="a">Official <span class="cntb">${offs.length}/${LIMITS.officials}</span></h2>
      ${offs.map((o) => `<div class="player-line"><b>–</b><span>${esc(o.name)}</span><span></span><button class="btn sm danger mini" data-act="del-player" data-id="${esc(o.id)}">Hapus</button></div>`).join("") || `<p class="hint">Belum ada official.</p>`}
      ${offs.length < LIMITS.officials ? `<form data-form="official" data-id="${esc(t.id)}" class="addform"><h3 class="a">Tambah official</h3>
        <label>Nama official</label><input type="text" name="name" required maxlength="60" placeholder="mis. Budi Santoso">
        <div class="form-actions"><button class="btn orange" type="submit">Tambah official</button></div></form>` : `<p class="hint">Jumlah official sudah maksimal (${LIMITS.officials}). Hapus salah satu untuk menambah yang baru.</p>`}</div>
    <div class="panel dz"><h2 class="a">Hapus tim</h2><p class="hint">Tim beserta semua pemainnya dihapus dan tidak bisa dikembalikan.</p>
      <div class="btns"><button class="btn danger" data-act="del-team" data-id="${esc(t.id)}">Hapus tim ini</button></div></div>`;
}

function addTeamCard() {
  const tab = ui.tabs.addTeam || (state.teams.length ? "manual" : "impor");
  let body;
  if (tab === "impor") body = importBody();
  else if (tab === "tempel") body = `<form data-form="bulk-teams">
      <p class="hint">Satu tim per baris: <code>nama tim | grup</code><br><code>Tim A1 | A</code><br><code>Tim A2 | A</code></p>
      <textarea name="text"></textarea><div class="form-actions"><button class="btn orange" type="submit">Tambahkan semua</button></div></form>`;
  else body = `<form data-form="new-team" class="grid3" style="align-items:end"><div style="grid-column:span 2"><label>Nama tim</label><input type="text" name="name" required></div>
        <div><label>Grup</label><input type="text" name="group" maxlength="2" placeholder="A"></div>
        <div style="grid-column:span 3"><button class="btn orange" type="submit">Tambah tim</button></div></form>`;
  return `<div class="panel tabcard">${tabsNav("addTeam", [["impor", "Impor Excel / CSV"], ["tempel", "Tempel"], ["manual", "Manual"]], tab)}${body}</div>`;
}
function teamAddView() {
  return `<h1 class="page">Tambah tim</h1>${addTeamCard()}`;
}

// --- Pengaturan: satu halaman per topik ---
function announceView() {
  const a = state.settings.announcement || {};
  return `<h1 class="page">Pengumuman beranda</h1>
    <div class="panel"><form data-form="announce">
      <label class="check"><input type="checkbox" name="active" ${a.active ? "checked" : ""}> Tampilkan pengumuman di beranda</label>
      <label>Judul</label><input type="text" name="title" value="${esc(a.title || "")}">
      <label>Isi</label><textarea name="body" style="font-family:inherit;font-size:15px;min-height:110px">${esc(a.body || "")}</textarea>
      <div class="form-actions"><button class="btn orange" type="submit">Simpan pengumuman</button></div></form></div>`;
}
function timingView() {
  const t = timingOf(state.settings), g1 = t.groupHalves === 1;
  const num = (name, label, v, lo, hi) => `<div><label for="tm-${name}">${label}</label><input id="tm-${name}" type="number" name="${name}" min="${lo}" max="${hi}" step="1" value="${v}" inputmode="numeric"></div>`;
  return `<h1 class="page">Durasi pertandingan</h1><div class="panel"><form data-form="timing">
    <p class="hint" style="margin-top:0">Jam hitung maju dan mulai dari 0 di tiap babak. Nilai ini dibekukan saat laga dimulai, jadi mengubahnya tidak mengganggu laga yang sedang berjalan.</p>
    <div class="grid2"><div><label for="tm-groupHalves">Babak grup dimainkan</label><select id="tm-groupHalves" name="groupHalves"><option value="2" ${g1 ? "" : "selected"}>2 babak + istirahat</option><option value="1" ${g1 ? "selected" : ""}>1 babak non-stop</option></select></div>
      ${num("groupHalf", "Grup: menit per babak", t.groupHalf, 1, 45)}</div>
    <p class="hint">Bila 1 babak non-stop, isi durasi totalnya (mis. 20). Contoh bawaan: 2 × 10 menit.</p>
    <div class="grid2">${num("koHalf", "Babak gugur: menit per babak", t.koHalf, 1, 45)}${num("etHalf", "Perpanjangan waktu: menit per babak", t.etHalf, 1, 15)}</div>
    <div class="grid2">${num("breakMin", "Istirahat antar babak (menit)", t.breakMin, 0, 20)}${num("etBreakMin", "Istirahat ET1 ke ET2 (menit)", t.etBreakMin, 0, 10)}</div>
    <p class="hint">Aturan futsal (FIFA): 2 × 20 menit, istirahat maksimal 15 menit, perpanjangan 2 × 5 menit, lalu adu penalti. Durasi di sini mengikuti keputusan panitia IFL.</p>
    <div class="form-actions"><button class="btn orange" type="submit">Simpan durasi</button></div></form></div>`;
}
// Kiper terbaik: kartu urut dari nilai terbaik. Ketuk kartu = panitia memilih kiper itu.
function keeperView() {
  const s = state.settings;
  const stats = computeKeeperStats(state.players, state.matches, state.teams, state.events);
  const seen = new Set(stats.map((k) => k.id));
  const idle = state.players.filter((p) => p.isGK && !isOfficial(p) && !seen.has(p.id))
    .sort((a, b) => tName(a.teamId).localeCompare(tName(b.teamId), "id") || byNumber(a, b))
    .map((p) => ({ ...p, played: 0, cleanSheets: 0, conceded: 0, avg: 0, goals: 0, assists: 0, progress: teamProgress(p.teamId, state.teams, state.matches) }));
  const list = [...stats, ...idle];
  const best = s.bestGkId ? state.playerById[s.bestGkId] : null;
  const head = `<h1 class="page">Kiper terbaik</h1>`;
  if (!list.length) return `${head}<div class="panel"><p class="empty">Belum ada kiper. Tandai pemain sebagai kiper (GK) di menu Tim &amp; Pemain.</p></div>`;
  const cards = list.map((k, i) => {
    const sel = s.bestGkId === k.id, played = k.played > 0;
    return `<button type="button" class="kcard ${sel ? "is-sel" : ""}" style="--i:${i}" data-act="pick-gk" data-id="${esc(k.id)}" aria-pressed="${sel}">
      ${played ? `<span class="kc-rank">#${i + 1}</span>` : ""}
      <span class="kc-top">${badge(state.teamById[k.teamId])}<span class="kc-name"><b>${esc(k.name)}</b><small>${esc(tName(k.teamId))}</small></span></span>
      <span class="kc-stats"><span><b>${k.played}</b><small>Main</small></span><span><b>${k.cleanSheets}</b><small>Clean sheet</small></span><span><b>${k.conceded}</b><small>Kebobolan</small></span>
        <span><b>${played ? k.avg.toFixed(1) : "–"}</b><small>Rata²</small></span><span><b>${k.goals}</b><small>Gol</small></span><span><b>${k.assists}</b><small>Assist</small></span></span>
      <span class="kc-prog ${k.progress.out ? "badc" : ""}">${esc(k.progress.label)}</span>
      ${sel ? `<span class="kc-flag">Kiper terbaik</span>` : ""}</button>`;
  }).join("");
  return `${head}
    <p class="lead">Dipilih oleh panitia, tidak otomatis. Ketuk kartu untuk menjadikan kiper itu <b>Kiper terbaik</b>, ketuk lagi untuk membatalkan. Urutan dari nilai terbaik: clean sheet terbanyak, lalu rata-rata kebobolan paling kecil.</p>
    <div class="pick-now ${best ? "has" : ""}">${best ? `Terpilih: <b>${esc(best.name)}</b> · ${esc(tName(best.teamId))}` : "Belum ada kiper terbaik yang dipilih."}</div>
    <div class="kgrid">${cards}</div>
    <p class="hint">Clean sheet = lawan 0 gol (termasuk perpanjangan waktu). Dihitung dari kiper di susunan inti laga yang sudah FT; gol adu penalti tidak dihitung.</p>`;
}

// Hapus data: bersihkan semua pertandingan atau semua tim sekaligus
function resetView() {
  const nM = state.matches.length, nE = state.events.length, nT = state.teams.length, nP = state.players.length;
  return `<h1 class="page">Hapus data</h1>
    <p class="lead">Dipakai untuk mengosongkan data contoh atau mengulang dari awal. Yang sudah dihapus tidak bisa dikembalikan.</p>
    <div class="panel dz"><h2 class="a">Hapus semua pertandingan</h2>
      <p class="hint">${nM ? `Akan menghapus <b>${nM}</b> pertandingan beserta <b>${nE}</b> kejadian (gol, kartu, dan lainnya). Tim dan pemain tidak ikut terhapus.` : "Belum ada pertandingan."}</p>
      <div class="btns"><button class="btn danger" data-act="wipe-matches" ${nM ? "" : "disabled"}>Hapus semua pertandingan</button></div></div>
    <div class="panel dz"><h2 class="a">Hapus semua tim</h2>
      <p class="hint">${nT ? `Akan menghapus <b>${nT}</b> tim beserta <b>${nP}</b> pemain dan official, termasuk pilihan kiper terbaik.${nM ? ` Masih ada <b>${nM}</b> pertandingan yang memakai tim, jadi hapus semua pertandingan dulu.` : ""}` : "Belum ada tim."}</p>
      <div class="btns"><button class="btn danger" data-act="wipe-teams" ${nT ? "" : "disabled"}>Hapus semua tim</button></div></div>`;
}

// ---------- Render ----------
let pending = false;
let lastBar = "", lastKey = "", enterTimer;
// Skeleton shimmer: saat data belum siap dan sekilas tiap pindah halaman
const SKEL_KIND = { matches: "list", "match-add": "form", teams: "grid", team: "form", "team-add": "form", settings: "form", "set-announce": "form", "set-timing": "form", "set-keeper": "cards", "set-reset": "form", match: "pos" };
let skelOn = false, skelTimer;
function startSkeleton() { skelOn = true; clearTimeout(skelTimer); skelTimer = setTimeout(() => { skelOn = false; render(); }, 350); }
function showSkel(r) {
  const kind = SKEL_KIND[r.name] || "list", k = kind + "|" + r.name;
  if ($app.dataset.skel === k) return;
  $app.dataset.skel = k;
  $app.innerHTML = (r.name === "match" || r.name === "team" ? "" : subNav()) + skeleton(kind);
}
// Menu samping hanya digambar ulang bila isinya berubah, supaya animasinya tidak terulang tiap data masuk.
function setBar(h) { if (h !== lastBar) { $bar.innerHTML = h; lastBar = h; } }
function render() {
  document.body.classList.toggle("has-side", !!user);
  if (user === undefined) { setBar(""); showSkel({ name: "matches" }); return; }
  if (!user) { setBar(""); delete $app.dataset.skel; $app.innerHTML = loginView(); return; }
  setBar(topBar());
  if (isReady()) {
    const b = computeBracket(state.teams, state.matches);
    slotByMatch = new Map([...b.qf, ...b.sf, b.final, ...(b.third ? [b.third] : [])].filter((x) => x.match).map((x) => [x.match.id, x]));
  }
  const r = route();
  if (!isReady()) {
    if (state.error) { delete $app.dataset.skel; $app.innerHTML = `<div class="error-box">Data gagal dimuat: ${esc(state.error.code || state.error.message)}</div>`; }
    else showSkel(r);
    return;
  }
  if (skelOn) { showSkel(r); return; }
  delete $app.dataset.skel;
  const open = [...$app.querySelectorAll("details[open]")].map((d) => d.querySelector("summary")?.textContent);
  let h;
  if (r.name === "match") h = matchAdminView(r.id);
  else if (r.name === "match-add") h = matchAddView();
  else if (r.name === "team") h = teamView(r.id);
  else if (r.name === "team-add") h = teamAddView();
  else if (r.name === "teams") h = teamsView();
  else if (r.name === "set-timing") h = timingView();
  else if (r.name === "set-keeper") h = keeperView();
  else if (r.name === "set-reset") h = resetView();
  else if (r.name === "set-announce" || r.name === "settings") h = announceView();
  else h = matchesView();
  $app.innerHTML = subNav() + h;
  // tombol cabang di HP: tampilkan yang aktif di tengah
  const sn = $app.querySelector(".subnav"), on = sn?.querySelector("a.on");
  if (sn && on) sn.scrollLeft = on.offsetLeft - (sn.clientWidth - on.offsetWidth) / 2;
  // animasi masuk hanya saat pindah halaman
  const key = r.name + "/" + (r.id || "");
  if (key !== lastKey) {
    lastKey = key;
    $app.classList.remove("enter"); void $app.offsetWidth; $app.classList.add("enter");
    clearTimeout(enterTimer); enterTimer = setTimeout(() => $app.classList.remove("enter"), 1200);
  }
  // pertahankan lipatan yang sedang terbuka
  $app.querySelectorAll("details").forEach((d) => { if (open.includes(d.querySelector("summary")?.textContent)) d.open = true; });
  pending = false;
}
function safeRender() {
  const a = document.activeElement;
  if (a && $app.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.type !== "checkbox") { pending = true; return; }
  render();
}
setInterval(() => {
  if (!pending) return;
  const a = document.activeElement;
  if (a && $app.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
  render();
}, 2000);

// ---------- Aksi ----------
const curMatch = () => state.matchById[route().id];

/** Catat satu kejadian dan hitung ulang skor dari seluruh kejadian (bukan increment), supaya skor tidak bisa menyimpang. */
async function recordEvent(m, side, playerId, type, assistId, opts = {}) {
  if (m.status !== "live") throw new Error("Laga tidak sedang LIVE.");
  const teamId = side === "A" ? m.teamA : m.teamB;
  if (!teamId) throw new Error("Tim belum ditentukan untuk laga ini.");
  if (!lineupIds(m, side).includes(playerId)) throw new Error("Pemain ini tidak ada di line up.");
  if (assistId && (assistId === playerId || !lineupIds(m, side).includes(assistId))) throw new Error("Assist tidak valid.");
  const ph = phaseOf(m), isGoal = type === "goal" || type === "own_goal";
  if (ph === "pen") throw new Error("Sedang adu penalti: gol dan kartu tidak dicatat di sini. Pilih pemenang penalti, lalu Selesai (FT).");
  if ((ph === "ht" || ph === "etb") && isGoal) throw new Error("Sedang istirahat: gol tidak bisa dicatat. Mulai babak berikutnya dulu.");
  // Aturan futsal: kuning kedua = merah; pemain yang sudah merah tidak bisa dikartu lagi
  const mine = state.events.filter((e) => e.matchId === m.id && e.playerId === playerId);
  let secondYellow = false;
  if (type === "yellow" || type === "red") {
    if (mine.some((e) => e.type === "red")) throw new Error(`${pName(playerId)} sudah dikeluarkan (kartu merah). Batalkan kartu merahnya dulu bila salah catat.`);
    if (type === "yellow" && mine.some((e) => e.type === "yellow")) {
      if (!(await confirmBox(`${pName(playerId)} sudah punya satu kartu kuning. Kartu kuning kedua otomatis menjadi kartu merah (pemain dikeluarkan).`, { title: "Kartu kuning kedua", ok: "Ya, catat kuning + merah" }))) return;
      secondYellow = true;
    }
  }
  const st = stampNow(m);
  const ref = doc(collection(db, "events"));
  const ev = { matchId: m.id, type, teamId, playerId, assistId: type === "goal" && assistId ? assistId : null, minute: st.minute, extra: st.extra, sec: st.sec, p: st.p, ps: st.ps, ts: nowMs() };
  if (type === "goal" && opts.pen) ev.pen = true;
  const [a, b] = finalScore(m, [...state.events.filter((e) => e.matchId === m.id), { ...ev, id: ref.id }]);
  const patch = { scoreA: a, scoreB: b };
  if (a !== b && m.penWinner) patch.penWinner = null;
  const batch = writeBatch(db);
  batch.set(ref, ev);
  if (secondYellow) batch.set(doc(collection(db, "events")), { ...ev, type: "red", second: true, ts: nowMs() + 1 });
  if (isGoal) batch.update(matchRef(m.id), patch);
  await batch.commit();
  toast(`${secondYellow ? "Kuning kedua + merah" : typeLabel[opts.pen ? "penalty" : type]} · ${pName(playerId)} ${eventMinute(ev)}`);
}

// ---------- Fase laga ----------
const runClock = (base = 0) => ({ running: true, baseSec: base, startedAt: nowMs() });
const stopClock = (base = 0) => ({ running: false, baseSec: base, startedAt: null });
const limitText = (m, ph) => { const s = periodLimitSec(m, ph); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };
/** Catatan fase yang tampil di jalannya laga (bukan gol/kartu, jadi tidak memengaruhi skor atau statistik). */
const mkNote = (m, note, st) => ({ matchId: m.id, type: "phase", teamId: null, playerId: null, assistId: null, note, minute: st.minute, extra: st.extra, sec: st.sec, p: st.p, ps: st.ps, ts: nowMs() });
/** Pindah fase: jam fase baru dimulai dari 0, jeda dan tambahan waktu direset, catatan fase ikut tersimpan. */
async function goPhase(m, phase, { notes = [], clock, extra = {} }) {
  const b = writeBatch(db);
  notes.forEach((n) => b.set(doc(collection(db, "events")), n));
  b.update(matchRef(m.id), { phase, clock, pause: null, addedMin: 0, ...extra });
  await b.commit();
}
async function confirmEarly(m, what) {
  const ph = phaseOf(m);
  if (!isPlayPhase(ph) || elapsedSec(m) >= periodLimitSec(m, ph)) return true;
  return confirmBox(`${what[0].toUpperCase() + what.slice(1)} baru berjalan ${clockText(m)} dari ${limitText(m, ph)}. Akhiri sekarang?`, { title: "Waktu belum habis", ok: "Ya, akhiri" });
}
async function setAdded(id, d) {
  const m = state.matchById[id];
  await updateDoc(matchRef(id), { addedMin: Math.max(0, Math.min(10, (m.addedMin || 0) + d)) });
}

const actions = {
  async logout() { await signOut(auth); },
  async start(id) {
    const m = state.matchById[id];
    const miss = matchReadiness(m, state.players);
    if (miss.length) throw new Error("Belum bisa mulai: " + miss.join("; ") + ".");
    // durasi dibekukan sekarang: mengubah Pengaturan nanti tidak mengacaukan laga ini
    await updateDoc(matchRef(id), {
      status: "live", phase: "h1", cfg: cfgFor(m, timingOf(state.settings)), clock: runClock(), pause: null, addedMin: 0,
      correcting: false, etPlayed: false, timeouts: {}, penWinner: null,
    });
  },
  async "end-h1"(id) {
    const m = state.matchById[id];
    if (!(await confirmEarly(m, "babak 1"))) return;
    await goPhase(m, "ht", { notes: [mkNote(m, "Akhir babak 1 · Istirahat", stampNow(m))], clock: runClock() });
  },
  async "start-h2"(id) {
    const m = state.matchById[id];
    await goPhase(m, "h2", { notes: [mkNote(m, "Babak 2 dimulai", stampAt(m, "h2", 0))], clock: runClock() });
  },
  async "to-et"(id) {
    const m = state.matchById[id];
    if (!(await confirmEarly(m, "waktu normal"))) return;
    await goPhase(m, "et1", { notes: [mkNote(m, "Akhir waktu normal · Perpanjangan waktu", stampNow(m))], clock: stopClock(), extra: { etPlayed: true } });
  },
  async "end-et1"(id) {
    const m = state.matchById[id];
    if (!(await confirmEarly(m, "ET1"))) return;
    await goPhase(m, "etb", { notes: [mkNote(m, "Akhir ET1 · Istirahat", stampNow(m))], clock: runClock() });
  },
  async "start-et2"(id) {
    const m = state.matchById[id];
    await goPhase(m, "et2", { notes: [mkNote(m, "ET2 dimulai", stampAt(m, "et2", 0))], clock: runClock() });
  },
  async "to-pen"(id) {
    const m = state.matchById[id], ph = phaseOf(m);
    if (!(await confirmEarly(m, ph === "et2" ? "ET2" : "waktu normal"))) return;
    await goPhase(m, "pen", { notes: [mkNote(m, ph === "et2" ? "Akhir ET2 · Adu penalti" : "Akhir waktu normal · Adu penalti", stampNow(m))], clock: stopClock() });
  },
  async "added-inc"(id) { await setAdded(id, +1); },
  async "added-dec"(id) { await setAdded(id, -1); },
  async pause(id) {
    const m = state.matchById[id], ph = phaseOf(m);
    const v = await openModal({
      title: "Jeda darurat", ok: "Hentikan jam", message: "Jam berhenti dan alasannya tampil di layar penonton.",
      fields: `<div class="pausef"><div>${PAUSE_REASONS.map(([k, l], i) => `<label class="check"><input type="radio" name="reason" value="${k}" ${i === 0 ? "checked" : ""}> ${l}</label>`).join("")}</div>
        <div class="when-to"><label for="pz-side">Time-out untuk tim</label><select id="pz-side" name="side"><option value="A">${esc(sideName(m, "A"))}</option><option value="B">${esc(sideName(m, "B"))}</option></select></div>
        <div class="when-ot"><label for="pz-note">Keterangan (opsional, tampil di publik)</label><input id="pz-note" type="text" name="note" maxlength="30" autocomplete="off"></div></div>`,
      read: (r) => ({ key: r.querySelector('[name="reason"]:checked').value, side: r.querySelector('[name="side"]').value, note: r.querySelector('[name="note"]').value.trim() }),
    });
    if (!v) return;
    const patch = { clock: stopClock(elapsedSec(m)) };
    let label = (PAUSE_REASONS.find((x) => x[0] === v.key) || [])[1] || "Jeda";
    if (v.key === "other" && v.note) label = v.note;
    if (v.key === "timeout") {
      // Aturan futsal: 1 time-out (1 menit) per tim per babak, tidak ada di perpanjangan waktu. Peringatan saja, tidak memblokir.
      const used = m.timeouts && m.timeouts[ph + v.side];
      const warn = ph === "et1" || ph === "et2" ? "Di perpanjangan waktu tidak ada time-out menurut aturan futsal." : used ? `${sideName(m, v.side)} sudah memakai time-out di babak ini (jatah 1 per tim per babak).` : "";
      if (warn && !(await confirmBox(warn + "\nTetap catat time-out ini?", { title: "Time-out", ok: "Ya, catat" }))) return;
      label = `Time-out ${sideName(m, v.side)}`;
      patch.timeouts = { ...(m.timeouts || {}), [ph + v.side]: true };
    }
    patch.pause = { key: v.key, label, ...(v.key === "timeout" ? { side: v.side } : {}) };
    const b = writeBatch(db);
    b.set(doc(collection(db, "events")), mkNote(m, `Jeda · ${label}`, stampNow(m)));
    b.update(matchRef(id), patch);
    await b.commit();
  },
  async resume(id) {
    const m = state.matchById[id];
    await updateDoc(matchRef(id), { clock: runClock(m.clock?.baseSec || 0), pause: null });
  },
  async finish(id) {
    const m = state.matchById[id];
    const miss = matchReadiness(m, state.players);
    if (miss.length) throw new Error("Lengkapi line up dulu: " + miss.join("; ") + ".");
    const [a, b] = finalScore(m, state.events.filter((e) => e.matchId === id));
    if (isKnockout(m) && a === b && !m.penWinner) throw new Error("Skor seri di babak gugur. Pilih pemenang adu penalti dulu.");
    const ph = phaseOf(m);
    const early = isPlayPhase(ph) && !m.correcting && elapsedSec(m) < periodLimitSec(m, ph) ? `\n\nPerhatian: ${PHASE_NAME[ph]} baru ${clockText(m)} dari ${limitText(m, ph)}.` : "";
    if (!(await confirmBox(`Akhiri laga ${sideName(m, "A")} ${a} – ${b} ${sideName(m, "B")}?\nHasil akan masuk klasemen.${early}`, { title: "Akhiri pertandingan?", ok: "Ya, akhiri laga" }))) return;
    await updateDoc(matchRef(id), { status: "ft", scoreA: a, scoreB: b, clock: stopClock(elapsedSec(m)), pause: null, addedMin: 0, correcting: false });
    ui.sheet = null;
  },
  // --- POS ---
  side(_, el) { ui.side = el.dataset.side; },
  tab(_, el) { ui.tabs[el.dataset.group] = el.dataset.tab; },
  pick(id, el) { ui.sheet = { matchId: route().id, side: el.dataset.side, playerId: id, step: "act" }; },
  "close-sheet"() { ui.sheet = null; },
  async ev(_, el) {
    const s = ui.sheet, m = curMatch();
    if (!s || !m) return;
    const type = el.dataset.type;
    if (type === "goal" && lineupIds(m, s.side).length > 1) { s.step = "assist"; s.type = "goal"; return; }
    ui.sheet = null;
    // gol penalti disimpan sebagai gol biasa bertanda pen (tanpa assist), jadi ikut hitungan top scorer
    if (type === "penalty") await recordEvent(m, s.side, s.playerId, "goal", null, { pen: true });
    else await recordEvent(m, s.side, s.playerId, type, null);
  },
  async assist(_, el) {
    const s = ui.sheet, m = curMatch();
    if (!s || !m) return;
    ui.sheet = null;
    await recordEvent(m, s.side, s.playerId, "goal", el.dataset.pick || null);
  },
  // --- Line up ---
  "lu-toggle"(id, el) {
    const m = curMatch(); if (!m) return;
    const d = draftOf(m), side = el.dataset.side, cur = d[side][id] || "";
    const next = cur === "" ? "S" : cur === "S" ? "B" : "";
    if (next === "S" && Object.values(d[side]).filter((v) => v === "S").length >= FUTSAL_STARTERS) {
      // inti penuh: lompat ke cadangan
      d[side][id] = "B";
    } else if (next) d[side][id] = next; else delete d[side][id];
    d.dirty = true;
  },
  "lu-reset"() { ui.draft = null; },
  async "lu-save"(id) {
    const m = state.matchById[id], d = draftOf(m);
    const build = (side) => {
      const starters = [], subs = [];
      for (const p of playersOf(side === "A" ? m.teamA : m.teamB)) {
        if (d[side][p.id] === "S") starters.push(p.id); else if (d[side][p.id] === "B") subs.push(p.id);
      }
      return { starters, subs };
    };
    const A = build("A"), B = build("B");
    if (A.starters.length > FUTSAL_STARTERS || B.starters.length > FUTSAL_STARTERS) throw new Error(`Susunan inti maksimal ${FUTSAL_STARTERS} pemain per tim.`);
    // pemain yang sudah punya kejadian di laga ini tidak boleh dikeluarkan dari line up
    const inLu = new Set([...A.starters, ...A.subs, ...B.starters, ...B.subs]);
    const gone = state.events.filter((e) => e.matchId === id && [e.playerId, e.assistId].some((x) => x && !inLu.has(x)));
    if (gone.length) throw new Error(`${pName(gone[0].playerId)} sudah punya kejadian di laga ini, tidak bisa dikeluarkan dari line up. Hapus kejadiannya dulu.`);
    await updateDoc(matchRef(id), { lineupA: A, lineupB: B });
    ui.draft = null;
    toast("Line up tersimpan");
  },
  async "fill-ko"() {
    const plan = planKnockout(state.teams, state.matches);
    if (!plan.length) throw new Error("Belum ada tim yang bisa diisi.");
    const b = writeBatch(db);
    plan.forEach((x) => b.update(matchRef(x.id), x.patch));
    await b.commit();
    toast(`${plan.length} laga babak gugur terisi`);
  },
  async reopen(id) {
    const m = state.matchById[id];
    if (!(await confirmBox("Hasilnya keluar dari klasemen sampai kamu menekan Selesai (FT) lagi.", { title: "Buka kembali laga ini untuk koreksi?", ok: "Ya, buka kembali" }))) return;
    // laga lama (sebelum fase) diberi fase terakhir supaya cap menit koreksi masuk akal
    await updateDoc(matchRef(id), {
      status: "live", phase: m.phase || "h2", cfg: m.cfg || cfgFor(m, timingOf(state.settings)), correcting: true,
      pause: { key: "koreksi", label: "Koreksi" }, clock: stopClock(m.clock?.baseSec || 0),
    });
  },
  async "del-event"(id) {
    const e = state.events.find((x) => x.id === id);
    if (!e) return;
    if (!(await confirmBox(`${evLabel(e)} · ${pName(e.playerId)} menit ${e.minute ?? 0}'. Skor ikut menyesuaikan.`, { title: "Batalkan kejadian ini?", ok: "Ya, batalkan", cancel: "Tidak", danger: true }))) return;
    const m = state.matchById[e.matchId];
    const batch = writeBatch(db);
    batch.delete(doc(db, "events", id));
    if (m) {
      const [a, b] = finalScore(m, state.events.filter((x) => x.matchId === m.id && x.id !== id));
      const patch = { scoreA: a, scoreB: b };
      if (a !== b && m.penWinner) patch.penWinner = null;
      batch.update(matchRef(m.id), patch);
    }
    await batch.commit();
  },
  async "del-match"(id) {
    if (!(await confirmBox("Semua kejadian di laga ini ikut terhapus dan tidak bisa dikembalikan.", { title: "Hapus pertandingan ini?", ok: "Ya, hapus", danger: true }))) return;
    const b = writeBatch(db);
    state.events.filter((e) => e.matchId === id).forEach((e) => b.delete(doc(db, "events", e.id)));
    b.delete(matchRef(id));
    await b.commit();
    location.hash = "#matches";
  },
  async "wipe-matches"() {
    const n = state.matches.length;
    if (!n) throw new Error("Belum ada pertandingan.");
    if (!(await typeConfirm(`${n} pertandingan beserta ${state.events.length} kejadiannya akan dihapus dan tidak bisa dikembalikan. Tim dan pemain tidak ikut terhapus.`, "HAPUS", { title: "Hapus semua pertandingan?", ok: "Ya, hapus semua" }))) return;
    await deleteMany([...state.events.map((e) => doc(db, "events", e.id)), ...state.matches.map((m) => matchRef(m.id))]);
    toast(`${n} pertandingan dihapus`);
  },
  async "wipe-teams"() {
    const n = state.teams.length;
    if (!n) throw new Error("Belum ada tim.");
    if (state.matches.length) throw new Error(`Masih ada ${state.matches.length} pertandingan yang memakai tim. Hapus semua pertandingan dulu.`);
    if (!(await typeConfirm(`${n} tim beserta ${state.players.length} pemain dan official akan dihapus dan tidak bisa dikembalikan.`, "HAPUS", { title: "Hapus semua tim?", ok: "Ya, hapus semua" }))) return;
    await deleteMany([...state.players.map((p) => doc(db, "players", p.id)), ...state.teams.map((t) => doc(db, "teams", t.id))]);
    await setDoc(doc(db, "settings", "main"), { bestGkId: null }, { merge: true });
    toast(`${n} tim dihapus`);
  },
  async "del-team"(id) {
    const t = state.teamById[id];
    if (state.matches.some((m) => m.teamA === id || m.teamB === id)) throw new Error("Tim ini masih dipakai di jadwal. Hapus atau ubah laganya dulu.");
    if (!(await confirmBox(`Tim "${t.name}" beserta semua pemainnya akan dihapus dan tidak bisa dikembalikan.`, { title: "Hapus tim ini?", ok: "Ya, hapus tim", danger: true }))) return;
    const b = writeBatch(db);
    state.players.filter((p) => p.teamId === id).forEach((p) => b.delete(doc(db, "players", p.id)));
    b.delete(doc(db, "teams", id));
    await b.commit();
    location.hash = "#teams";
  },
  async "pick-gk"(id) {
    const next = state.settings.bestGkId === id ? null : id;
    await setDoc(doc(db, "settings", "main"), { bestGkId: next }, { merge: true });
    toast(next ? `Kiper terbaik: ${pName(id)}` : "Pilihan kiper terbaik dibatalkan");
  },
  "clear-import"() { importState = null; },
  async "apply-import"() {
    const st = importState;
    if (!st || st.plan.errors.length) throw new Error("Perbaiki masalah di file dulu.");
    if (st.replace && !(await confirmBox("Mode ganti total aktif: pemain/official lama yang tidak ada di file akan DIHAPUS. Kejadian dan line up yang memakainya akan kehilangan nama.", { title: "Ganti total data tim?", ok: "Ya, lanjutkan impor", danger: true }))) return;
    const ops = buildOps(st.plan, { existingPlayers: state.players, matches: state.matches, replace: st.replace, newId: (c) => doc(collection(db, c)).id });
    if (!ops.length) throw new Error("Tidak ada perubahan.");
    for (let i = 0; i < ops.length; i += 400) {
      const b = writeBatch(db);
      for (const o of ops.slice(i, i + 400)) {
        const ref = doc(db, o.col, o.id);
        if (o.op === "set") b.set(ref, o.data); else if (o.op === "update") b.update(ref, o.data); else b.delete(ref);
      }
      await b.commit();
    }
    importState = null;
    toast(`Impor selesai: ${st.plan.totals.teams} tim, ${st.plan.totals.players + st.plan.totals.officials} orang`);
    location.hash = "#teams";
  },
  async "pick-logo"(id, b) {
    await updateDoc(doc(db, "teams", id), { logoUrl: logoPath(b.dataset.file) });
    toast("Logo dipasang");
  },
  async "del-logo"(id) {
    if (!(await confirmBox("Tim ini akan kembali memakai lingkaran berisi singkatan nama.", { title: "Hapus logo tim?", ok: "Ya, hapus logo", danger: true }))) return;
    await updateDoc(doc(db, "teams", id), { logoUrl: null });
  },
  async "del-player"(id) {
    const p = state.playerById[id];
    if (!(await confirmBox(`${p.number != null ? p.number + " · " : ""}${p.name} akan dihapus dari tim.${state.events.some((e) => e.playerId === id) ? "\nPemain ini punya gol/kartu yang tercatat; namanya akan tampil '–' di riwayat." : ""}`, { title: "Hapus pemain?", ok: "Ya, hapus", danger: true }))) return;
    const b = writeBatch(db);
    b.delete(doc(db, "players", id));
    state.matches.forEach((m) => {
      const patch = {};
      for (const k of ["lineupA", "lineupB"]) {
        const lu = m[k];
        if (lu && ([...(lu.starters || []), ...(lu.subs || [])].includes(id))) patch[k] = { starters: (lu.starters || []).filter((x) => x !== id), subs: (lu.subs || []).filter((x) => x !== id) };
      }
      if (m.motmId === id) patch.motmId = null;
      if (Object.keys(patch).length) b.update(matchRef(m.id), patch);
    });
    await b.commit();
  },
  async "edit-player"(id) {
    const p = state.playerById[id];
    const v = await playerBox(p, playersOf(p.teamId).filter((x) => x.id !== id));
    if (!v) return;
    await updateDoc(doc(db, "players", id), { number: v.number === "" ? null : Number(v.number), name: v.name, isGK: v.isGK });
    toast("Pemain diperbarui");
  },
};

const forms = {
  async login(f) {
    const fd = new FormData(f);
    await signInWithEmailAndPassword(auth, String(fd.get("email")).trim(), String(fd.get("password")));
  },
  async match(f) {
    const fd = new FormData(f);
    const stage = fd.get("stage");
    const teamA = fd.get("teamA") || null, teamB = fd.get("teamB") || null;
    if (teamA && teamA === teamB) throw new Error("Tim A dan Tim B tidak boleh sama.");
    const group = stage === "group" ? (state.teamById[teamA]?.group || state.teamById[teamB]?.group || "") : "";
    const data = { stage, group, matchday: Number(fd.get("matchday")) || 1, teamA, teamB, kickoff: fromLocalInput(fd.get("kickoff")) };
    const id = f.dataset.id;
    if (id) { await updateDoc(matchRef(id), data); toast("Tersimpan"); }
    else {
      await setDoc(doc(collection(db, "matches")), {
        ...data, status: "scheduled", scoreA: 0, scoreB: 0, clock: { running: false, baseSec: 0, startedAt: null },
        lineupA: { starters: [], subs: [] }, lineupB: { starters: [], subs: [] }, motmId: null, createdAt: Date.now(),
      });
      f.reset();
      toast("Pertandingan ditambahkan");
    }
  },
  async "import-matches"(f) {
    const lines = String(new FormData(f).get("text")).split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) throw new Error("Tempel jadwal dulu.");
    const byName = Object.fromEntries(state.teams.map((t) => [t.name.trim().toLowerCase(), t]));
    const stageMap = { qf: "qf", perempat: "qf", sf: "sf", semi: "sf", final: "final", third: "third", "3": "third", juara3: "third" };
    const docs = [], problems = [];
    lines.forEach((line, i) => {
      const p = line.split(/\s*[|\t;]\s*/);
      const dt = (p[0] || "").trim();
      let iso = dt;
      const dm = dt.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})\s+(\d{1,2})[.:](\d{2})$/);
      if (dm) iso = `${dm[3]}-${dm[2].padStart(2, "0")}-${dm[1].padStart(2, "0")} ${dm[4].padStart(2, "0")}:${dm[5]}`;
      const tbd = /^(tbd|tba|-|–|menyusul|akan ditentukan)$/i.test(dt);
      const kickoff = tbd ? null : fromLocalInput(iso.replace(" ", "T"));
      const tag = (p[1] || "").trim();
      const stage = /^[A-Za-z]$/.test(tag) ? "group" : stageMap[tag.toLowerCase()];
      const A = (p[3] || "").trim(), B = (p[4] || "").trim();
      const ta = A ? byName[A.toLowerCase()] : null, tb = B ? byName[B.toLowerCase()] : null;
      if (!tbd && !kickoff) problems.push(`Baris ${i + 1}: tanggal/jam tidak valid ("${dt}"). Tulis TBD bila waktu belum ditentukan.`);
      else if (!stage) problems.push(`Baris ${i + 1}: grup/fase tidak dikenal ("${tag}")`);
      else if (A && !ta) problems.push(`Baris ${i + 1}: tim "${A}" tidak ditemukan`);
      else if (B && !tb) problems.push(`Baris ${i + 1}: tim "${B}" tidak ditemukan`);
      else if (stage === "group" && (!ta || !tb)) problems.push(`Baris ${i + 1}: laga grup harus punya dua tim`);
      else docs.push({
        stage, group: stage === "group" ? tag.toUpperCase() : "", matchday: Number(p[2]) || 1,
        teamA: ta?.id || null, teamB: tb?.id || null, kickoff, status: "scheduled", scoreA: 0, scoreB: 0,
        clock: { running: false, baseSec: 0, startedAt: null }, lineupA: { starters: [], subs: [] }, lineupB: { starters: [], subs: [] }, motmId: null, createdAt: Date.now() + i,
      });
    });
    if (problems.length) throw new Error(problems.slice(0, 4).join(" · ") + (problems.length > 4 ? ` (+${problems.length - 4} lagi)` : ""));
    for (let i = 0; i < docs.length; i += 400) {
      const b = writeBatch(db);
      docs.slice(i, i + 400).forEach((d) => b.set(doc(collection(db, "matches")), d));
      await b.commit();
    }
    f.reset();
    toast(`${docs.length} pertandingan diimpor`);
  },
  async motm(f) { await updateDoc(matchRef(f.dataset.id), { motmId: new FormData(f).get("motm") || null }); },
  async score(f) {
    const m = state.matchById[f.dataset.id], fd = new FormData(f);
    const ta = Math.max(0, Number(fd.get("a")) || 0), tb = Math.max(0, Number(fd.get("b")) || 0);
    const [da, db_] = scoreFromEvents(m, state.events);
    await updateDoc(matchRef(m.id), { scoreA: ta, scoreB: tb, adjA: ta - da, adjB: tb - db_, ...(ta !== tb && m.penWinner ? { penWinner: null } : {}) });
  },
  async "new-team"(f) {
    const fd = new FormData(f);
    const name = String(fd.get("name")).trim();
    if (state.teams.some((t) => t.name.toLowerCase() === name.toLowerCase())) throw new Error("Nama tim sudah ada.");
    await setDoc(doc(collection(db, "teams")), { name, group: String(fd.get("group")).trim().toUpperCase() });
    f.reset();
  },
  async "bulk-teams"(f) {
    const lines = String(new FormData(f).get("text")).split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) throw new Error("Tempel daftar tim dulu.");
    const have = new Set(state.teams.map((t) => t.name.toLowerCase()));
    const b = writeBatch(db); let n = 0;
    for (const l of lines) {
      const [name, group = ""] = l.split(/\s*[|\t;]\s*/);
      if (!name || have.has(name.trim().toLowerCase())) continue;
      have.add(name.trim().toLowerCase());
      b.set(doc(collection(db, "teams")), { name: name.trim(), group: group.trim().toUpperCase() }); n++;
    }
    if (!n) throw new Error("Tidak ada tim baru (semua sudah ada).");
    await b.commit(); f.reset(); toast(`${n} tim ditambahkan`);
  },
  async team(f) {
    const id = f.dataset.id, fd = new FormData(f);
    const name = String(fd.get("name")).trim(), group = String(fd.get("group")).trim().toUpperCase();
    const b = writeBatch(db);
    b.update(doc(db, "teams", id), { name, group });
    state.matches.filter((m) => m.stage === "group" && (m.teamA === id || m.teamB === id)).forEach((m) => b.update(matchRef(m.id), { group }));
    await b.commit();
  },
  async player(f) {
    const fd = new FormData(f);
    const n = String(fd.get("number")).trim();
    if (n !== "" && playersOf(f.dataset.id).some((p) => p.number === Number(n))) throw new Error(`No punggung ${n} sudah dipakai di tim ini.`);
    await setDoc(doc(collection(db, "players")), { teamId: f.dataset.id, name: String(fd.get("name")).trim(), number: n === "" ? null : Number(n), isGK: !!fd.get("gk"), role: "player" });
    f.reset();
  },
  async official(f) {
    const name = String(new FormData(f).get("name")).trim();
    if (!name) throw new Error("Isi nama official.");
    if (officialsOf(f.dataset.id).length >= LIMITS.officials) throw new Error(`Official maksimal ${LIMITS.officials} orang per tim.`);
    await setDoc(doc(collection(db, "players")), { teamId: f.dataset.id, name, number: null, isGK: false, role: "official" });
    f.reset();
  },
  async "bulk-players"(f) {
    const lines = String(new FormData(f).get("text")).split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) throw new Error("Tempel daftar pemain dulu.");
    const b = writeBatch(db);
    lines.forEach((l) => {
      const parts = l.split(/\s*[,|\t;]\s*/);
      let number = null;
      if (/^\d{1,2}$/.test(parts[0]) && parts.length > 1) number = Number(parts.shift());
      const name = (parts.shift() || "").trim();
      const isGK = parts.some((x) => /^(gk|kiper)$/i.test(x.trim()));
      if (name) b.set(doc(collection(db, "players")), { teamId: f.dataset.id, name, number, isGK });
    });
    await b.commit(); f.reset(); toast("Pemain ditambahkan");
  },
  async announce(f) {
    const fd = new FormData(f);
    await setDoc(doc(db, "settings", "main"), { announcement: { active: !!fd.get("active"), title: String(fd.get("title")).trim(), body: String(fd.get("body")).trim() } }, { merge: true });
  },
  async timing(f) {
    const fd = new FormData(f);
    const num = (k, lo, hi, label) => { const v = Number(fd.get(k)); if (!Number.isInteger(v) || v < lo || v > hi) throw new Error(`${label}: isi angka bulat ${lo}–${hi}.`); return v; };
    const timing = {
      groupHalves: Number(fd.get("groupHalves")) === 1 ? 1 : 2,
      groupHalf: num("groupHalf", 1, 45, "Grup: menit per babak"), koHalf: num("koHalf", 1, 45, "Babak gugur: menit per babak"),
      etHalf: num("etHalf", 1, 15, "Perpanjangan waktu: menit per babak"), breakMin: num("breakMin", 0, 20, "Istirahat"), etBreakMin: num("etBreakMin", 0, 10, "Istirahat ET"),
    };
    await setDoc(doc(db, "settings", "main"), { timing }, { merge: true });
  },
  async pen(f) {
    const v = new FormData(f).get("pen");
    await updateDoc(matchRef(f.dataset.id), { penWinner: v === "A" || v === "B" ? v : null });
  },
};
const okText = {
  motm: "Tersimpan",
  score: "Skor diperbarui", "new-team": "Tim ditambahkan", team: "Tersimpan", player: "Pemain ditambahkan", official: "Official ditambahkan",
  pen: "Pemenang penalti tersimpan", timing: "Durasi tersimpan", announce: "Pengumuman tersimpan",
};

document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-act]");
  if (!b || !$app.contains(b) && !$bar.contains(b)) return;
  const fn = actions[b.dataset.act];
  if (!fn) return;
  b.disabled = true;
  act(() => fn(b.dataset.id, b), null).finally(() => { b.disabled = false; render(); });
});
document.addEventListener("submit", (e) => {
  const f = e.target.closest("form[data-form]");
  if (!f) return;
  e.preventDefault();
  const fn = forms[f.dataset.form];
  const btn = f.querySelector('button[type="submit"]');
  if (btn) btn.disabled = true;
  act(() => fn(f), okText[f.dataset.form]).finally(() => { if (btn) btn.disabled = false; if (f.dataset.form !== "login") render(); });
});
document.addEventListener("change", async (e) => {
  const t = e.target;
  if (t.matches?.("[data-import-replace]") && importState) { importState.replace = t.checked; return; }
  if (!t.matches?.("[data-import-file]")) return;
  const file = t.files?.[0];
  if (!file) return;
  try {
    const rows = await parseFile(file);
    importState = { fileName: file.name, plan: buildPlan(rows, state.teams, state.players), replace: false };
    ui.tabs.addTeam = "impor";
    render();
  } catch (err) {
    console.error(err);
    importState = null;
    toast(errMsg(err), true);
  }
});
// Logo tim: dikecilkan di browser lalu disimpan langsung di dokumen tim (tanpa Firebase Storage)
function fileToLogo(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const max = 256;
      const w0 = img.naturalWidth || max, h0 = img.naturalHeight || max;
      const s = Math.min(1, max / Math.max(w0, h0));
      const c = document.createElement("canvas");
      c.width = Math.max(1, Math.round(w0 * s)); c.height = Math.max(1, Math.round(h0 * s));
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      let out = c.toDataURL("image/webp", 0.9);
      if (!out.startsWith("data:image/webp")) out = c.toDataURL("image/png");
      if (out.length > 180000) return reject(new Error("Logo terlalu besar/rumit. Coba gambar yang lebih sederhana."));
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("File bukan gambar yang valid.")); };
    img.src = url;
  });
}

document.addEventListener("change", (e) => {
  const inp = e.target.closest("input[data-logo]");
  if (inp && inp.files[0]) {
    const id = inp.dataset.logo, file = inp.files[0];
    act(async () => { await updateDoc(doc(db, "teams", id), { logoUrl: await fileToLogo(file) }); }, "Logo tersimpan").finally(render);
    return;
  }
});

// Jam LIVE bergerak tiap detik
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

window.addEventListener("hashchange", () => { ui.sheet = null; ui.draft = null; window.scrollTo(0, 0); startSkeleton(); render(); });
onChange(safeRender);
onAuthStateChanged(auth, (u) => {
  user = u || null;
  if (user) { startStore(); syncServerTime().then(render); }
  render();
});
render();

setInterval(() => { if (user) syncServerTime(); }, 5 * 60 * 1000);
