/* ============================================================
   Bollywood Link — game engine + FilmLink-style UI
   Chain alternates: FILM → ARTIST → FILM → ARTIST → … → TARGET FILM

   movie tuple: [0 title, 1 year, 2 url, 3 release, 4 company,
                 5 directors, 6 writers, 7 producers, 8 music, 9 cast, 10 allIds]
   chain node:  { t: "m" | "p", id: number }
   ============================================================ */
"use strict";

const D = window.BOLLYWOOD;
const MOVIES = D.movies;
const PEOPLE = D.people;

/* ---------------- indexes ---------------- */
const lcTitles = MOVIES.map((m) => m[0].toLowerCase());
const lcPeople = PEOPLE.map((p) => p.toLowerCase());
const personMovies = Array.from({ length: PEOPLE.length }, () => []);
MOVIES.forEach((m, i) => m[10].forEach((pid) => personMovies[pid].push(i)));
function sharedPeople(a, b) {
  const [A, B] = MOVIES[a][10].length <= MOVIES[b][10].length ? [a, b] : [b, a];
  const other = new Set(MOVIES[B][10]);
  return MOVIES[A][10].filter((pid) => other.has(pid));
}
function edgeLabel(movieIdx, pid) {
  const m = MOVIES[movieIdx];
  if (m[5].includes(pid)) return "director";
  if (m[6].includes(pid)) return "writer";
  if (m[7].includes(pid)) return "producer";
  if (m[8].includes(pid)) return "music";
  if (m[9].includes(pid)) return "cast";
  return "credit";
}
/** how a person is credited on a film: "cast · director" etc. */
function creditType(mid, pid) {
  const m = MOVIES[mid];
  const out = [];
  if (m[9].includes(pid)) out.push("cast");
  if (m[5].includes(pid)) out.push("director");
  if (m[6].includes(pid)) out.push("writer");
  if (m[7].includes(pid)) out.push("producer");
  if (m[8].includes(pid)) out.push("music");
  return out.join(" · ") || "credit";
}

/* ---------------- BFS on the bipartite graph ---------------- */
const nodeKey = (n) => n.t + ":" + n.id;
function nodeNeighbors(n) {
  if (n.t === "m") return MOVIES[n.id][10].map((pid) => ({ t: "p", id: pid }));
  return personMovies[n.id].map((mid) => ({ t: "m", id: mid }));
}
/** shortest path from a node to the target film (array of nodes) or null */
function bfsToTarget(from, targetIdx) {
  const goalKey = "m:" + targetIdx;
  const startKey = nodeKey(from);
  if (startKey === goalKey) return [from];
  const prev = new Map([[startKey, null]]);
  const prevNode = new Map([[startKey, from]]);
  const queue = [from];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    for (const nb of nodeNeighbors(cur)) {
      const k = nodeKey(nb);
      if (prev.has(k)) continue;
      prev.set(k, nodeKey(cur));
      prevNode.set(k, nb);
      if (k === goalKey) {
        const path = [nb];
        let p = k;
        while (prev.get(p)) { p = prev.get(p); path.push(prevNode.get(p)); }
        return path.reverse();
      }
      queue.push(nb);
    }
  }
  return null;
}

/* ---------------- free-play game generation ---------------- */
/** bipartite BFS from a start film → Map("m:3" | "p:7" → links from start) */
function nodeDistances(startFilm) {
  const dist = new Map([["m:" + startFilm, 0]]);
  const queue = [{ t: "m", id: startFilm }];
  let head = 0;
  while (head < queue.length) {
    const cur = queue[head++];
    const d = dist.get(nodeKey(cur));
    for (const nb of nodeNeighbors(cur)) {
      const k = nodeKey(nb);
      if (dist.has(k)) continue;
      dist.set(k, d + 1);
      queue.push(nb);
    }
  }
  return dist;
}
/** random target film reachable from startFilm within [minL,maxL] links (par = links) */
function pickRandomTarget(startFilm, minL = 4, maxL = 8) {
  const dist = nodeDistances(startFilm);
  const cands = [];
  const fallback = [];
  for (const [k, d] of dist) {
    if (k[0] !== "m") continue;
    const mid = +k.slice(2);
    if (mid === startFilm) continue;
    if (d >= 2) fallback.push([mid, d]);
    if (d >= minL && d <= maxL) cands.push([mid, d]);
  }
  const pool = cands.length ? cands : fallback;
  if (!pool.length) return null;
  const [t, p] = pool[(Math.random() * pool.length) | 0];
  return { t, p };
}
/** fully random game: random start + random reachable target */
function randomGameDesc() {
  for (let i = 0; i < 30; i++) {
    const s = (Math.random() * MOVIES.length) | 0;
    const r = pickRandomTarget(s);
    if (r && r.p >= 4) return { m: "random", s, t: r.t, p: r.p };
  }
  const s = (Math.random() * MOVIES.length) | 0;
  const r = pickRandomTarget(s, 2, 12);
  return r ? { m: "random", s, t: r.t, p: r.p } : { m: "random", s: START, t: TARGET, p: PAR };
}

const MODE_LABEL = { random: "🎲 RANDOM", pick: "🎬 PICK START" };
function updateGameUI() {
  $("startTitle").textContent = MOVIES[START][0];
  $("targetTitle").textContent = `${MOVIES[TARGET][0]} (${MOVIES[TARGET][1] || "?"})`;
  const chip = $("modeChip");
  if (mode === "daily") chip.classList.add("hidden");
  else {
    chip.classList.remove("hidden");
    chip.textContent = MODE_LABEL[mode] || "";
  }
  $("puzzleNo").textContent =
    mode === "daily"
      ? `Puzzle #${PUZZLE_NO} · ${dayKey}`
      : mode === "random"
      ? "🎲 Random game"
      : "🎬 Pick-a-starter";
}
/** start (or resume) a game described by desc */
function startGame(desc, resume) {
  applyGame(desc);
  persistGame();
  state.chain = [{ t: "m", id: START }];
  state.startedAt = Date.now();
  state.solvedAt = null;
  state.hints = 0;
  state.gaveUp = false;
  state.filterPerson = null;
  ui.castExpanded = false;
  ui.expandedGroups.clear();
  ui.castQ = "";
  ui.creditQ = "";
  if (resume) restore(); // pick up an existing save for this game (daily)
  resetSearch();
  render();
  updateGameUI();
  window.scrollTo({ top: 0 });
}
/** pick-a-starter: chosen start film, random reachable target */
function setupPick(mid) {
  const r = pickRandomTarget(mid);
  if (!r) {
    toast("No reachable target from that film — pick another", "err");
    return;
  }
  closeSearch();
  startGame({ m: "pick", s: mid, t: r.t, p: r.p });
  toast(`Start: ${MOVIES[mid][0]} — target assigned 🎯`, "ok");
}

