"use strict";

// ---------- Keyboard model ----------

const ROWS = ["qwertyuiop", "asdfghjkl;", "zxcvbnm,./"];
const ROW_OFFSET = [0, 0.25, 0.75];
const FINGER_BY_COL = ["pinky", "ring", "middle", "index", "index", "index", "index", "middle", "ring", "pinky"];

const KEYS = {};
ROWS.forEach((row, r) => {
  [...row].forEach((ch, c) => {
    KEYS[ch] = {
      x: c + ROW_OFFSET[r],
      y: r,
      hand: c < 5 ? "L" : "R",
      finger: FINGER_BY_COL[c],
    };
  });
});

const handOf = (ch) => (ch === " " ? "T" : KEYS[ch]?.hand || "?");
const handName = (ch) => ({ L: "left hand", R: "right hand", T: "thumb" })[handOf(ch)] || "?";

function isNeighbor(a, b) {
  const ka = KEYS[a], kb = KEYS[b];
  if (!ka || !kb || a === b) return false;
  return Math.hypot(ka.x - kb.x, ka.y - kb.y) <= 1.3;
}

function isMirror(a, b) {
  const ka = KEYS[a], kb = KEYS[b];
  return !!ka && !!kb && ka.hand !== kb.hand && ka.finger === kb.finger && ka.y === kb.y;
}

// ---------- Persistence ----------

const STORE_KEY = "davisbacon.v1";

function freshData() {
  return {
    findings: {},
    keyStats: {},
    bigrams: {},
    intervals: [],
    spaceIntervals: [],
    pace: { LL: [], RR: [], LR: [], RL: [] },
    transit: {},
    recovery: [],
    repLog: {},
    history: [],
  };
}

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? Object.assign(freshData(), JSON.parse(raw)) : freshData();
  } catch {
    return freshData();
  }
}

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch {}
}

let data = load();

// ---------- Helpers ----------

const pushCapped = (arr, v, cap) => { arr.push(v); if (arr.length > cap) arr.splice(0, arr.length - cap); };
const avg = (arr) => (arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0);
const median = (arr) => {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};
const show = (ch) => (ch === " " ? "␣" : ch);
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const code = (s) => `<code>${esc(show(s))}</code>`;

// Word starts and ends are naturally slower than in-word keys, so each is judged against others of its kind.
function baseline(a, b) {
  const type = transitType(a, b);
  return type === "fromSpace" || type === "toSpace" ? median(data.transit[type] || []) : median(data.intervals);
}

// What kind of movement a transition between two keys is; drives the transit breakdown.
const TRANSIT_TYPES = {
  alt: "Hand switch (left/right)",
  sameHand: "Same hand, different finger",
  sameFinger: "Same finger, different key",
  repeat: "Same key twice",
  toSpace: "Letter → space (word end)",
  fromSpace: "Space → letter (word start)",
};

function transitType(a, b) {
  if (a === " ") return "fromSpace";
  if (b === " ") return "toSpace";
  if (a === b) return "repeat";
  const ka = KEYS[a], kb = KEYS[b];
  if (!ka || !kb || ka.hand !== kb.hand) return "alt";
  return ka.finger === kb.finger ? "sameFinger" : "sameHand";
}

// ---------- Findings ----------
//
// kinds:
//   jump   a = expected, b = the next letter typed too early (hand sync / finger order)
//   double a = previous letter repeated, b = expected
//   adj    a = expected, b = neighboring key hit instead
//   mirror a = expected, b = same finger on the other hand
//   sub    a = expected, b = some other key
//   slow   a + b is a transition that is consistently slower than your normal pace

const LETTER_KINDS = new Set(["adj", "mirror", "sub"]);
const ACTIVATE_AT = { jump: 2, double: 2, adj: 2, mirror: 2, sub: 3, slow: 1 };
const WINDOW = (k) => (LETTER_KINDS.has(k) ? 15 : 10);
const ALLOWED_MISSES = (k) => (LETTER_KINDS.has(k) ? 0 : 1);
const MIN_EXPOSURES = (k) => (LETTER_KINDS.has(k) ? 15 : 8);
const SLOW_FACTOR = 1.6;
const SLOW_FIXED_FACTOR = 1.3;

