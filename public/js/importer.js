// Impor tim, pemain, dan official dari Excel (.xlsx) atau CSV.
// Tanpa library luar: .xlsx dibaca langsung (zip + XML) memakai DecompressionStream bawaan browser,
// sehingga Content-Security-Policy tetap ketat dan tidak ada dependensi yang bisa bermasalah.
//
// Kolom (baris pertama = judul, urutan bebas, huruf besar/kecil tidak berpengaruh):
//   Tim     nama tim / perusahaan            (wajib)
//   Grup    A, B, C, D ... boleh kosong
//   Peran   Pemain | Kiper | Official          (kosong = Pemain)
//   No      nomor punggung 0-99               (wajib untuk Pemain dan Kiper)
//   Nama    nama pemain / official             (wajib)
// Kolom lain (mis. NIK, telepon) diabaikan dan TIDAK disimpan, karena data website bersifat publik.

export const LIMITS = { players: 10, officials: 2 };

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const clean = (s) => String(s ?? "").replace(/\s+/g, " ").trim();

const HEADERS = {
  team: ["tim", "namatim", "team", "perusahaan", "namaperusahaan", "tenant"],
  group: ["grup", "group"],
  role: ["peran", "role", "posisi", "jabatan"],
  number: ["no", "nomor", "nopunggung", "nomorpunggung", "nomerpunggung", "number", "nopung"],
  name: ["nama", "namapemain", "namalengkap", "name", "pemain"],
};

// ---------- CSV ----------
export function parseCSV(text) {
  text = String(text).replace(/^\uFEFF/, "");
  const first = text.split(/\r?\n/, 1)[0] || "";
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let q = false;
  for (const c of first) { if (c === '"') q = !q; else if (!q && c in counts) counts[c]++; }
  const delim = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cell = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; } else cell += c;
    } else if (c === '"') inQ = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// ---------- XLSX (zip + XML) ----------
async function inflateRaw(bytes) {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
function readZip(buf) {
  const v = new DataView(buf), u8 = new Uint8Array(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("File bukan .xlsx yang valid.");
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const files = {};
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) break;
    const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true);
    const nlen = v.getUint16(p + 28, true), elen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true);
    const lho = v.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    files[name] = { method, csize, lho };
    p += 46 + nlen + elen + clen;
  }
  const read = async (name) => {
    const f = files[name];
    if (!f) return null;
    const o = f.lho, start = o + 30 + v.getUint16(o + 26, true) + v.getUint16(o + 28, true);
    const data = u8.subarray(start, start + f.csize);
    const out = f.method === 0 ? data : f.method === 8 ? await inflateRaw(data) : null;
    if (!out) throw new Error("Format kompresi .xlsx tidak didukung. Simpan ulang sebagai .xlsx biasa atau CSV.");
    return dec.decode(out);
  };
  return { read, has: (n) => !!files[n] };
}
const xml = (s) => new DOMParser().parseFromString(s, "application/xml");
const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/[^A-Z]/gi, "").toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