/* ---------------- daily puzzle ---------------- */
function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return h >>> 0;
}
const dayKey = new Date().toISOString().slice(0, 10);
const PUZZLE_IDX = hashStr(dayKey) % D.puzzles.length;
const [D_START, D_TARGET, D_MOVIE_PAR] = D.puzzles[PUZZLE_IDX];
const PUZZLE_NO =
  Math.floor((Date.parse(dayKey + "T00:00:00Z") - Date.UTC(2026, 0, 1)) / 86400000) + 1;

const SEEN_KEY = "bl:seen-howto-v3";
const GAME_KEY = "bl:game";
const DAILY_DESC = { m: "daily" };

/* ---- active game: daily | random | pick ---- */
let mode = "daily";
let START = D_START;
let TARGET = D_TARGET;
let PAR = D_MOVIE_PAR * 2; // bipartite links: film—artist—film counts 2
let SAVE_KEY = "bl:v2:" + dayKey;
let BEST_KEY = "bl:best:" + dayKey;

function applyGame(desc) {
  if (!desc || desc.m === "daily") {
    mode = "daily";
    START = D_START;
    TARGET = D_TARGET;
    PAR = D_MOVIE_PAR * 2;
    SAVE_KEY = "bl:v2:" + dayKey;
    BEST_KEY = "bl:best:" + dayKey;
  } else {
    mode = desc.m;
    START = desc.s;
    TARGET = desc.t;
    PAR = desc.p;
    SAVE_KEY = "bl:v2:fx:" + START + "-" + TARGET;
    BEST_KEY = "bl:best:fx:" + START + "-" + TARGET;
  }
}
function loadGameDesc() {
  try {
    const raw = localStorage.getItem(GAME_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d) return null;
    if (d.m === "daily") return DAILY_DESC;
    if (
      (d.m === "random" || d.m === "pick") &&
      Number.isInteger(d.s) && Number.isInteger(d.t) &&
      MOVIES[d.s] && MOVIES[d.t] && d.p >= 2
    )
      return d;
  } catch (_) {}
  return null;
}
function persistGame() {
  try {
    localStorage.setItem(
      GAME_KEY,
      JSON.stringify(mode === "daily" ? DAILY_DESC : { m: mode, s: START, t: TARGET, p: PAR })
    );
  } catch (_) {}
}
applyGame(loadGameDesc()); // resume last game (daily by default)

/* ---------------- state ---------------- */
const state = {
  chain: [{ t: "m", id: START }],
  startedAt: Date.now(),
  solvedAt: null,
  hints: 0,
  gaveUp: false,
  filterPerson: null,
};
/** transient UI state (filters, sorting, expansion) */
const ui = {
  castExpanded: false,
  expandedGroups: new Set(),
  sort: "new",
  castQ: "",
  creditQ: "",
  picker: false, // true while choosing a start film
};

function save() {
  try {
    localStorage.setItem(
      SAVE_KEY,
      JSON.stringify({
        chain: state.chain.map((n) => [n.t, n.id]),
        startedAt: state.startedAt,
        solvedAt: state.solvedAt,
        hints: state.hints,
        gaveUp: state.gaveUp,
      })
    );
  } catch (_) {}
}
/** old v1 saves were plain movie-index chains -> expand with artists */
function migrateChain(raw) {
  if (!Array.isArray(raw) || !raw.length) return null;
  if (Array.isArray(raw[0])) {
    const chain = raw.map((n) => ({ t: n[0], id: n[1] }));
    return chain.every((n) => (n.t === "m" && MOVIES[n.id]) || (n.t === "p" && PEOPLE[n.id]))
      ? chain
      : null;
  }
  // legacy: [movieIdx, movieIdx, ...] -> insert the shared artist between hops
  if (!raw.every((i) => Number.isInteger(i) && MOVIES[i])) return null;
  const chain = [{ t: "m", id: raw[0] }];
  for (let i = 1; i < raw.length; i++) {
    const shared = sharedPeople(raw[i - 1], raw[i]);
    if (shared.length) chain.push({ t: "p", id: shared[0] });
    chain.push({ t: "m", id: raw[i] });
  }
  return chain;
}
function restore() {
  try {
    const raw = localStorage.getItem(SAVE_KEY) || localStorage.getItem("bl:state:" + dayKey);
    if (!raw) return;
    const s = JSON.parse(raw);
    const chain = migrateChain(s.chain);
    if (!chain || chain[0].t !== "m" || chain[0].id !== START) return;
    state.chain = chain;
    state.startedAt = s.startedAt || Date.now();
    state.solvedAt = s.solvedAt || null;
    state.hints = s.hints || 0;
    state.gaveUp = !!s.gaveUp;
  } catch (_) {}
}
restore();

const isSolved = () => state.solvedAt !== null;
const elapsedMs = () => (isSolved() ? state.solvedAt : Date.now()) - state.startedAt;
const currentNode = () => state.chain[state.chain.length - 1];
const chainHasMovie = (mid) => state.chain.some((n) => n.t === "m" && n.id === mid);

/* validity of a move from the current node */
function canAddPerson(pid) {
  const cur = currentNode();
  return cur.t === "m" && MOVIES[cur.id][10].includes(pid);
}
function canAddMovie(mid) {
  const cur = currentNode();
  if (cur.t === "m" && cur.id === mid) return false;
  if (cur.t === "p") return personMovies[cur.id].includes(mid);
  return sharedPeople(cur.id, mid).length > 0;
}

/* ---------------- helpers ---------------- */
const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
const fmtTime = (ms) => {
  const t = Math.max(0, Math.floor(ms / 1000));
  return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0");
};
const fmtTime10 = (ms) => {
  const t = Math.max(0, ms);
  const m = Math.floor(t / 60000);
  const s = Math.floor((t % 60000) / 1000);
  const d = Math.floor((t % 1000) / 100);
  return m + ":" + String(s).padStart(2, "0") + "." + d;
};
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function prettyDate(rd) {
  if (!rd) return "";
  const m = rd.match(/^(\d{4}),\s*(\d{1,2}),\s*(\d{1,2})$/);
  if (m) return `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}`;
  return rd.length > 24 ? rd.slice(0, 24) + "…" : rd;
}
function wikiTitle(m) {
  const u = m[2] || "";
  const i = u.indexOf("/wiki/");
  if (i < 0) return null;
  let t = u.slice(i + 6);
  try { t = decodeURIComponent(t); } catch (_) {}
  return t.replace(/_/g, " ");
}
let toastTimer = null;
function toast(msg, kind = "") {
  const el = $("toast");
  el.textContent = msg;
  clearTimeout(toastTimer);
  el.className = "toast";
  void el.offsetWidth;
  el.classList.add("show");
  if (kind) el.classList.add(kind);
  toastTimer = setTimeout(() => {
    el.classList.add("hidden");
    el.classList.remove("show", "err", "ok");
  }, 2600);
}

