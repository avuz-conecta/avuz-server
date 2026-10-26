# Left rail icons: Material Symbols

## Why

The team dislikes the Lucide icons in the new left rail (app3 pilot, staging).
They asked for a different library, or at least smaller icons. Patrick compared
five options side by side (Lucide as is, Lucide smaller, Phosphor, Material
Symbols, Fluent UI) and picked **Material Symbols Rounded, weight 200, 19px**.
Each icon shows its filled version for the open app.

## Goals

- The rail's app icons and "Mais aplicativos" use
  Material Symbols Rounded, weight 200, drawn at 19px.
- The open app (`aria-current="page"`) shows the filled version of its icon.
- Light and dark themes both render correctly, without the dark-mode invert filter.
- Users see the new icons on the first load after the deploy, even though theme
  SVGs are cached for 6 months by browsers and Cloudflare.
- The theme's app icon overrides (`themes/avuz/apps/*/img/*.svg`, used by the
  top header below 1024px, dashboard widgets and app settings) and ConectaMail's
  `img/mail.svg` switch to the same glyphs. Then the product uses one library.
- The browser tab icon (favicon per app, Avuz blue) uses the same glyphs. The
  400 KB `lucide.js` bundle stops loading on every page.

## Non-goals

- External sites icon library (34 Lucide icons seeded at boot). The seed never
  overwrites an icon an instance already has, so swapping it needs a re-seed
  step of its own. That's a follow-up. `lucide.js` stays in the repo because
  `scripts/generate-external-icons.py` reads it.
- Icons inside apps (Files actions, Deck, Talk). Those are each app's own.
- The user menu avatar at the rail's foot.
- Fleet rollout. The rail is app3-only. Prod is gated per action.

## Design

### Where the glyphs come from

`scripts/generate-rail-icons.py` downloads each icon from the npm package
`@material-symbols/svg-200` at a pinned version (0.48.1, Rounded, plain and
`-fill`) through jsDelivr, and writes:

1. `apps/avuz_theme/js/material-icons.js`: a classic script that defines
   `window.AvuzIcons`, a frozen object with the 960-unit `viewBox` and, per
   icon name, `{ regular, fill }` path data. It is classic, not a module, so it
   gets the same server `?v=` cache buster as every avuz_theme script.
2. The theme overrides, with the existing convention: `<name>.svg` with
   `fill="currentColor"`, `<name>-dark.svg` with `fill="#000000"`, the same
   file names as today.
3. `apps/conectamail/img/mail.svg`.

The outputs are committed. A build never fetches anything. The Apache 2.0
license ships next to the script (`js/material-icons.LICENSE`).

Glyph per app id:

| App id | Name | Material icon |
|---|---|---|
| dashboard | Painel | `space_dashboard` |
| files | Drive | `folder` |
| spreed | Talk | `chat_bubble` |
| calendar | Calendário | `calendar_today` |
| deck | Tarefas | `view_kanban` |
| contacts | Contatos | `group` |
| mail, conectamail | Mail | `mail` |
| forms | Formulários | `list_alt` |
| activity | Atividade | `bolt` |
| assinaturas | Assinaturas | `signature` |
| settings | Configurações | `settings` |
| rail: more | Mais aplicativos | `more_horiz` |
| rail foot: search / notifications | Pesquisar / Notificações | `search` / `notifications` |

### Rail

- `left-rail.js` draws known apps (by `app.id`) as an inline `<svg>` using
  `window.AvuzIcons`. It uses `fill` for the open app and `regular` for the
  rest, with `fill: currentColor`. So the icon follows the text color in both
  themes, and the JS URL's `?v=` busts the cache.
- Unknown apps (External sites entries, apps added later) keep today's
  `<img src="app.icon">` and the dark-mode invert filter.
- If `window.AvuzIcons` is missing (script failed), every app falls back to
  `<img>`. The rail still works.
- `--avuz-rail-icon-size` goes from 20px to 19px. The icon column stays
  centered 36px from the edge (the padding already derives from the icon size).

### Rail foot (search, notifications)

Core draws these (unified search `mdiMagnify`, the notifications app's bell
with its unread dot). `left-rail.js` hands the Material `search` and
`notifications` glyphs to the stylesheet as mask images
(`--avuz-rail-icon-*`) and adds `html.avuz-rail--material-foot`. Under that
class the stylesheet draws each glyph at 19px behind core's icon, whose path
turns transparent; the unread dot (`path.notification__dot`) stays core's
own. Without the class (icon set missing), core's icons stay.

Added 2026-10-26 after Patrick saw the old style next to the avatar. The
rail also covers settings, admin and help pages (`body#body-settings`).

### Favicon

`js/lucide-icons.js` becomes `js/favicon.js`. It keeps the same app-path map
and SPA navigation hooks, and builds the SVG data URL from `window.AvuzIcons`
(`regular`, fill `#2bb5e3`). `Application.php` registers `material-icons`
before the rail and the favicon script, and drops `lucide` and `lucide-icons`.

### CSS

`css/icons.css` still forces `stroke` and `fill: none` on header app-menu SVGs.
That would blank a filled glyph if core ever inlines one, so it changes to
`fill: currentColor; stroke: none`.

### Cache

- Rail and favicon: the new `?v=` on avuz_theme scripts (the version bump plus
  the deploy's theming cachebuster bump).
- Theme SVG files keep their URLs and are cached up to 6 months. Purge
  `/themes/avuz/apps/*` and `/apps/conectamail/img/mail.svg` in Cloudflare
  after the deploy. Browsers that cached them still show Lucide on the
  sub-1024px header until their cache expires. That's accepted.
- Clear the `imagePath-` distributed cache only if a path changes. None does.

## Update 2026-10-26: heavier, bigger, user menu

Patrick found the icons too small and thin. Every glyph moved from weight 200
to **weight 400** (300 on staging first, then "a little bit thicker"), and the rail draws them at **20px** (`WEIGHT` in
`scripts/material_symbols.py`, shared with the External sites library, whose
`superseded.json` records the earlier hashes so the boot upgrades untouched
copies). The user menu (avatar) also gets Material glyphs through theme
overrides of core's `imagePath()` icons (`settings/img/{personal,admin,apps,users,help}.svg`,
`theming/img/accessibility-dark.svg`, `core/img/actions/logout.svg`), drawn at
20px instead of 16px. The overrides live at new `/themes/avuz/…` URLs, so no
cache purge is needed for them; clear the `imagePath-` distributed cache after
the deploy so the server hands out the new paths.

## Update 2026-10-26: no collapse

Patrick removed the collapse option: the rail stays expanded. The collapse
and expand glyphs left the set (`RAIL_GLYPHS`).

## Decided by Patrick

- Library: Material Symbols Rounded. Weight 200, 19px (variant D3).

## Builder's calls

- Filled version for the open app (shown in the comparison, not objected to).
- Favicon switches; External sites stays Lucide until a follow-up.
- Glyph choices in the table (shown in the comparison page).