function classify(text, i, typed) {
  const exp = text[i], prev = text[i - 1], next = text[i + 1];
  if (typed === next) return { kind: "jump", a: exp, b: typed };
  if (isNeighbor(exp, typed)) return { kind: "adj", a: exp, b: typed };
  if (i > 0 && typed === prev) return { kind: "double", a: prev, b: exp };
  if (isMirror(exp, typed)) return { kind: "mirror", a: exp, b: typed };
  return { kind: "sub", a: exp, b: typed };
}

function label(f) {
  switch (f.kind) {
    case "jump":
      if (f.a === " " || f.b === " ") return `Space timing: ${code(f.b)} came before ${code(f.a)}`;
      if (handOf(f.a) !== handOf(f.b))
        return `Hands out of sync: ${handName(f.b)} fired ${code(f.b)} before ${code(f.a)}`;
      return `Finger order: ${code(f.b)} before ${code(f.a)} (same hand)`;
    case "double": return `Double tap: repeated ${code(f.a)} instead of ${code(f.b)}`;
    case "adj": return `Neighbor slip: ${code(f.b)} instead of ${code(f.a)}`;
    case "mirror": return `Mirror slip: ${code(f.b)} instead of ${code(f.a)} (same finger, other hand)`;
    case "sub": return `Wrong key: ${code(f.b)} instead of ${code(f.a)}`;
    case "slow": {
      const what = f.a === " " ? "Slow word start" : f.b === " " ? "Slow word end" : "Slow transition";
      return `${what}: ${code(f.a)}→${code(f.b)} takes ${Math.round(f.ms)} ms vs your usual ${Math.round(f.base)} ms`;
    }
  }
}

function chipText(f) {
  const a = show(f.a), b = show(f.b);
  switch (f.kind) {
    case "jump": return `${a}${b} order`;
    case "double": return `${a}→${b}`;
    case "slow": return `speed up ${a}${b}`;
    default: return `${a} not ${b}`;
  }
}

function getFinding(kind, a, b) {
  const id = `${kind}:${a}${b}`;
  return (data.findings[id] ||= { id, kind, a, b, count: 0, status: "watching", window: [], exposures: 0 });
}

function activate(f) {
  if (f.status !== "active") sentenceEvents.push({ type: "new", f });
  if (f.kind === "slow") queueRep(f.a, f.b);
  f.status = "active";
  f.window = [];
  f.exposures = 0;
}

function recordMistake(text, i, typed) {
  const c = classify(text, i, typed);
  const f = getFinding(c.kind, c.a, c.b);
  f.count++;
  f.lastAt = Date.now();
  if (f.status === "fixed" || (f.status === "watching" && f.count >= ACTIVATE_AT[f.kind])) activate(f);
}

// Every time the user types a spot that an active finding cares about, log a hit or a miss.
function recordExposure(text, i, firstTyped, wrong, dt) {
  for (const f of Object.values(data.findings)) {
    if (f.status !== "active") continue;
    let miss = null;
    switch (f.kind) {
      case "jump": if (text[i] === f.a && text[i + 1] === f.b) miss = wrong; break;
      case "double": if (text[i - 1] === f.a && text[i] === f.b) miss = wrong; break;
      case "slow":
        if (text[i - 1] === f.a && text[i] === f.b && dt != null) miss = dt > baseline(f.a, f.b) * SLOW_FIXED_FACTOR;
        break;
      default: if (text[i] === f.a) miss = firstTyped === f.b;
    }
    if (miss === null) continue;
    f.exposures++;
    pushCapped(f.window, miss ? 1 : 0, WINDOW(f.kind));
    const misses = f.window.reduce((s, v) => s + v, 0);
    if (f.exposures >= MIN_EXPOSURES(f.kind) && f.window.length >= WINDOW(f.kind) && misses <= ALLOWED_MISSES(f.kind)) {
      f.status = "fixed";
      f.fixedAt = Date.now();
      sentenceEvents.push({ type: "fixed", f });
    }
  }
}