/* ---------------- posters / avatars / hero backdrops ---------------- */
const posterCache = new Map();
function loadArt(key, kind, apply) {
  if (!key) return;
  const run = (src) => { if (src) apply(src); };
  if (posterCache.has(key)) { run(posterCache.get(key)); return; }
  const api =
    "https://en.wikipedia.org/w/api.php?action=query&generator=images" +
    "&gimlimit=12&prop=imageinfo&iiprop=url|mime&iiurlwidth=400&format=json" +
    "&origin=*&titles=" + encodeURIComponent(key);
  fetch(api)
    .then((r) => r.json())
    .then((j) => {
      const pages = Object.values((j.query && j.query.pages) || {});
      const cands = pages.filter((p) => {
        const file = p.title.replace(/^File:/i, "");
        return p.imageinfo && p.imageinfo[0].thumburl && /\.(jpe?g|png)$/i.test(file);
      });
      const score = (p) => {
        const n = p.title.toLowerCase();
        let s = 0;
        if (n.includes("poster")) s += 10;
        if (n.includes("film") || n.includes("movie")) s += 2;
        if (/\.jpe?g$/.test(n)) s += 3;
        if (/logo|flag|icon|edit|ambox|cscr|commons|wiki|banner|map|symbol/.test(n)) s -= 25;
        if (kind === "p") {
          if (n.includes("poster")) s -= 20;
          const words = key.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
          if (words.some((w) => n.includes(w))) s += 8;
        }
        return s;
      };
      cands.sort((a, b) => score(b) - score(a));
      const src = cands.length ? cands[0].imageinfo[0].thumburl : null;
      posterCache.set(key, src);
      run(src);
    })
    .catch(() => posterCache.set(key, null));
}
function mountImg(src, host) {
  if (!host.isConnected) return;
  const img = document.createElement("img");
  img.src = src;
  img.alt = "";
  img.loading = "lazy";
  img.onload = () => { host.innerHTML = ""; host.appendChild(img); };
  host.appendChild(img);
}
const loadPoster = (movieIdx, host) =>
  loadArt(wikiTitle(MOVIES[movieIdx]), "m", (src) => mountImg(src, host));
const loadAvatar = (pid, host) => loadArt(PEOPLE[pid], "p", (src) => mountImg(src, host));
const loadArtBg = (key, kind, host) =>
  loadArt(key, kind, (src) => { if (host.isConnected) host.style.backgroundImage = `url("${src}")`; });

/* ---------------- rendering ---------------- */
const grad = (seedStr) => "g" + (hashStr(seedStr) % 6);
const avGrad = (seedStr) => "av" + (hashStr(seedStr) % 6);
const PERSON_ICON =
  `<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path fill="currentColor" d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/></svg>`;

function personPill(pid) {
  return (
    `<button class="person-pill" data-travel-person="${pid}" ` +
    `title="Travel through ${esc(PEOPLE[pid])}">${PERSON_ICON}${esc(PEOPLE[pid])}</button>`
  );
}

/* ---- sidebar (YOUR CHAIN timeline) ---- */
function renderSidebar() {
  $("chainList").innerHTML = state.chain
    .map((n, i) => {
      const last = i === state.chain.length - 1;
      const name = n.t === "m" ? MOVIES[n.id][0] : PEOPLE[n.id];
      const cls = [
        n.t === "m" ? "film" : "person",
        last ? "current" : "",
        n.t === "m" && n.id === TARGET ? "is-target" : "",
      ].join(" ");
      return `<li class="${cls}"><span class="tl-dot"></span><span class="tl-card" title="${esc(name)}">${esc(name)}</span></li>`;
    })
    .join("");
}

/* ---- hero: FILM ---- */
function filmHeroHTML(mid) {
  const m = MOVIES[mid];
  const isTarget = mid === TARGET;
  const rd = prettyDate(m[3]);
  const rows = [];
  const row = (label, cls, pids) => {
    if (!pids.length) return;
    rows.push(
      `<div class="cr-row ${cls}"><span class="cr-label">${label}</span>` +
      `<div class="cr-people">${pids.map(personPill).join("")}</div></div>`
    );
  };
  row("DIRECTOR", "director", m[5]);
  row("WRITER", "writer", m[6]);
  row("PRODUCER", "producer", m[7]);
  row("SCORE", "score", m[8]);
  row("STARS", "stars", m[9].slice(0, 4));

  const pills = [];
  if (rd) pills.push(`<span class="hp">📅 ${esc(rd)}</span>`);
  if (m[4]) pills.push(`<span class="hp">🏢 ${esc(m[4])}</span>`);
  if (m[2]) pills.push(`<a class="hp" href="${esc(m[2])}" target="_blank" rel="noopener">Wikipedia ↗</a>`);

  return `
  <section class="hero film-hero">
    <div class="hero-bg" data-hero-bg="${mid}"></div>
    <div class="hero-poster ${grad(m[0])}" data-poster="${mid}"><span>${esc(
      (m[0] || "?").trim().charAt(0).toUpperCase()
    )}</span></div>
    <div class="hero-main">
      <div class="hero-title">
        <h2>${esc(m[0])}</h2>${m[1] ? `<span class="hero-year">${m[1]}</span>` : ""}
      </div>
      ${isTarget ? `<span class="hero-flag">🎯 TARGET${isSolved() ? " REACHED" : ""}</span>` : ""}
      ${pills.length ? `<div class="hero-pills">${pills.join("")}</div>` : ""}
      ${
        rows.length
          ? `<div class="credit-rows">${rows.join("")}</div>`
          : `<div class="hero-empty">No credits recorded for this film.</div>`
      }
    </div>
  </section>`;
}

