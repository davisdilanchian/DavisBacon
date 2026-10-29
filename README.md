# DavisBacon

A typing trainer that watches *how* you make mistakes and how long you take between keys, then rewrites the drills to go after your weak spots.

## How it works

You type a sentence. A wrong key stops the cursor until you hit the right one, so every mistake is a clean, single event that can be diagnosed.

**Mistakes are classified as:**

- **Hands out of sync / finger order**: you typed the *next* letter too early (`msitake` for `mistake`). Flagged as a hand-sync issue when the two letters are on different hands.
- **Neighbor slip**: you hit a key next to the right one (`u` for `i`).
- **Mirror slip**: same finger, other hand (`f` for `j`).
- **Double tap**: you repeated the previous letter.
- **Wrong key**: anything else.

**Transit time** is the time between consecutive clean keypresses. It is broken down by movement type (hand switch, same-hand roll, same finger, word start, word end), by hand, and by individual letter pair. Pairs that are consistently slower than your usual pace become findings too. The panel also turns the biggest time sinks into specific advice.

**Rep drills**: when a slow transition is found, the next line repeats that pair 10 times (bare pairs first, then real words). Each rep is timed, and the line ends by showing your first reps vs your last. Slow pairs come back for another rep line every few lines, and any row in the slowest-transitions table can be drilled on demand.

**Findings** go through three states:

1. **watching**: seen, but not often enough to act on.
2. **targeting**: new sentences are built from words that contain the pattern.
3. **fixed**: you got through enough reps cleanly (or fast enough). It drops out of the drills, and comes back if the mistake shows up again.

Everything is stored in your browser's `localStorage`.

## Running it

It's a static site with no build step. Open `index.html`, or serve the folder:

```bash
python -m http.server 8765
```

Hosted with GitHub Pages from the root of `master`.