function detectSlowBigrams() {
  if (data.intervals.length < 60) return;
  for (const [bg, samples] of Object.entries(data.bigrams)) {
    if (samples.length < 4) continue;
    if (bg.includes(" ") && (data.transit[transitType(bg[0], bg[1])] || []).length < 30) continue;
    const med = baseline(bg[0], bg[1]);
    const mean = avg(samples.slice(-6));
    const f = data.findings[`slow:${bg}`];
    if (mean > med * SLOW_FACTOR && mean - med > 60) {
      const s = getFinding("slow", bg[0], bg[1]);
      s.ms = mean;
      s.base = med;
      s.count = samples.length;
      if (s.status !== "active") activate(s);
    } else if (f) {
      f.ms = mean;
      f.base = med;
    }
  }
}

const activeFindings = () => Object.values(data.findings).filter((f) => f.status === "active");
const weight = (f) => 1 + f.window.reduce((s, v) => s + v, 0) * 2 + Math.min(f.count, 10) * 0.3;

// ---------- Sentence generation ----------

const candidateCache = {};
function wordsWith(test, key) {
  return (candidateCache[key] ||= WORDS.filter(test));
}

// Returns a chunk of text (one or two words) that exercises the finding.
function unitFor(f) {
  if (LETTER_KINDS.has(f.kind)) {
    if (f.a === " ") return pick(WORDS);
    const both = f.b !== " " ? wordsWith((w) => w.includes(f.a) && w.includes(f.b), `both:${f.a}${f.b}`) : [];
    const withA = wordsWith((w) => w.includes(f.a), `has:${f.a}`);
    if (both.length && Math.random() < 0.5) return pick(both);
    return withA.length ? pick(withA) : pick(WORDS);
  }
  const bg = f.a + f.b;
  if (bg[1] === " ") {
    const enders = wordsWith((w) => w.endsWith(bg[0]), `end:${bg[0]}`);
    return `${pick(enders.length ? enders : WORDS)} ${pick(WORDS)}`;
  }
  if (bg[0] === " ") {
    const starters = wordsWith((w) => w.startsWith(bg[1]), `start:${bg[1]}`);
    return `${pick(WORDS)} ${pick(starters.length ? starters : WORDS)}`;
  }
  const inside = wordsWith((w) => w.includes(bg), `in:${bg}`);
  if (inside.length) return pick(inside);
  // No word in the list contains this pair, so drill both letters instead.
  const fallback = wordsWith((w) => w.includes(bg[0]) || w.includes(bg[1]), `either:${bg}`);
  return pick(fallback.length ? fallback : WORDS);
}

// "L" or "R" when one hand's same-hand rolls are clearly slower than the other's.
function slowHand() {
  const { LL, RR } = data.pace;
  if (LL.length < 10 || RR.length < 10) return null;
  const l = avg(LL), r = avg(RR);
  const x = Math.abs(l - r);
  return x > 25 && x / Math.min(l, r) > 0.15 ? (l > r ? "L" : "R") : null;
}

function fillerWord() {
  const hand = slowHand();
  if (hand && Math.random() < 0.5) {
    const list = wordsWith((w) => [...w].filter((c) => KEYS[c]?.hand === hand).length / w.length >= 0.7, `hand:${hand}`);
    if (list.length) return pick(list);
  }
  return pick(WORDS);
}

// ---------- Rep drills ----------
// A whole line spent on one slow transition, repeated REPS times, with every rep timed.

const REPS = 10;
let repQueue = [];
let linesSinceRep = 0;

function queueRep(a, b) {
  if (!repQueue.some((r) => r.a === a && r.b === b)) repQueue.push({ a, b });
}