/* ---- hero: PERSON ---- */
function personHeroHTML(pid) {
  const name = PEOPLE[pid];
  const films = [...personMovies[pid]].sort((a, b) => (MOVIES[b][1] || 0) - (MOVIES[a][1] || 0));
  const known = films.slice(0, 6);
  const tiles = known
    .map((mid) => {
      const mm = MOVIES[mid];
      const isT = mid === TARGET;
      return `
      <button class="known-tile${isT ? " is-target" : ""}" data-travel-film="${mid}" title="Go to ${esc(mm[0])}">
        <div class="known-frame">
          <div class="known-poster ${grad(mm[0])}" data-poster="${mid}"><span>${esc(
            (mm[0] || "?").trim().charAt(0).toUpperCase()
          )}</span></div>
          <span class="known-meta"><span>${mm[1] || ""}</span>${isT ? "<span>🎯 TARGET</span>" : ""}</span>
        </div>
        <div class="known-title">${esc(mm[0])}</div>
        <div class="known-role">${esc(creditType(mid, pid))}</div>
      </button>`;
    })
    .join("");

  const prev = state.chain[state.chain.length - 2];
  const via = prev && prev.t === "m" ? creditType(prev.id, pid) : "";

  return `
  <section class="hero person-hero">
    <div class="hero-bg" data-hero-bg-person="${pid}"></div>
    <div class="hero-photo ${avGrad(name)}" data-avatar="${pid}"><span>${esc(
      name.trim().charAt(0).toUpperCase()
    )}</span></div>
    <div class="hero-main">
      <div class="hero-title"><h2>${esc(name)}</h2></div>
      <div class="hero-pills">
        <span class="hp gold">${films.length} film${films.length === 1 ? "" : "s"}</span>
        ${via ? `<span class="hp">${PERSON_ICON} ${esc(via)}</span>` : ""}
      </div>
      <div class="known-label">KNOWN FOR</div>
      ${
        known.length
          ? `<div class="known-row">${tiles}</div>`
          : `<div class="hero-empty">No films recorded for this artist.</div>`
      }
    </div>
  </section>`;
}

/* ---- below: CAST (when a film is selected) ---- */
function castSectionHTML(mid) {
  const cast = MOVIES[mid][9];
  const head = (count) => `
  <div class="section-head">
    <h3>CAST <span class="count">${count}</span></h3>
    <div class="filter-box">
      <input id="castFilter" type="text" placeholder="Filter cast…" autocomplete="off" spellcheck="false">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z"/></svg>
    </div>
  </div>`;
  if (!cast.length)
    return head(0) + `<div class="empty-note">No cast recorded for this film in the database.</div>`;

  const cards = cast
    .map((pid, i) => {
      const n = personMovies[pid].length;
      const inChain = state.chain.some((x) => x.t === "p" && x.id === pid);
      return `
    <button class="person-card" data-travel-person="${pid}" data-idx="${i}">
      <span class="avatar ${avGrad(PEOPLE[pid])}" data-avatar="${pid}"><span>${esc(
        PEOPLE[pid].trim().charAt(0).toUpperCase()
      )}</span></span>
      <span class="pc-main">
        <span class="pc-name">${esc(PEOPLE[pid])}</span>
        <span class="pc-sub">${esc(creditType(mid, pid))} · ${n} film${n === 1 ? "" : "s"}</span>
      </span>
      ${inChain ? `<span class="pc-inchain">IN CHAIN</span>` : ""}
      <span class="pc-go">→</span>
    </button>`;
    })
    .join("");

  const more =
    cast.length > 12
      ? `<button class="show-more" id="castMore">Show all ${cast.length} cast members</button>`
      : "";

  return head(cast.length) + `<div class="cast-grid" id="castGrid">${cards}</div>` + more;
}

/* ---- below: CREDITS (when an artist is selected) ---- */
function creditsSectionHTML(pid) {
  const films = personMovies[pid];
  const head = `
  <div class="section-head">
    <h3>CREDITS <span class="count">${films.length}</span></h3>
    <div class="filter-box">
      <input id="creditFilter" type="text" placeholder="Filter credits…" autocomplete="off" spellcheck="false">
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z"/></svg>
    </div>
    <div class="sort-box">
      <span class="sort-label">SORT:</span>
      <button class="sort-btn${ui.sort === "new" ? " on" : ""}" data-sort="new">Newest</button>
      <button class="sort-btn${ui.sort === "old" ? " on" : ""}" data-sort="old">Oldest</button>
      <button class="sort-btn${ui.sort === "az" ? " on" : ""}" data-sort="az">A–Z</button>
    </div>
  </div>`;
  if (!films.length) return head + `<div class="empty-note">No films recorded for this artist.</div>`;

  const buckets = { cast: [], director: [], writer: [], producer: [], music: [] };
  films.forEach((mid) => {
    const m = MOVIES[mid];
    if (m[9].includes(pid)) buckets.cast.push(mid);
    if (m[5].includes(pid)) buckets.director.push(mid);
    if (m[6].includes(pid)) buckets.writer.push(mid);
    if (m[7].includes(pid)) buckets.producer.push(mid);
    if (m[8].includes(pid)) buckets.music.push(mid);
  });

  const sortFn =
    ui.sort === "old"
      ? (a, b) => (MOVIES[a][1] || 0) - (MOVIES[b][1] || 0)
      : ui.sort === "az"
      ? (a, b) => MOVIES[a][0].localeCompare(MOVIES[b][0])
      : (a, b) => (MOVIES[b][1] || 0) - (MOVIES[a][1] || 0);

  const order = [
    ["ACTOR", "cast"],
    ["DIRECTOR", "director"],
    ["WRITER", "writer"],
    ["PRODUCER", "producer"],
    ["MUSIC", "music"],
  ];

  const groupsHTML = order
    .filter(([, key]) => buckets[key].length)
    .map(([label, key]) => {
      const list = [...buckets[key]].sort(sortFn);
      const cards = list
        .map((mid) => {
          const mm = MOVIES[mid];
          const isT = mid === TARGET;
          return `
      <button class="credit-card" data-travel-film="${mid}" data-group="${key}">
        <span class="cc-poster ${grad(mm[0])}" data-poster="${mid}"><span>${esc(
          (mm[0] || "?").trim().charAt(0).toUpperCase()
        )}</span></span>
        <span class="cc-main">
          <span class="cc-title">${esc(mm[0])}</span>
          <span class="cc-sub">${esc(creditType(mid, pid))}</span>
        </span>
        <span class="cc-year">${isT ? `<span class="cc-target">🎯 TARGET · </span>` : ""}${
          mm[1] || ""
        }</span>
      </button>`;
        })
        .join("");
      const showAll =
        list.length > 6
          ? `<button class="show-all" data-group="${key}">${
              ui.expandedGroups.has(key) ? "Show less" : "Show all"
            }</button>`
          : "";
      return `
    <div class="credits-group">
      <div class="cg-head">
        <h4>${label} <span class="cg-count">${list.length} CREDIT${list.length === 1 ? "" : "S"}</span></h4>
        ${showAll}
      </div>
      <div class="credit-grid" data-group="${key}">${cards}</div>
    </div>`;
    })
    .join("");

  return head + groupsHTML;
}

