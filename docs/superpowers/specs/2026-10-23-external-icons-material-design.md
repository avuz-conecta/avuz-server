# External sites icons: Material Symbols

## Why

PR #24 moved the left rail, the theme app icons and the favicon to Material
Symbols Rounded, weight 200 (Patrick's pick, 2026-10-23). It left the External
sites icon library (Deck #417, 34 icons seeded at boot) on Lucide on purpose:
the seed never overwrites an icon an instance already has, so the swap needs a
migration of its own. External sites entries render in the rail as `<img>`
next to the Material glyphs, so today they look heavier and off-style. This
change puts the library on the same glyphs and moves existing instances over.

## Goals

- The library in `apps/avuz_theme/img/external-icons/` holds the same 34 file
  names, drawn from `@material-symbols/svg-200@0.48.1` Rounded, the same
  package and version as the rail.
- Existing instances get the Material version of every library icon they still
  have untouched. Configured sites keep their icon name and show the new glyph.
- Nothing reads `apps/avuz_theme/js/lucide.js` any more, and it is deleted.
- The admin Icons section points admins to https://fonts.google.com/icons.

## Non-goals

- New icons or new names. The set stays the 34 names it has today.
- The External sites app itself (upload, delete, serving) stays upstream.
- Fleet rollout or app3. Prod is gated per action.
- Other stale "Lucide-style" wording that predates this change (design-system
  docs, docs-site, verify skill, `icons.css` comment). Listed as a follow-up.

## Anti-goals

- Touching an icon the admin uploaded or edited, even if it has a library name.
- Bringing back an icon the admin deleted.
- Renaming files. A rename would break every site configured with that icon.

## Design

### Glyphs

`scripts/generate-external-icons.py` keeps its `ICONS` list, now as a map from
file name to Material glyph. My calls, shown side by side in the preview Patrick
reviews with this spec:

| File | Glyph | File | Glyph |
|---|---|---|---|
| briefcase | `work` | headset | `support_agent` |
| book-open | `menu_book` | house | `home` |
| building-2 | `apartment` | landmark | `account_balance` |
| calendar | `calendar_today` | link | `link` |
| chart-column | `bar_chart` | mail | `mail` |
| chart-pie | `pie_chart` | map-pin | `location_on` |
| circle-help | `help` | message-circle | `chat_bubble` |
| clipboard-list | `assignment` | newspaper | `newspaper` |
| cloud | `cloud` | phone | `call` |
| cog | `settings` | receipt | `receipt_long` |
| credit-card | `credit_card` | server | `dns` |
| database | `database` | shield-check | `verified_user` |
| external-link | `open_in_new` | shopping-cart | `shopping_cart` |
| file-text | `description` | truck | `local_shipping` |
| folder | `folder` | users | `group` |
| globe | `language` | video | `videocam` |
| graduation-cap | `school` | wallet | `account_balance_wallet` |

Where the rail already uses a glyph for the same idea (`folder`, `mail`,
`calendar_today`, `settings`, `group`, `chat_bubble`), the library uses the
same one. All 34 are single-path SVGs in the pinned package (checked).

### Generator

- The download, single-path check and SVG rendering of
  `scripts/generate-rail-icons.py` move to `scripts/material_symbols.py`. Both
  generators import it, so the package, version and style live in one place.
  `python3 -I` leaves the script's folder off the import path, so each
  generator adds its own folder before the import (my call).
- Output convention stays: `<name>.svg` with `fill="currentColor"`,
  `<name>-dark.svg` with `fill="#000000"` (the variant External sites serves to
  the mobile and desktop clients). Plain glyphs only, no `-fill` variants.
- `LICENSE` in the library folder becomes the package's Apache 2.0 license,
  with a header naming the package, version and generator.
- **Superseded hashes.** Before the generator overwrites a library file whose
  content changes, it records the old file's SHA-256 under that file name in
  `apps/avuz_theme/img/external-icons/superseded.json`
  (`{"globe.svg": ["<sha256>", ...], ...}`, sorted, no duplicates). The first
  run records the 68 Lucide files. Any later glyph change records the Material
  version it replaces, so the same migration handles the next swap too.
- `lucide.js` is deleted once the generator no longer reads it.

### Seed migration

`docker/seed-external-icons.php` gains an upgrade step next to the existing
offer step. The offer step does not change: each name is offered once per
instance (`avuz_theme/external_icons_seeded`), never overwrites, never
restores.

Upgrade step, per library name, on the pair `<name>.svg` + `<name>-dark.svg`
in the store:

1. A store file is **ours** when its SHA-256 is in `superseded.json` for that
   file name, or equals the current library file.
2. If any existing file of the pair is not ours (admin upload or edit), leave
   the whole pair alone. The pair stays consistent: no Lucide dark icon behind a
   Material light one, and no Material dark icon behind the admin's light one.
3. Otherwise, replace every existing file whose content differs from the
   library with the library content. Never create a missing file: a deleted
   icon stays deleted, a pair the admin trimmed to one file stays one file.

Gate, so boots don't read 68 store files (S3 round trips) every time: the step
runs only when `avuz_theme/external_icons_library` differs from the SHA-256 of
the shipped `superseded.json`, and writes it after a run that finished. A
storage failure leaves it unset, so the next boot retries. Replacing is
idempotent, so a half-done run is safe to repeat. A fresh install runs the
step once, finds nothing to replace, and records the value.

Outcome line, printed by the seed and logged by `avuz_seed_external_icons`:
`seeded <n>, upgraded <m>, kept <k>` when the upgrade step ran or anything was
seeded, else `unchanged`. `kept` counts pairs left alone because a file is not
ours, so a store holding some other Lucide variant shows up in the boot log
instead of staying Lucide silently. The
`skipped:` and `failed:` lines stay. `AVUZ_SEED_EXTERNAL_ICONS=0` skips both
steps.
A missing or invalid `superseded.json` prints `failed: invalid superseded.json`
before the store is touched (my call).

Only one Lucide version ever shipped (`6ba6f1c81f5`, 2026-10-16, the only
commit touching the library), and staging-1's 68 library files match it byte
for byte (checked 2026-10-23). So the generator's first run records every
Lucide file in the wild.

Edge (my call, accepted): an admin who uploaded a file byte-identical to our
Lucide output under the same name gets it upgraded. lucide.dev downloads have
different markup, so this only happens if someone re-uploaded our own file.

### Caching

External sites serves icons with `Cache-Control: max-age=86400` at
`/apps/external/icons/<name>`. Browsers and Cloudflare may show the Lucide
version for up to a day after the deploy. No code change; the deploy note says
so, and a Cloudflare purge of `/apps/external/icons/*` shortens it.

### Admin text and docs

- `themes/avuz/apps/external/l10n/pt_BR.json`: "Baixe mais ícones no mesmo
  estilo dos ícones do Avuz Conecta em https://fonts.google.com/icons (estilo
  Rounded, peso 200, formato SVG)."
- `CLAUDE.md` "External sites icon library", `customizations.json`,
  `REUSE.toml` (Lucide ISC annotation → Material Apache 2.0 for the library;
  `lucide.js` dropped), the stack-file and entrypoint comments that say
  "Lucide", and `UPGRADING.md` lines that point at `lucide.js`.

## Tests

`docker/tests/seed-external-icons.test.sh` (fakes, no Nextcloud), new cases:

- upgrades an untouched pair to the library content;
- leaves a pair alone when the admin edited the light file, or the dark file;
  and counts it as kept;
- does not recreate a deleted file or a deleted pair;
- upgrades the light file of a pair whose dark file the admin deleted;
- runs once: next boot prints `unchanged` and reads nothing;
- runs again when `superseded.json` changes;
- on a storage failure records nothing, and the next boot finishes the job;
- fresh install: seeds 34, upgrades 0, records the library value;
- shipped library: every file has a superseded entry (the Lucide hashes), and
  no file's current hash is in its own superseded list.

## Verification

staging-1 (stack 8): before the deploy, record the hashes of the store's
icons (expect Lucide). Build `build-push.sh latest staging 1` from this branch,
check the container `.Image` changed, read the boot line (`upgraded 34` or
fewer if staging has edits), and confirm a site icon in the rail and the admin
Icons section show Material. The next restart logs `unchanged`.

## Branching (my call)

This branch stacks on PR #24 (`feat/rail-icons`): it moves code out of
`generate-rail-icons.py`, which #24 adds, and `lucide.js` can only go once #24
stops loading it. staging-1 already runs #24's tip, so the staging build carries
both. The PR targets `avuz-customization` and merges after #24.

## Left to the builder

- Function names and layout inside the seed, the test fakes' extra methods
  (`getFile`, `getContent`, `putContent`).
- Whether `material_symbols.py` exposes plain functions or a small class.