function repLine({ a, b }) {
  if (b === " ") {
    const enders = wordsWith((w) => w.endsWith(a), `end:${a}`);
    return Array.from({ length: REPS + 1 }, () => pick(enders.length ? enders : WORDS)).join(" ");
  }
  if (a === " ") {
    const starters = wordsWith((w) => w.startsWith(b), `start:${b}`);
    return Array.from({ length: REPS + 1 }, () => pick(starters.length ? starters : WORDS)).join(" ");
  }
  const inside = wordsWith((w) => w.includes(a + b), `in:${a + b}`);
  // First half bare pairs to isolate the motion, second half real words to put it back in context.
  return Array.from({ length: REPS }, (_, k) => (k < REPS / 2 || !inside.length ? a + b : pick(inside))).join(" ");
}

function pickFocus(findings, n) {
  const pool = [...findings];
  const out = [];
  while (out.length < n && pool.length) {
    const total = pool.reduce((s, f) => s + weight(f), 0);
    let r = Math.random() * total;
    const idx = pool.findIndex((f) => (r -= weight(f)) <= 0);
    out.push(pool.splice(idx < 0 ? 0 : idx, 1)[0]);
  }
  return out;
}

function makeSentence() {
  const active = activeFindings();
  const slow = active.filter((f) => f.kind === "slow");
  if (!repQueue.length && slow.length && linesSinceRep >= 3) {
    const f = pickFocus(slow, 1)[0];
    queueRep(f.a, f.b);
  }
  if (repQueue.length) {
    const rep = repQueue.shift();
    linesSinceRep = 0;
    return { text: repLine(rep), focus: [], rep };
  }
  linesSinceRep++;
  if (!active.length) {
    let text;
    do { text = pick(STARTER_SENTENCES); } while (text === current?.text && STARTER_SENTENCES.length > 1);
    return { text, focus: [] };
  }
  const focus = pickFocus(active, Math.min(3, active.length));
  const perFocus = { 1: 7, 2: 4, 3: 3 }[focus.length];
  const units = [];
  for (const f of focus) for (let k = 0; k < perFocus; k++) units.push(unitFor(f));
  let words = units.join(" ").split(" ").length;
  while (words < 12) { units.push(fillerWord()); words++; }
  return { text: shuffle(units).join(" "), focus };
}

// ---------- Typing session ----------

let current = null;
let sentenceEvents = [];

function startSentence(sentence) {
  current = {
    ...sentence,
    pos: 0,
    attempted: false,
    prevClean: false,
    missed: new Set(),
    bad: false,
    startTime: null,
    lastTime: null,
    errors: 0,
    repTimes: [],
  };
  sentenceEvents = [];
  renderSentence();
  renderFocus();
}

function onKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "Escape") { startSentence({ text: current.text, focus: current.focus, rep: current.rep }); return; }
  if (e.key.length !== 1) return;
  e.preventDefault();

  const s = current;
  const ch = e.key.toLowerCase();
  const now = performance.now();
  if (s.startTime === null) s.startTime = now;
  const exp = s.text[s.pos];

  if (ch === exp) {
    const stat = (data.keyStats[exp] ||= { hits: 0, misses: 0 });
    if (!s.attempted) {
      stat.hits++;
      let dt = s.prevClean && s.lastTime !== null ? now - s.lastTime : null;
      if (dt !== null && dt > 1500) dt = null;
      if (dt !== null) recordInterval(s.text[s.pos - 1], exp, dt);
      if (dt !== null && s.rep && s.text[s.pos - 1] === s.rep.a && exp === s.rep.b) s.repTimes.push(dt);
      recordExposure(s.text, s.pos, ch, false, dt);
      s.prevClean = true;
    } else {
      s.prevClean = false;
      const fix = now - s.errorTime;
      if (fix < 3000) pushCapped(data.recovery, fix, 100);
    }
    s.pos++;
    s.attempted = false;
    s.bad = false;
    s.lastTime = now;
    if (s.pos === s.text.length) return finishSentence(now);
  } else {
    if (!s.attempted) {
      s.attempted = true;
      s.errorTime = now;
      s.errors++;
      s.missed.add(s.pos);
      (data.keyStats[exp] ||= { hits: 0, misses: 0 }).misses++;
      recordMistake(s.text, s.pos, ch);
      recordExposure(s.text, s.pos, ch, true, null);
    }
    s.bad = true;
  }
  renderSentence();
}

