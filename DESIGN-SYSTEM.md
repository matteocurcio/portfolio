# Design system

This project uses **Code**.

**Canonical source:** `Documents/Projects/01-Design Systems/Code/`

Migrated from its own navy/blue palette on 7 August 2026. The previous version is kept as
`index.html.pre-code-migration` — delete it once you're happy.

## What changed

- Surfaces, text and borders now use the `--c-*` tokens. The old names (`--bg`, `--panel`,
  `--txt`, `--muted`, `--accent`…) survive as aliases pointing at them, so every existing
  rule still works. Prefer `--c-*` in new code.
- Five accents became one. Blue `#5b8cff` and violet `#7c5cff` are now the emerald accent;
  the two-colour gradients on the logo, primary button and progress bar are flat fills.
- Gain/loss keeps its semantics: positive is `--c-green`, negative is `--c-danger`.
- Inter and JetBrains Mono replace the system stack, and **every number is monospaced** —
  table cells, prices, the price input. This is a holdings tracker, so that's most of it.
- Charts read the tokens through `getComputedStyle` instead of hardcoding hex, so they
  follow the theme. The doughnut palette is one accent stepped by opacity with a neutral
  tail, rather than ten unrelated hues.
- Light theme now available: `document.documentElement.className = 'theme-light'`.

## The short version

Dark-first, light via `html.theme-light`. One accent meaning active, selected or primary.
`--c-danger` for loss and destruction only. Every number monospaced. No hex outside the
token block.