/* ---- shared: lazy-load art inside hero/below ---- */
function mountArts() {
  document.querySelectorAll("[data-poster]").forEach((el) => loadPoster(+el.dataset.poster, el));
  document.querySelectorAll("[data-avatar]").forEach((el) => loadAvatar(+el.dataset.avatar, el));
  document.querySelectorAll("[data-hero-bg]").forEach((el) =>
    loadArtBg(wikiTitle(MOVIES[+el.dataset.heroBg]), "m", el)
  );
  document.querySelectorAll("[data-hero-bg-person]").forEach((el) =>
    loadArtBg(PEOPLE[+el.dataset.heroBgPerson], "p", el)
  );
}

/* ---- cap + filter visibility ---- */
function updateLists() {
  const castEl = $("castFilter");
  const castQ = ((castEl && castEl.value) || ui.castQ || "").trim().toLowerCase();
  const grid = $("castGrid");
  if (grid) {
    [...grid.children].forEach((el, i) => {
      const match = !castQ || el.textContent.toLowerCase().includes(castQ);
      const within = castQ || ui.castExpanded || i < 12;
      el.classList.toggle("hide", !(match && within));
    });
  }
  const creditEl = $("creditFilter");
  const creditQ = ((creditEl && creditEl.value) || ui.creditQ || "").trim().toLowerCase();
  document.querySelectorAll(".credit-grid").forEach((g) => {
    const exp = ui.expandedGroups.has(g.dataset.group);
    [...g.children].forEach((el, i) => {
      const match = !creditQ || el.textContent.toLowerCase().includes(creditQ);
      const within = creditQ || exp || i < 6;
      el.classList.toggle("hide", !(match && within));
    });
  });
}

/* ---- main render ---- */
function render() {
  ui.castExpanded = false;
  ui.expandedGroups.clear();
  ui.castQ = "";
  ui.creditQ = "";

  renderSidebar();
  const cur = currentNode();
  $("hero").innerHTML = cur.t === "m" ? filmHeroHTML(cur.id) : personHeroHTML(cur.id);
  $("below").innerHTML = cur.t === "m" ? castSectionHTML(cur.id) : creditsSectionHTML(cur.id);
  mountArts();

  $("hops").textContent = String(state.chain.length - 1);
  $("parInfo").textContent = ` / par ${PAR}`;
  $("undoBtn").disabled = state.chain.length < 2 || isSolved();
  $("restartBtn").disabled = isSolved();
  $("hintBtn").disabled = isSolved();
  updateLists();
  save();
}
function renderBelowOnly() {
  const cur = currentNode();
  $("below").innerHTML = cur.t === "m" ? castSectionHTML(cur.id) : creditsSectionHTML(cur.id);
  mountArts();
  if ($("castFilter")) $("castFilter").value = ui.castQ;
  if ($("creditFilter")) $("creditFilter").value = ui.creditQ;
  updateLists();
}

/* ---------------- timer ---------------- */
setInterval(() => { $("timer").textContent = fmtTime10(elapsedMs()); }, 200);