function recordInterval(prev, ch, dt) {
  pushCapped((data.bigrams[prev + ch] ||= []), dt, 12);
  pushCapped((data.transit[transitType(prev, ch)] ||= []), dt, 300);
  if (prev === " " || ch === " ") {
    pushCapped(data.spaceIntervals, dt, 400);
    return;
  }
  pushCapped(data.intervals, dt, 400);
  const lane = handOf(prev) + handOf(ch);
  if (data.pace[lane]) pushCapped(data.pace[lane], dt, 200);
}

function finishSentence(now) {
  const s = current;
  const minutes = (now - s.startTime) / 60000;
  const wpm = minutes > 0 ? s.text.length / 5 / minutes : 0;
  const acc = s.text.length / (s.text.length + s.errors);
  pushCapped(data.history, { wpm, acc, at: Date.now() }, 200);
  detectSlowBigrams();
  save();

  const parts = [`${Math.round(wpm)} wpm, ${Math.round(acc * 100)}%`];
  if (s.rep && s.repTimes.length >= 4) {
    const k = Math.min(3, Math.floor(s.repTimes.length / 2));
    const first = Math.round(avg(s.repTimes.slice(0, k)));
    const last = Math.round(avg(s.repTimes.slice(-k)));
    pushCapped((data.repLog[s.rep.a + s.rep.b] ||= []), Math.round(avg(s.repTimes)), 12);
    save();
    parts.push(`${show(s.rep.a)}→${show(s.rep.b)} reps went ${first} → ${last} ms ${last < first ? "— faster!" : "— keep at it"}`);
  }
  const added = sentenceEvents.filter((e) => e.type === "new");
  const fixed = sentenceEvents.filter((e) => e.type === "fixed");
  if (added.length) parts.push(`new target: ${added.map((e) => chipText(e.f)).join(", ")}`);
  if (fixed.length) parts.push(`fixed: ${fixed.map((e) => chipText(e.f)).join(", ")} ✓`);
  $("last").textContent = parts.join("  ·  ");

  renderStats();
  renderFindings();
  renderKeyboard();
  renderTransit();
  startSentence(makeSentence());
}

// ---------- Rendering ----------

const $ = (id) => document.getElementById(id);

function renderSentence() {
  const s = current;
  let i = 0;
  // Each word and its trailing space is one unbreakable group, so lines wrap between words.
  $("sentence").innerHTML = s.text.match(/\S+ ?| /g)
    .map((word) => `<span class="w">${[...word].map((ch) => {
      const cls = [ch === " " ? "space" : ""];
      if (i < s.pos) cls.push(s.missed.has(i) ? "missed" : "done");
      else if (i === s.pos) cls.push("cur", s.bad ? "bad" : "");
      else cls.push("todo");
      i++;
      return `<span class="${cls.join(" ").trim()}">${ch === " " ? "&nbsp;" : esc(ch)}</span>`;
    }).join("")}</span>`)
    .join("");
}

function renderFocus() {
  const { rep, focus } = current;
  $("focus").textContent = rep
    ? `rep drill: ${show(rep.a)}→${show(rep.b)} ×${REPS} — smooth first, then fast`
    : focus.length ? `drilling → ${focus.map(chipText).join(",  ")}` : "";
}

