# contacts JS/CSS overlay — WhatsApp button next to phone numbers (card 266)

## What
Patched build of Nextcloud Contacts **v8.4.1** for Avuz Conecta. Every phone
number (TEL) in the contact details shows a WhatsApp icon button in view mode
(the contact detail and the read-only view). Click opens
`https://wa.me/<digits>` in a new tab. Design spec (final):
`~/work/avuz/reports/266-spec/SPEC.md`.

- Placement: first inline action after the number: WhatsApp, Copy, Call.
  Always visible: opacity .7 at rest, no background; 1 on hover
  (`--color-background-hover`, round), focus-visible (NcButton's own ring)
  and active (`--color-background-dark`). Copy and Call keep their
  hover-reveal. 20px icon, 34px button on desktop, 44px on touch/≤1024px.
- Hidden in edit mode and for Fax, Pager, Car and other non-chat TEL types.
  Shown for untyped numbers, custom labels, Celular/Casa/Trabalho/Voz.
- Number rule (`src/utils/whatsapp.js`, unit-tested): drop `tel:` and any
  extension (`ramal`, `x`, `ext`, `;`), keep digits. `+` → as is; `00` →
  dropped; else 10 or 11 digits (after a trunk `0`) → prefix `55`. Fewer than
  8 digits (e.g. `190`) → no button.
- Icon: `vue-material-design-icons/Whatsapp.vue` (already a dependency),
  `currentColor`, no green. Label and tooltip: `t('contacts', 'Chat on
  WhatsApp')`, pt_BR "Conversar no WhatsApp" from
  `themes/avuz/apps/contacts/l10n/pt_BR.json` (merged by `merge-l10n.sh`).
  NcActions renders the link as an `<a target="_blank" rel="nofollow
  noreferrer noopener">`.
- Styles: one scoped block in `PropertyText.vue`, marked `AVUZ-266`. NcActions
  renders each inline action as an NcButton root (`<a class="button-vue
  button-vue--tertiary-no-background … property__whatsapp action-item
  action-item--single">`), so the block targets
  `.property__whatsapp.button-vue` to beat NcButton's transparent hover and
  primary-light `:active`.

## Files here
- `js/*.mjs`, `css/*.css` — only the files that change. Contacts builds with
  Vite: chunk names carry a content hash and CSS ships as separate files, so
  the patch adds a new app chunk (`js/style-XRJXNnxt.chunk.mjs`,
  `css/style-DztFUzi0.chunk.css`) and a new `FilePicker-*` chunk that imports
  it, and rewrites the entries that point at them (`contacts-main.mjs`,
  `contacts-oca.mjs`, `contacts-main.css`, `contacts-oca.css`). The old
  chunks stay on disk, unused. `.license` files ship with the new chunks;
  source maps are excluded.
- `whatsapp-phone-button.patch` — the source diff (`PropertyText.vue`,
  `src/utils/whatsapp.js`, `tests/javascript/utils/whatsapp.test.js`).
- `shift-build-date.cjs` — Node preload that moves the build clock to the
  release date (see Rebuild).

## How it's applied
- Dockerfile copies `js/` and `css/` over `apps/contacts/` and **fails the
  build** if `apps/contacts` is not 8.4.1.
- Entrypoint: sentinel `AVUZ-WHATSAPP-PHONE-V1` (a `data-avuz-patch` attribute
  on the button) in `js/style-XRJXNnxt.chunk.mjs`, plus a check that
  `js/contacts-main.mjs` loads that chunk (`verify_avuz_patches`); `contacts`
  in `AVUZ_OWNED_APPS`; `reapply_avuz_contacts_overlay` after core upgrades.
- Browsers: bump `AVUZ_CONFIG_VERSION` with every overlay change (theming
  cachebuster → new `?v=` on `contacts-main.mjs`/`.css`). Chunks are
  content-hashed, so they need no cache-bust.

## Rebuild (required on every contacts upgrade)
The upstream build is byte-reproducible only at the release date: the
browserslist query `baseline widely available` resolves against today's date,
so a build today keeps native CSS nesting the release lowered, and every chunk
hash changes. Pin the clock to the tag's commit date.

```bash
git clone --depth 1 --branch v<NEW_VERSION> https://github.com/nextcloud/contacts
cd contacts
BUILD_DATE="$(git log -1 --format=%cI)"
npm ci                                             # node ^24, npm ^11
# 1. unpatched build must match the release tarball byte for byte
BUILD_DATE=$BUILD_DATE NODE_OPTIONS="--require /path/to/docker/overlays/contacts/shift-build-date.cjs" npm run build
#    compare js/ css/ (no .map) with the release; stop if they differ
# 2. patched build
git apply /path/to/docker/overlays/contacts/whatsapp-phone-button.patch
npx jest tests/javascript/utils/whatsapp.test.js
BUILD_DATE=$BUILD_DATE NODE_OPTIONS="--require /path/to/docker/overlays/contacts/shift-build-date.cjs" npm run build
grep -l 'AVUZ-WHATSAPP-PHONE-V1' js/*.mjs          # the new style-*.chunk.mjs
```
Then copy every `js/` and `css/` file that is new or differs from the release
(no `.map`), delete the old ones here, and update: the two contacts entries in
`verify_avuz_patches` (new chunk name), `AVUZ_CONTACTS_OVERLAY_VERSION` in the
Dockerfile, `AVUZ_CONFIG_VERSION`, `customizations.json` paths and this README.