/* ---------------- moves ---------------- */
function invalid(el, msg) {
  const target = el || document.querySelector(".hero");
  if (target) {
    target.classList.remove("shake");
    void target.offsetWidth;
    target.classList.add("shake");
  }
  toast(msg, "err");
}
function afterMove() {
  resetSearch();
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function travelPerson(pid, el) {
  if (isSolved()) { toast("Puzzle already solved ✅"); return; }
  const cur = currentNode();
  if (cur.t === "p" && cur.id === pid) { toast("You're already with this artist"); return; }
  if (cur.t === "p") {
    invalid(el, `You're travelling through ${PEOPLE[cur.id]} — pick one of their films`);
    return;
  }
  if (!MOVIES[cur.id][10].includes(pid)) {
    invalid(el, `${PEOPLE[pid]} has no credit on ${MOVIES[cur.id][0]}`);
    return;
  }
  state.chain.push({ t: "p", id: pid });
  afterMove();
  toast(`Travelling through ${PEOPLE[pid]} ✈️`, "ok");
}
function travelFilm(mid, el) {
  if (isSolved()) { toast("Puzzle already solved ✅"); return; }
  const cur = currentNode();
  if (cur.t === "m" && cur.id === mid) { toast("You're already on this film"); return; }

  if (cur.t === "p") {
    if (!personMovies[cur.id].includes(mid)) {
      invalid(el, `${PEOPLE[cur.id]} has no credit on ${MOVIES[mid][0]}`);
      return;
    }
    state.chain.push({ t: "m", id: mid });
  } else {
    const shared = sharedPeople(cur.id, mid);
    if (!shared.length) {
      invalid(el, `No shared artist between “${MOVIES[cur.id][0]}” and “${MOVIES[mid][0]}”`);
      return;
    }
    state.chain.push({ t: "p", id: shared[0] }); // the connecting artist joins the chain
    state.chain.push({ t: "m", id: mid });
  }
  afterMove();
  if (mid === TARGET) win();
  else toast(`Linked via ${MOVIES[mid][0]}`, "ok");
}

/* travel clicks are delegated (hero pills, known tiles, cast + credit cards) */
document.addEventListener("click", (e) => {
  const p = e.target.closest("[data-travel-person]");
  if (p) { travelPerson(+p.dataset.travelPerson, p); return; }
  const f = e.target.closest("[data-travel-film]");
  if (f) { travelFilm(+f.dataset.travelFilm, f); return; }
});

/* ---------------- search overlay ---------------- */
const searchInput = $("search");
const resultsBox = $("results");

function filmRow(idx) {
  const m = MOVIES[idx];
  const inChain = chainHasMovie(idx);
  const isHere = currentNode().t === "m" && currentNode().id === idx;
  const conn = canAddMovie(idx);
  const isT = idx === TARGET;
  let badge;
  if (isHere) badge = `<span class="badge no">here</span>`;
  else if (inChain) badge = `<span class="badge no">in chain</span>`;
  else if (isT && conn) badge = `<span class="badge target">🎯 connect!</span>`;
  else if (conn) badge = `<span class="badge ok">✓ link</span>`;
  else badge = `<span class="badge no">no link</span>`;
  return `
    <button class="res" data-film="${idx}">
      <span class="r-emoji">🎬</span>
      <span class="r-main">
        <span class="r-title">${esc(m[0])}</span>
        <span class="r-sub">${m[1] || ""} · ${m[10].length} credits</span>
      </span>${badge}
    </button>`;
}
function personRow(pid) {
  const films = personMovies[pid];
  const valid = canAddPerson(pid);
  const here = currentNode().t === "p" && currentNode().id === pid;
  let badge;
  if (here) badge = `<span class="badge no">here</span>`;
  else if (valid) badge = `<span class="badge ok">✓ travel</span>`;
  else badge = `<span class="badge no">browse</span>`;
  return `
    <button class="res" data-person="${pid}">
      <span class="r-emoji">⭐</span>
      <span class="r-main">
        <span class="r-title">${esc(PEOPLE[pid])}</span>
        <span class="r-sub">${films.length} film${films.length === 1 ? "" : "s"} in the database</span>
      </span>${badge}
    </button>`;
}
function renderResults() {
  const cur = currentNode();
  const q = searchInput.value.trim().toLowerCase();
  let html = "";

  /* browsing one artist's filmography */
  if (state.filterPerson !== null) {
    const pid = state.filterPerson;
    const films = [...personMovies[pid]].sort((a, b) => (MOVIES[b][1] || 0) - (MOVIES[a][1] || 0));
    html += `<div class="res-group">FILMS OF ${esc(PEOPLE[pid].toUpperCase())} — ${films.length}</div>`;
    html += films.slice(0, 40).map(filmRow).join("");
    if (!films.length) html += `<div class="res-empty">No films found for this artist.</div>`;
    resultsBox.innerHTML = html;
    bindResults();
    return;
  }

  /* empty query: valid next moves */
  if (!q) {
    if (cur.t === "m") {
      const credits = MOVIES[cur.id][10].slice(0, 6);
      html += `<div class="res-group">ARTISTS ON ${esc(MOVIES[cur.id][0].toUpperCase())}</div>`;
      html += credits.map(personRow).join("");
      const films = [];
      const seen = new Set();
      for (const pid of MOVIES[cur.id][10]) {
        for (const mid of personMovies[pid]) {
          if (mid === cur.id || seen.has(mid)) continue;
          seen.add(mid);
          films.push(mid);
        }
      }
      films.sort((a, b) => (MOVIES[b][1] || 0) - (MOVIES[a][1] || 0));
      html += `<div class="res-group">FILMS LINKED TO ${esc(MOVIES[cur.id][0].toUpperCase())}</div>`;
      html += films.slice(0, 6).map(filmRow).join("");
    } else {
      const films = [...personMovies[cur.id]].sort(
        (a, b) => (MOVIES[b][1] || 0) - (MOVIES[a][1] || 0)
      );
      html += `<div class="res-group">FILMS OF ${esc(PEOPLE[cur.id].toUpperCase())}</div>`;
      html += films.slice(0, 8).map(filmRow).join("");
      if (!films.length) html += `<div class="res-empty">No films recorded for this artist.</div>`;
    }
    resultsBox.innerHTML = html;
    bindResults();
    return;
  }

  /* typed query: films + artists */
  const filmHits = [];
  for (let i = 0; i < lcTitles.length && filmHits.length < 40; i++) {
    const t = lcTitles[i];
    let s = -1;
    if (t.startsWith(q)) s = 0;
    else if (t.includes(q)) s = t.includes(" " + q) ? 1 : 2;
    if (s >= 0) filmHits.push([s, i]);
  }
  filmHits.sort((a, b) => a[0] - b[0] || (MOVIES[b[1]][1] || 0) - (MOVIES[a[1]][1] || 0));
  const topFilms = filmHits.slice(0, 8).map((x) => x[1]);

  const personHits = [];
  for (let i = 0; i < lcPeople.length && personHits.length < 20; i++) {
    const n = lcPeople[i];
    let s = -1;
    if (n.startsWith(q)) s = 0;
    else if (n.includes(q)) s = 1;
    if (s >= 0) personHits.push([s, i]);
  }
  personHits.sort((a, b) => a[0] - b[0]);
  const topPeople = personHits.slice(0, 5).map((x) => x[1]);

  if (topPeople.length) {
    html += `<div class="res-group">ARTISTS</div>`;
    html += topPeople.map(personRow).join("");
  }
  if (topFilms.length) {
    html += `<div class="res-group">MOVIES</div>`;
    html += topFilms.map(filmRow).join("");
  }
  if (!topFilms.length && !topPeople.length)
    html = `<div class="res-empty">No match for “${esc(searchInput.value.trim())}”.</div>`;

  resultsBox.innerHTML = html;
  bindResults();
}
function bindResults() {
  resultsBox.querySelectorAll("[data-film]").forEach((el) =>
    el.addEventListener("click", () => travelFilm(+el.dataset.film, el))
  );
  resultsBox.querySelectorAll("[data-person]").forEach((el) =>
    el.addEventListener("click", () => {
      const pid = +el.dataset.person;
      if (canAddPerson(pid)) travelPerson(pid, el);
      else showFilmography(pid);
    })
  );
}
function openSearch() {
  ui.picker = false;
  searchInput.placeholder = "Search a film or an artist…";
  $("searchOverlay").classList.remove("hidden");
  renderResults();
  resultsBox.classList.remove("hidden");
  searchInput.focus();
}
function closeSearch() {
  $("searchOverlay").classList.add("hidden");
  ui.picker = false;
  searchInput.placeholder = "Search a film or an artist…";
}
function showFilmography(pid) {
  state.filterPerson = pid;
  openSearch();
  searchInput.value = PEOPLE[pid];
  $("clearFilter").classList.remove("hidden");
  renderResults();
  searchInput.focus();
}
function resetSearch() {
  $("searchOverlay").classList.add("hidden");
  resultsBox.classList.add("hidden");
  searchInput.value = "";
  searchInput.placeholder = "Search a film or an artist…";
  state.filterPerson = null;
  ui.picker = false;
  $("clearFilter").classList.add("hidden");
}
/* ---- pick-a-starter mode ---- */
function pickRow(idx) {
  const m = MOVIES[idx];
  return `
    <button class="res" data-pick="${idx}">
      <span class="r-emoji">🎬</span>
      <span class="r-main">
        <span class="r-title">${esc(m[0])}</span>
        <span class="r-sub">${m[1] || ""} · ${m[10].length} credits</span>
      </span><span class="badge ok">pick</span>
    </button>`;
}
function randomFilmSample(n) {
  const out = new Set();
  let guard = 0;
  while (out.size < n && guard++ < n * 30) out.add((Math.random() * MOVIES.length) | 0);
  return [...out];
}
function renderPicker() {
  const q = searchInput.value.trim().toLowerCase();
  let hits = [];
  if (q) {
    for (let i = 0; i < lcTitles.length && hits.length < 40; i++) {
      const t = lcTitles[i];
      let s = -1;
      if (t.startsWith(q)) s = 0;
      else if (t.includes(q)) s = t.includes(" " + q) ? 1 : 2;
      if (s >= 0) hits.push([s, i]);
    }
    hits.sort((a, b) => a[0] - b[0] || (MOVIES[b[1]][1] || 0) - (MOVIES[a[1]][1] || 0));
    hits = hits.slice(0, 30).map((x) => x[1]);
  } else {
    hits = randomFilmSample(14);
  }
  const head = q
    ? `🎬 FILMS MATCHING “${esc(searchInput.value.trim().toUpperCase())}” — tap to start`
    : `🎬 SUGGESTED START FILMS — tap one, we'll pick your target`;
  resultsBox.innerHTML =
    `<div class="res-group">${head}</div>` +
    (hits.length
      ? hits.map(pickRow).join("")
      : `<div class="res-empty">No film matches that.</div>`);
  resultsBox.querySelectorAll("[data-pick]").forEach((el) =>
    el.addEventListener("click", () => setupPick(+el.dataset.pick))
  );
}
function openPicker() {
  ui.picker = true;
  state.filterPerson = null;
  $("clearFilter").classList.add("hidden");
  searchInput.value = "";
  searchInput.placeholder = "Pick your start film — search or tap one…";
  $("searchOverlay").classList.remove("hidden");
  renderPicker();
  resultsBox.classList.remove("hidden");
  searchInput.focus();
}
searchInput.addEventListener("input", () => {
  if (ui.picker) {
    renderPicker();
    resultsBox.classList.remove("hidden");
    return;
  }
  if (state.filterPerson !== null && searchInput.value !== PEOPLE[state.filterPerson]) {
    state.filterPerson = null;
    $("clearFilter").classList.add("hidden");
  }
  renderResults();
  resultsBox.classList.remove("hidden");
});
searchInput.addEventListener("focus", () => {
  if (ui.picker) {
    renderPicker();
    resultsBox.classList.remove("hidden");
    return;
  }
  renderResults();
  resultsBox.classList.remove("hidden");
});
searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSearch();
  if (e.key === "Enter") {
    if (ui.picker) {
      const first = resultsBox.querySelector("[data-pick]");
      if (first) first.click();
      return;
    }
    const first = [...resultsBox.querySelectorAll("[data-film],[data-person]")].find(
      (el) => !el.querySelector(".badge.no")
    );
    if (first) first.click();
  }
});
$("clearFilter").addEventListener("click", () => {
  state.filterPerson = null;
  searchInput.value = "";
  $("clearFilter").classList.add("hidden");
  if (ui.picker) renderPicker();
  else renderResults();
  searchInput.focus();
});
$("targetPill").addEventListener("click", openSearch);
$("ovClose").addEventListener("click", closeSearch);
$("searchOverlay").addEventListener("click", (e) => {
  if (e.target === $("searchOverlay")) closeSearch();
});
document.addEventListener("keydown", (e) => {
  const overlayOpen = !$("searchOverlay").classList.contains("hidden");
  if (e.key === "Escape" && overlayOpen) closeSearch();
  if (e.key === "/" && !overlayOpen && document.activeElement !== searchInput) {
    e.preventDefault();
    openSearch();
  }
});