function renderStats() {
  const recent = data.history.slice(-10);
  $("stat-wpm").textContent = recent.length ? Math.round(avg(recent.map((h) => h.wpm))) : "–";
  $("stat-acc").textContent = recent.length ? `${Math.round(avg(recent.map((h) => h.acc)) * 100)}%` : "–";
  $("stat-count").textContent = data.history.length + 1;
  const date = (t) => new Date(t).toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "2-digit" });
  $("basic-date").textContent = date(data.history[0]?.at ?? Date.now());
  $("changed-date").textContent = date(data.history.at(-1)?.at ?? Date.now());
}

function renderFindings() {
  const order = { active: 0, watching: 1, fixed: 2 };
  const list = Object.values(data.findings)
    .sort((x, y) => order[x.status] - order[y.status] || (x.status === "active" ? weight(y) - weight(x) : y.count - x.count))
    .slice(0, 40);
  $("findings-empty").hidden = list.length > 0;
  $("findings").innerHTML = list
    .map((f) => {
      const w = WINDOW(f.kind);
      const clean = f.window.filter((v) => !v).length;
      // Recent reps as a tally: "/" clean, "x" missed, "." not yet done.
      const tally = f.window.map((v) => (v ? "x" : "/")).join("").padEnd(w, ".");
      let badge, meta;
      if (f.status === "active") {
        badge = "drilling";
        meta = `SEEN ${f.count}X - RECENT [${tally}] ${clean}/${w} CLEAN`;
      } else if (f.status === "fixed") {
        badge = "fixed ✓";
        meta = `SEEN ${f.count}X - HELD UP OVER ${f.exposures} REPS`;
      } else {
        badge = "watching";
        meta = `SEEN ${f.count}X - DRILLED AFTER ${ACTIVATE_AT[f.kind]}`;
      }
      const reps = data.repLog[f.a + f.b];
      const repRow = f.kind === "slow" && reps?.length
        ? `<div class="reps">REP DRILL AVG MS: ${reps.map((ms, k) => (k === reps.length - 1 ? `<i>${ms}</i>` : ms)).join(" - ")}</div>`
        : "";
      return `<li class="finding ${f.status}">
        <div><div class="label">${label(f)}</div><div class="meta">${meta}</div></div>
        <div class="badge">${badge}</div>
        ${repRow}
      </li>`;
    })
    .join("");
}

function renderKeyboard() {
  $("keyboard").innerHTML = ROWS.map((row, r) => {
    const keys = [...row].map((ch) => {
      const st = data.keyStats[ch];
      const total = st ? st.hits + st.misses : 0;
      const rate = total ? st.misses / total : 0;
      const heat = Math.min(1, rate * 6);
      const tip = total ? `${ch}: ${st.misses} misses / ${total} (${Math.round(rate * 100)}%)` : `${ch}: no data`;
      const ring = st?.misses ? `<span class="ring" style="opacity:${(0.25 + heat * 0.75).toFixed(2)}"></span><small>${st.misses}</small>` : "";
      return `<div class="key ${KEYS[ch].hand}" title="${esc(tip)}">${esc(ch)}${ring}</div>`;
    }).join("");
    return `<div class="krow" style="padding-left:${ROW_OFFSET[r] * 42}px">${keys}</div>`;
  }).join("");

  const stats = Object.values(data.keyStats);
  const pad = (n) => String(n).padStart(5, "0");
  $("card-hits").textContent = pad(stats.reduce((s, k) => s + k.hits, 0));
  $("card-misses").textContent = pad(stats.reduce((s, k) => s + k.misses, 0));

  const p = data.pace;
  const ms = (arr) => (arr.length >= 5 ? `${Math.round(avg(arr))} MS` : "--");
  $("pacing").textContent = data.intervals.length >= 20
    ? `HAND PACE: L-L ${ms(p.LL)}, R-R ${ms(p.RR)}, L-R ${ms(p.LR)}, R-L ${ms(p.RL)}. SOLID UNDERLINE = LEFT HAND, DASHED = RIGHT.`
    : "SOLID UNDERLINE = LEFT HAND, DASHED = RIGHT. HAND PACE APPEARS AFTER A FEW LINES.";
}

