// Langganan realtime ke Firestore. Dipakai oleh website publik dan admin.
import { db, collection, doc, onSnapshot } from "./firebase.js";

export const state = {
  settings: {},
  teams: [],
  players: [],
  matches: [],
  events: [],
  loaded: { settings: false, teams: false, players: false, matches: false, events: false },
  error: null,
  // peta bantu, dihitung ulang setiap data berubah
  teamById: {},
  playerById: {},
  matchById: {},
};

const listeners = new Set();
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export const isReady = () => Object.values(state.loaded).every(Boolean);

let queued = false;
function emit() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    state.teamById = Object.fromEntries(state.teams.map((t) => [t.id, t]));
    state.playerById = Object.fromEntries(state.players.map((p) => [p.id, p]));
    state.matchById = Object.fromEntries(state.matches.map((m) => [m.id, m]));
    listeners.forEach((fn) => fn());
  });
}

function watchCollection(name) {
  onSnapshot(
    collection(db, name),
    (snap) => {
      state[name] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      state.loaded[name] = true;
      state.error = null;
      emit();
    },
    (err) => {
      console.error(name, err);
      state.error = err;
      emit();
    }
  );
}

let started = false;
export function startStore() {
  if (started) return;
  started = true;
  ["teams", "players", "matches", "events"].forEach(watchCollection);
  onSnapshot(
    doc(db, "settings", "main"),
    (snap) => {
      state.settings = snap.exists() ? snap.data() : {};
      state.loaded.settings = true;
      emit();
    },
    (err) => { console.error("settings", err); state.error = err; emit(); }
  );
}