/* ---------------- below-section interactions (filters / sort / show-all) ---------------- */
$("below").addEventListener("click", (e) => {
  const sort = e.target.closest("[data-sort]");
  if (sort) {
    ui.sort = sort.dataset.sort;
    renderBelowOnly();
    return;
  }
  const show = e.target.closest(".show-all");
  if (show) {
    const g = show.dataset.group;
    if (ui.expandedGroups.has(g)) ui.expandedGroups.delete(g);
    else ui.expandedGroups.add(g);
    show.textContent = ui.expandedGroups.has(g) ? "Show less" : "Show all";
    updateLists();
    return;
  }
  const more = e.target.closest("#castMore");
  if (more) {
    ui.castExpanded = true;
    more.classList.add("hide");
    updateLists();
  }
});
$("below").addEventListener("input", (e) => {
  if (e.target.id === "castFilter") { ui.castQ = e.target.value; updateLists(); }
  else if (e.target.id === "creditFilter") { ui.creditQ = e.target.value; updateLists(); }
});

/* ---------------- HUD actions ---------------- */
$("undoBtn").addEventListener("click", () => {
  if (state.chain.length < 2 || isSolved()) return;
  state.chain.pop();
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
  toast("Step removed");
});
$("restartBtn").addEventListener("click", () => {
  state.chain = [{ t: "m", id: START }];
  state.hints = 0;
  state.gaveUp = false;
  render();
  window.scrollTo({ top: 0, behavior: "smooth" });
  toast("Chain reset");
});
$("hintBtn").addEventListener("click", () => {
  if (isSolved()) return;
  const path = bfsToTarget(currentNode(), TARGET);
  if (!path || path.length < 2) { toast("No path found 😕", "err"); return; }
  state.hints++;
  const next = path[1];
  if (next.t === "p") travelPerson(next.id);
  else travelFilm(next.id);
  toast(
    `💡 Hint — ${
      next.t === "p" ? "travel through " + PEOPLE[next.id] : "go to " + MOVIES[next.id][0]
    }`,
    "ok"
  );
});
$("giveupBtn").addEventListener("click", () => {
  if (isSolved()) return;
  const path = bfsToTarget({ t: "m", id: START }, TARGET);
  if (!path) { toast("No path found 😕", "err"); return; }
  state.gaveUp = true;
  save();
  $("solSub").textContent = `The shortest connection needs ${path.length - 1} links:`;
  $("solPath").innerHTML = path
    .map((n, i) => (i ? `<span class="wp-arrow">→</span>` : "") +
      `<span class="wp${n.t === "p" ? " wp-person" : ""}">${n.t === "m" ? "🎬 " : "⭐ "}${esc(
        n.t === "m" ? MOVIES[n.id][0] : PEOPLE[n.id]
      )}</span>`)
    .join("");
  openModal("solutionModal");
});