function transitTips(med) {
  const t = (k) => data.transit[k] || [];
  const enough = (arr) => arr.length >= 8;
  const tips = [];
  const share = (arr) => arr.length / Math.max(1, Object.values(data.transit).reduce((s, a) => s + a.length, 0));
  const add = (excess, freq, html) => { if (excess > 0) tips.push({ cost: excess * freq, html }); };

  const letterMed = median(data.intervals);
  if (enough(t("fromSpace"))) {
    const x = avg(t("fromSpace")) - letterMed;
    if (x > 40) add(x, share(t("fromSpace")), `You pause about <b>${Math.round(x)} ms</b> at the start of each word. Keep your eyes one word ahead of the cursor so the next word is already loaded when your thumb hits space.`);
  }
  if (enough(t("toSpace"))) {
    const x = avg(t("toSpace")) - letterMed;
    if (x > 40) add(x, share(t("toSpace")), `Hitting space after a word costs an extra <b>${Math.round(x)} ms</b>. Treat the space as the last letter of the word: let the thumb fire as part of the same roll instead of as a separate step.`);
  }
  if (enough(t("sameFinger")) && enough(t("alt"))) {
    const x = avg(t("sameFinger")) - avg(t("alt"));
    if (x > 40) add(x, share(t("sameFinger")), `Same-finger moves (like <code>ed</code>, <code>un</code>, <code>ce</code>) take <b>${Math.round(avg(t("sameFinger")))} ms</b> vs <b>${Math.round(avg(t("alt")))} ms</b> for hand switches. Check you're using the correct finger for each key, and start moving the finger toward the second key the instant the first one is down.`);
  }
  if (enough(t("sameHand")) && enough(t("alt"))) {
    const x = avg(t("sameHand")) - avg(t("alt"));
    if (x > 40) add(x, share(t("sameHand")), `Same-hand rolls (like <code>as</code>, <code>io</code>) are <b>${Math.round(x)} ms</b> slower than hand switches. Practice them as one rolling motion across the fingers rather than separate taps.`);
  }
  const hand = slowHand();
  if (hand) {
    const l = avg(data.pace.LL), r = avg(data.pace.RR);
    const name = hand === "L" ? "left" : "right";
    add(Math.abs(l - r), share(data.pace[hand + hand]), `Your <b>${name} hand</b> is ${Math.round(Math.abs(l - r))} ms slower on its own rolls (${Math.round(l)} ms left vs ${Math.round(r)} ms right). Drills now lean on ${name}-hand words until they even out.`);
  }
  if (data.recovery.length >= 5) {
    const r = median(data.recovery);
    add(r, Math.min(1, data.recovery.length / Math.max(1, data.intervals.length)) * 3,
      `Each mistake costs about <b>${Math.round(r)} ms</b> to notice and fix, roughly ${Math.max(1, Math.round(r / med))} keypresses' worth. Easing off slightly to avoid mistakes is usually faster overall.`);
  }
  const all = [...data.intervals, ...data.spaceIntervals];
  const mean = avg(all);
  const sd = Math.sqrt(avg(all.map((v) => (v - mean) ** 2)));
  if (sd / mean > 0.55)
    add(sd, 0.3, `Your rhythm is uneven (±${Math.round(sd)} ms between keys). Bursts followed by stalls are slower overall than a steady beat. Find a pace you can hold evenly, then raise it.`);
  return tips.sort((a, b) => b.cost - a.cost).slice(0, 4).map((t) => t.html);
}

