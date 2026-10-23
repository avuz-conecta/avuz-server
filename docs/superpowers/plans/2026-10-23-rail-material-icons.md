# Plan: left rail icons to Material Symbols

Spec: `docs/superpowers/specs/2026-10-23-rail-material-icons-design.md`.
Branch `feat/rail-icons` from `avuz-customization`.

Tests: `node --test apps/avuz_theme/tests/js/*.test.mjs` (jsdom from the root `node_modules`).

## Steps

- [ ] 1. Generator `scripts/generate-rail-icons.py`: pinned `@material-symbols/svg-200@0.48.1` Rounded. It writes `js/material-icons.js` (`window.AvuzIcons`), the theme overrides (same file names, light `currentColor` / dark `#000000`), `apps/conectamail/img/mail.svg`, and the license. It fails if a glyph is not a single path.
- [ ] 2. Tests first (`tests/js/left-rail.test.mjs`). A known app renders an inline SVG with the regular path. The open app renders the filled path. An unknown app keeps `<img src=app.icon alt="">`. Without `AvuzIcons`, every app falls back to `<img>`. The toggle and "Mais aplicativos" draw Material glyphs.
- [ ] 3. `left-rail.js`: inline icons by `app.id`, `<img>` fallback. Toggle and more use `AvuzIcons`.
- [ ] 4. `left-rail.css`: icon size 19px, inline SVG `fill: currentColor`. The dark invert stays only on `img.avuz-rail__icon`.
- [ ] 5. Favicon: rename `lucide-icons.js` → `favicon.js` and switch it to `AvuzIcons`, with a test of the data URL per app. Update `Application.php` script registration (drop `lucide`, `lucide-icons`). Update the `icons.css` fill rule.
- [ ] 6. Bump avuz_theme `info.xml` version and conectamail's version (its img changed). Update the Icon Overrides section and file tree in CLAUDE.md, and the README if it mentions Lucide.
- [ ] 7. Checkpoint: run the JS tests and PHPUnit for avuz_theme. Hot-patch staging-1 (stack 8, `avuz-conecta-app-1`) with the changed files, then bump the cachebuster. Check light and dark, expanded and collapsed, the open app filled, "Mais aplicativos", the favicon, and the header below 1024px.
- [ ] 8. `build-push.sh latest staging 1`, deploy stack 8, confirm the container `.Image` changed, re-check, open the PR to `avuz-customization`.
- [ ] 9. Prod (app3 pinned tag) only on Patrick's explicit go.