/* ---------------- win ---------------- */
function populateWin() {
  const hops = state.chain.length - 1;
  const time = (state.solvedAt || Date.now()) - state.startedAt;

  let best = null;
  try { best = localStorage.getItem(BEST_KEY); } catch (_) {}
  const bestNum = best ? parseInt(best, 10) : null;
  const isNewBest = bestNum === null || time < bestNum;
  if (isNewBest) { try { localStorage.setItem(BEST_KEY, String(time)); } catch (_) {} }

  $("winLinks").textContent = String(hops);
  $("winPar").textContent = String(PAR);
  $("winTime").textContent = fmtTime(time);
  $("winBest").textContent = isNewBest ? "🏆" : fmtTime(bestNum);
  $("winBadge").textContent =
    hops === PAR
      ? "⭐ Perfect — you matched the shortest path!"
      : `${hops - PAR} over par — solid work!` +
        (state.hints ? ` (${state.hints} hint${state.hints > 1 ? "s" : ""} used)` : "");
  $("winPath").innerHTML = state.chain
    .map((n, i) =>
      (i ? `<span class="wp-arrow">→</span>` : "") +
      `<span class="wp${n.t === "p" ? " wp-person" : ""}">${n.t === "m" ? "🎬 " : "⭐ "}${esc(
        n.t === "m" ? MOVIES[n.id][0] : PEOPLE[n.id]
      )}</span>`
    )
    .join("");
}
function win() {
  state.solvedAt = Date.now();
  save();
  populateWin();
  render();
  fireConfetti();
  setTimeout(() => openModal("winModal"), 550);
  if (mode === "daily") startCountdown();
  else {
    clearInterval(startCountdown._t);
    $("countdown").textContent = "🎲 Free play — same start & target whenever you come back";
  }
}
$("shareBtn").addEventListener("click", async () => {
  const hops = state.chain.length - 1;
  const squares = "🟩".repeat(Math.min(hops, 12));
  const text =
    `🎬 ${
      mode === "daily"
        ? "Bollywood Link #" + PUZZLE_NO
        : mode === "random"
        ? "Bollywood Link · Random"
        : "Bollywood Link · Pick-a-starter"
    }\n` +
    `${squares} ${hops}/${PAR} links · ${fmtTime(elapsedMs())}` +
    (state.hints ? ` · 💡${state.hints}` : "") +
    `\n` +
    state.chain
      .map((n) => (n.t === "m" ? MOVIES[n.id][0] : `(${PEOPLE[n.id]})`))
      .join(" → ");
  try {
    await navigator.clipboard.writeText(text);
    toast("Result copied — paste it anywhere 📋", "ok");
  } catch (_) {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
    toast("Result copied 📋", "ok");
  }
});
function startCountdown() {
  const el = $("countdown");
  const tick = () => {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
    const diff = next - now;
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    el.textContent = `Next puzzle in ${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };
  tick();
  clearInterval(startCountdown._t);
  startCountdown._t = setInterval(tick, 1000);
}

/* ---------------- modals ---------------- */
function openModal(id) { $(id).classList.remove("hidden"); }
function closeModal(id) { $(id).classList.add("hidden"); }
document.querySelectorAll("[data-close]").forEach((el) =>
  el.addEventListener("click", () => el.closest(".modal-backdrop").classList.add("hidden"))
);
document.querySelectorAll(".modal-backdrop").forEach((el) =>
  el.addEventListener("click", (e) => { if (e.target === el) el.classList.add("hidden"); })
);
$("howtoBtn").addEventListener("click", () => openModal("howtoModal"));

/* ---------------- Play ▾ dropdown — game modes ---------------- */
const playMenu = $("playMenu");
$("playBtn").addEventListener("click", (e) => {
  e.stopPropagation();
  playMenu.classList.toggle("hidden");
});
document.addEventListener("click", (e) => {
  if (!e.target.closest(".nav-drop")) playMenu.classList.add("hidden");
});
playMenu.querySelectorAll("[data-game]").forEach((el) =>
  el.addEventListener("click", () => {
    playMenu.classList.add("hidden");
    const g = el.dataset.game;
    if (g === "daily") {
      startGame(DAILY_DESC, true); // resumes today's progress if a save exists
      toast(`Puzzle #${PUZZLE_NO} — good luck 🍀`, "ok");
    } else if (g === "random") {
      startGame(randomGameDesc());
      toast("🎲 New random game — good luck!", "ok");
    } else if (g === "pick") {
      openPicker();
    }
  })
);

/* ---------------- theme + nav ---------------- */
let theme = "light";
try { theme = localStorage.getItem("bl:theme") || "light"; } catch (_) {}
function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  try { localStorage.setItem("bl:theme", t); } catch (_) {}
}
applyTheme(theme);
$("themeBtn").addEventListener("click", () => {
  theme = theme === "dark" ? "light" : "dark";
  applyTheme(theme);
});
document.querySelectorAll(".soon").forEach((el) =>
  el.addEventListener("click", () => toast(`${el.dataset.soon} — coming soon 🚧`))
);

/* ---------------- confetti ---------------- */
function fireConfetti() {
  const canvas = $("confetti");
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  ctx.scale(dpr, dpr);
  const colors = ["#f0a93f", "#e2501c", "#8b5cf6", "#2a9d8f", "#ffffff", "#f5c518"];
  const parts = Array.from({ length: 160 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 220,
    y: innerHeight * 0.32,
    vx: (Math.random() - 0.5) * 13,
    vy: Math.random() * -13 - 4,
    w: 6 + Math.random() * 7,
    h: 8 + Math.random() * 9,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.32,
    c: colors[(Math.random() * colors.length) | 0],
  }));
  const t0 = performance.now();
  (function frame(t) {
    const elapsed = t - t0;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    parts.forEach((p) => {
      p.vy += 0.42;
      p.vx *= 0.995;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(0, 1 - elapsed / 2600);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    });
    if (elapsed < 2700) requestAnimationFrame(frame);
    else ctx.clearRect(0, 0, innerWidth, innerHeight);
  })(t0);
}

/* ---------------- boot ---------------- */
function boot() {
  $("menuDailySub").textContent = `Puzzle #${PUZZLE_NO} · ${dayKey}`;
  updateGameUI();
  $("statsLine").textContent =
    `${D.stats.movies.toLocaleString()} films · ${D.stats.people.toLocaleString()} artists`;
  $("timer").textContent = fmtTime10(elapsedMs());
  render();
  if (!localStorage.getItem(SEEN_KEY)) {
    localStorage.setItem(SEEN_KEY, "1");
    setTimeout(() => openModal("howtoModal"), 400);
  }
  if (isSolved()) {
    populateWin();
    if (mode === "daily") startCountdown();
    else $("countdown").textContent = "🎲 Free play — same start & target whenever you come back";
    setTimeout(() => openModal("winModal"), 500);
  }
}
boot();