export async function parseXLSX(buf) {
  const zip = readZip(buf);
  const wb = await zip.read("xl/workbook.xml");
  if (!wb) throw new Error("File bukan .xlsx yang valid.");
  let sheetPath = "xl/worksheets/sheet1.xml";
  try {
    const first = xml(wb).getElementsByTagName("sheet")[0];
    const rid = first?.getAttribute("r:id") || first?.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id");
    const rels = await zip.read("xl/_rels/workbook.xml.rels");
    if (rid && rels) {
      for (const r of xml(rels).getElementsByTagName("Relationship")) {
        if (r.getAttribute("Id") === rid) { const t = r.getAttribute("Target"); sheetPath = t.startsWith("/") ? t.slice(1) : "xl/" + t.replace(/^\.\//, ""); }
      }
    }
  } catch { /* pakai sheet1 */ }
  const shared = [];
  const ss = await zip.read("xl/sharedStrings.xml");
  if (ss) for (const si of xml(ss).getElementsByTagName("si")) shared.push([...si.getElementsByTagName("t")].map((t) => t.textContent).join(""));
  const sheet = await zip.read(sheetPath);
  if (!sheet) throw new Error("Lembar data pertama tidak ditemukan di file .xlsx.");
  const rows = [];
  for (const r of xml(sheet).getElementsByTagName("row")) {
    const arr = [];
    for (const c of r.getElementsByTagName("c")) {
      const idx = colIndex(c.getAttribute("r") || "A1");
      const t = c.getAttribute("t");
      let val = "";
      if (t === "inlineStr") val = [...c.getElementsByTagName("t")].map((x) => x.textContent).join("");
      else {
        const vEl = c.getElementsByTagName("v")[0];
        const raw = vEl ? vEl.textContent : "";
        val = t === "s" ? shared[Number(raw)] ?? "" : raw;
      }
      arr[idx] = val;
    }
    rows.push(Array.from(arr, (x) => x ?? ""));
  }
  return rows;
}

export async function parseFile(file) {
  if (file.size > 5 * 1024 * 1024) throw new Error("File terlalu besar (maksimal 5 MB).");
  const name = file.name.toLowerCase();
  if (name.endsWith(".xlsx") || name.endsWith(".xlsm")) return parseXLSX(await file.arrayBuffer());
  if (name.endsWith(".xls")) throw new Error("Format .xls lama tidak didukung. Di Excel pilih Save As → .xlsx atau CSV.");
  if (/\.(csv|tsv|txt)$/.test(name)) return parseCSV(await file.text());
  throw new Error("Pilih file .xlsx atau .csv.");
}

// ---------- Validasi & rencana impor ----------
function mapHeader(row) {
  const idx = {};
  row.forEach((h, i) => {
    const k = norm(h);
    for (const [field, names] of Object.entries(HEADERS)) if (idx[field] === undefined && names.includes(k)) idx[field] = i;
  });
  return idx;
}
const roleOf = (v) => {
  const k = norm(v);
  if (/ofisial|official|manager|manajer|pelatih|coach|ofc/.test(k)) return "official";
  if (/kiper|gk|goalkeeper|penjaga/.test(k)) return "gk";
  return "player";
}

/**
 * rows: baris mentah (array of array). existingTeams/existingPlayers: data saat ini di Firestore.
 * Mengembalikan { teams, errors, warnings, totals }. Tidak menulis apa pun.
 */
export function buildPlan(rows, existingTeams = [], existingPlayers = []) {
  const errors = [], warnings = [];
  const headIdx = rows.findIndex((r) => r.some((c) => clean(c) !== ""));
  if (headIdx < 0) return { teams: [], errors: ["File kosong."], warnings, totals: { teams: 0, players: 0, officials: 0 } };
  const col = mapHeader(rows[headIdx]);
  const missing = ["team", "name"].filter((f) => col[f] === undefined);
  if (missing.length) {
    return { teams: [], errors: [`Kolom wajib tidak ditemukan di baris pertama: ${missing.map((m) => (m === "team" ? "Tim" : "Nama")).join(", ")}. Gunakan judul kolom: Tim, Grup, Peran, No, Nama.`], warnings, totals: { teams: 0, players: 0, officials: 0 } };
  }
  const get = (r, f) => (col[f] === undefined ? "" : clean(r[col[f]]));
  const byKey = new Map();
  const existingByName = new Map(existingTeams.map((t) => [clean(t.name).toLowerCase(), t]));

  rows.slice(headIdx + 1).forEach((r, i) => {
    if (!r.some((c) => clean(c) !== "")) return;
    const line = headIdx + i + 2; // nomor baris seperti di Excel
    const teamName = get(r, "team"), name = get(r, "name");
    if (!teamName) { errors.push(`Baris ${line}: nama tim kosong.`); return; }
    const key = teamName.toLowerCase();
    if (!byKey.has(key)) {
      const ex = existingByName.get(key);
      byKey.set(key, { name: ex ? ex.name : teamName, existing: ex || null, group: "", players: [], officials: [] });
    }
    const t = byKey.get(key);
    const g = get(r, "group").toUpperCase();
    if (g) {
      if (!/^[A-Z0-9]{1,2}$/.test(g)) errors.push(`Baris ${line}: grup "${g}" tidak valid (pakai huruf, mis. A).`);
      else if (t.group && t.group !== g) errors.push(`Baris ${line}: tim "${t.name}" punya dua grup berbeda (${t.group} dan ${g}).`);
      else t.group = g;
    }
    if (!name) { errors.push(`Baris ${line}: nama kosong (tim ${t.name}).`); return; }
    const role = roleOf(get(r, "role"));
    if (role === "official") { t.officials.push({ name, line }); return; }
    const raw = get(r, "number");
    const n = Number(raw);
    if (raw === "") errors.push(`Baris ${line}: ${name} (${t.name}) belum punya no punggung.`);
    else if (!Number.isInteger(n) || n < 0 || n > 99) errors.push(`Baris ${line}: no punggung "${raw}" tidak valid untuk ${name} (harus angka 0–99).`);
    t.players.push({ name, number: raw !== "" && Number.isInteger(n) ? n : null, isGK: role === "gk", line });
  });

  for (const t of byKey.values()) {
    const seen = new Map();
    for (const p of t.players) {
      if (p.number === null) continue;
      if (seen.has(p.number)) errors.push(`Tim ${t.name}: no punggung ${p.number} dipakai dua kali (${seen.get(p.number)} dan ${p.name}).`);
      else seen.set(p.number, p.name);
    }
    const names = new Set();
    for (const p of t.players) { const k = p.name.toLowerCase(); if (names.has(k)) warnings.push(`Tim ${t.name}: nama "${p.name}" muncul lebih dari sekali.`); names.add(k); }
    if (t.players.length > LIMITS.players) warnings.push(`Tim ${t.name}: ${t.players.length} pemain (ketentuan maksimal ${LIMITS.players}).`);
    if (t.officials.length > LIMITS.officials) warnings.push(`Tim ${t.name}: ${t.officials.length} official (ketentuan maksimal ${LIMITS.officials}).`);
    if (!t.players.some((p) => p.isGK)) warnings.push(`Tim ${t.name}: belum ada kiper (Peran = Kiper).`);
    if (t.existing) {
      t.currentPlayers = existingPlayers.filter((p) => p.teamId === t.existing.id).length;
    }
  }
  const teams = [...byKey.values()];
  const newCount = teams.filter((t) => !t.existing).length;
  if (existingTeams.length + newCount > 16) warnings.push(`Total tim akan menjadi ${existingTeams.length + newCount} (kuota liga 16 tim).`);
  return {
    teams, errors, warnings,
    totals: { teams: teams.length, players: teams.reduce((a, t) => a + t.players.length, 0), officials: teams.reduce((a, t) => a + t.officials.length, 0) },
  };
}

/**
 * Menyusun daftar penulisan Firestore dari rencana yang valid.
 * Mengembalikan array operasi {op:"set"|"update"|"delete", col, id, data}. ID tim baru dibuat lewat newId(col).
 * replace=true: pemain/official lama di tim yang ada di file dihapus bila tidak ada di file.
 */
export function buildOps(plan, { existingPlayers = [], matches = [], replace = false, newId }) {
  const ops = [];
  for (const t of plan.teams) {
    const teamId = t.existing ? t.existing.id : newId("teams");
    if (!t.existing) ops.push({ op: "set", col: "teams", id: teamId, data: { name: t.name, group: t.group } });
    else if (t.group && t.group !== (t.existing.group || "")) {
      ops.push({ op: "update", col: "teams", id: teamId, data: { group: t.group } });
      matches.filter((m) => m.stage === "group" && (m.teamA === teamId || m.teamB === teamId)).forEach((m) => ops.push({ op: "update", col: "matches", id: m.id, data: { group: t.group } }));
    }
    const current = existingPlayers.filter((p) => p.teamId === teamId);
    const keep = new Set();
    for (const p of t.players) {
      const ex = current.find((c) => c.role !== "official" && c.number === p.number);
      const data = { teamId, name: p.name, number: p.number, isGK: p.isGK, role: "player" };
      if (ex) { keep.add(ex.id); ops.push({ op: "update", col: "players", id: ex.id, data }); }
      else ops.push({ op: "set", col: "players", id: newId("players"), data });
    }
    for (const o of t.officials) {
      const ex = current.find((c) => c.role === "official" && clean(c.name).toLowerCase() === o.name.toLowerCase());
      const data = { teamId, name: o.name, number: null, isGK: false, role: "official" };
      if (ex) { keep.add(ex.id); ops.push({ op: "update", col: "players", id: ex.id, data }); }
      else ops.push({ op: "set", col: "players", id: newId("players"), data });
    }
    if (replace) current.filter((c) => !keep.has(c.id)).forEach((c) => ops.push({ op: "delete", col: "players", id: c.id }));
  }
  return ops;
}