function renderTransit() {
  const el = $("transit");
  const all = [...data.intervals, ...data.spaceIntervals];
  if (all.length < 40) {
    el.innerHTML = `<p class="typed dim">NO DATA. TYPE A FEW LINES - THE TIME BETWEEN EVERY PAIR OF KEYPRESSES IS LOGGED HERE.</p>`;
    return;
  }
  const med = median(all);
  const mean = avg(all);
  const sd = Math.sqrt(avg(all.map((v) => (v - mean) ** 2)));
  const best = Math.max(...data.history.map((h) => h.wpm));

  const tiles = [
    ["TYPICAL GAP", `${Math.round(med)} MS`],
    ["WPM AT THAT GAP", Math.round(12000 / med)],
    ["RHYTHM SPREAD", `±${Math.round(sd)} MS`],
    ["COST PER MISTAKE", data.recovery.length ? `${Math.round(median(data.recovery))} MS` : "--"],
    ["BEST LINE", `${Math.round(best)} WPM`],
  ];

  const types = Object.entries(TRANSIT_TYPES)
    .map(([k, name]) => ({ name, arr: data.transit[k] || [] }))
    .filter((r) => r.arr.length >= 5)
    .map((r) => ({ ...r, ms: avg(r.arr) }));
  const maxMs = Math.max(...types.map((r) => r.ms), 1);

  const slowest = Object.entries(data.bigrams)
    .filter(([, s]) => s.length >= 3)
    .map(([bg, s]) => {
      const ms = avg(s.slice(-6));
      return { bg, ms, excess: ms - baseline(bg[0], bg[1]), type: TRANSIT_TYPES[transitType(bg[0], bg[1])] };
    })
    .filter((r) => r.excess > 20)
    .sort((a, b) => b.excess - a.excess)
    .slice(0, 8);

  const tips = transitTips(med);

  el.innerHTML = `
    <div class="readout-grid">${tiles.map(([l, v]) => `<div class="box">${l}<b>${v}</b></div>`).join("")}</div>
    <h3>BY MOVEMENT</h3>
    <table class="ruled">
      <tr><th>MOVEMENT</th><th>AVG</th><th></th></tr>
      ${types.map((r) => `<tr><td>${r.name.toUpperCase()}</td><td class="num">${Math.round(r.ms)} MS</td>
        <td><span class="ticks" style="width:${Math.round((r.ms / maxMs) * 100)}%"></span></td></tr>`).join("")}
    </table>
    <h3>SLOWEST TRANSITIONS</h3>
    ${slowest.length ? `<table class="ruled">
      <tr><th>PAIR</th><th>MOVEMENT</th><th>AVG</th><th>OVER</th><th>DRILL</th></tr>
      ${slowest.map((r) => `<tr><td>${code(r.bg[0])} → ${code(r.bg[1])}</td><td>${r.type.toUpperCase()}</td>
        <td class="num">${Math.round(r.ms)} MS</td><td class="num">+${Math.round(r.excess)}</td>
        <td><button class="drill-btn" data-a="${esc(r.bg[0])}" data-b="${esc(r.bg[1])}">×${REPS} NOW</button></td></tr>`).join("")}
    </table>` : `<p class="typed dim">NO TRANSITION STANDS OUT YET.</p>`}
    ${tips.length ? `<div class="notes"><h3>how to get faster</h3><ol>${tips.map((t) => `<li>${t}</li>`).join("")}</ol></div>` : ""}`;
}

// ---------- Boot ----------

document.addEventListener("keydown", onKey);
$("transit").addEventListener("click", (e) => {
  const btn = e.target.closest(".drill-btn");
  if (!btn) return;
  btn.blur();
  repQueue = repQueue.filter((r) => r.a !== btn.dataset.a || r.b !== btn.dataset.b);
  repQueue.unshift({ a: btn.dataset.a, b: btn.dataset.b });
  startSentence(makeSentence());
  $("drill").scrollIntoView({ behavior: "smooth" });
});
$("reset").addEventListener("click", (e) => {
  e.currentTarget.blur();
  if (!confirm("Clear all findings and stats?")) return;
  data = freshData();
  save();
  renderStats();
  renderFindings();
  renderKeyboard();
  renderTransit();
  startSentence(makeSentence());
});

renderStats();
renderFindings();
renderKeyboard();
renderTransit();
startSentence(makeSentence());
