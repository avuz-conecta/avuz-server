# Assinaturas Plan 6 — Theme Colour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assinaturas buttons, links, focus rings and selections use the Nextcloud theme colour instead of the fixed `#00679e`.

**Architecture:** The app's colour tokens live on `.av-root` in `src/styles/identity.css`. The action tokens and the tint tokens get `var(--color-primary-*)` values from Nextcloud's theming app. A new `--av-on-action` token labels filled actions. `--av-on-fill` stays white for ink and signer fills. Focus rings and selection outlines move from the fixed `--av-brand` to `--av-action`, and `--av-brand` goes away. Vitest specs check the CSS source with the existing `src/test-support/css-rules.ts` helpers.

**Tech Stack:** Vue 3.5 SFC scoped CSS, TypeScript strict, Vite 7, Vitest 4 (happy-dom), postcss-based CSS assertions, Nextcloud 33 theming variables.

**Spec:** `docs/superpowers/specs/2026-10-07-assinaturas-theme-color-design.md` (avuz-server repo).

**Code repo:** `/Users/patrickrezende/work/avuz/assinaturas` (every path below is relative to it).

## Global Constraints

- App version bump at the end of the plan: `appinfo/info.xml` → `0.4.10` (package.json has no version on purpose).
- Gates, each run separately, all exit 0: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` (commit built `js/` and `css/`).
- PHP gates only if PHP changes: `composer run lint`, `tests/env/phpunit.sh`. This plan changes no PHP, so neither runs. `tests/env/phpunit.sh` auto-runs `tests/env/reset.sh` when the local `avuzconecta:latest` image id differs from `~/.assinaturas-test-image-id`. Never rebuild that image during the plan. Stop and ask if a reset would happen.
- TypeScript: no `any`, almost no `as`, named exports, no barrel files, async/await, hash maps over switch, named constants (no magic strings/numbers), early returns, descriptive names. Vue: no constants or functions declared inside components when avoidable.
- Tests describe behaviour in 3rd person ("shows…"), never "should". Test behaviour, not implementation.
- WCAG 2.x AA: text 4.5:1, non-text 3:1, visible focus.
- White label: no user-facing string names ZapSign (an existing Vitest guard enforces it). This plan adds no strings.
- Commits: conventional messages, NO AI attribution lines (no Co-Authored-By). Branch off app `main`.
- No new fixed colours (spec): every changed colour token reads a Nextcloud variable. Status colours (`--av-info-*`, `--av-success-*`, `--av-warning-*`, `--av-danger-*`, `--av-neutral-*`), the status dot `--av-brand-dot` and the signer palette `--av-signer-*` stay as they are.
- Out of scope (spec): the Questrial font, icons, layout and illustrations.
- Staging verification (conecta-2) is done by the controller after the plan, not by tasks. Task 3 lists the screenshots and contrast checks.

## Colour evidence (Nextcloud 33, Avuz Conecta)

Avuz sets `primary_color "#1c7fa0"` (`docker/entrypoint.sh:429`) and `enforce_theme 'light'` (`docker/entrypoint.sh:408`). The spec's `#2bb5e3` is the brand dot, not the theme colour. Nextcloud computes the variables in `apps/theming/lib/Themes/CommonThemeTrait.php:27-66`. Conecta-2 serves these values (`/index.php/apps/theming/theme/light.css`, fetched 2026-10-07):

| Nextcloud variable | Value | App token | Contrast (WCAG) |
|---|---|---|---|
| `--color-primary-element` | `#1c7fa0` | `--av-action` | 4.57:1 on panel `#ffffff`; 4.05:1 on ground `#f1f1f1` |
| `--color-primary-element-hover` | `#176782` | `--av-action-hover` | 6.37:1 on `#ffffff` |
| `--color-primary-element-text` | `#ffffff` | `--av-on-action` (new) | 4.57:1 on `#1c7fa0`; 6.37:1 on `#176782` |
| `--color-primary-light` | `#e8f2f5` | `--av-tint` | background |
| `--color-primary-light-text` | `#0b3240` | `--av-tint-text` | 11.95:1 on `#e8f2f5` |
| `--color-primary-element-text-dark` | `#ededed` | not used | 3.91:1 on `#1c7fa0` |

Choices the table backs:

- **Action-coloured text on light surfaces uses `--av-action` itself.** `--color-primary-element-text-dark` exists, but it is not a text colour for light backgrounds. Nextcloud uses it for disabled labels on a primary fill (`core/css/inputs.scss:146-152`), and here it is near-white `#ededed`. The spec's fallback applies: `--color-primary-element` reaches 4.57:1 on the panel `#ffffff`. Every action-coloured text (outline, ghost and link buttons in `AvButton.vue`, `DetailHeader.vue`, `ProgressCard.vue`, `SidebarEnvelopeCard.vue`, `PlacementSheet.vue`, `ListPagination.vue`) sits on `--av-panel` or on the Files sidebar's white. Action-coloured icons on `--av-canvas-fill` (4.14:1) and `--av-tint` (4.02:1) are non-text and need 3:1.
- **`--av-on-action` is a new token. `--av-on-fill` keeps `#ffffff`.** `--av-on-fill` also labels ink fills (`AvChip`, `DocumentSwitcher`, `WizardStepper` current step, the phone placement hint) and signer-coloured avatars (`AvAvatar`). Nextcloud picks black on a bright primary, and black on ink `#1d2730` would be about 1.2:1. Only labels on action fills follow the theme: the primary `AvButton` and the done `WizardStepper` marker. The switch knob stays `--av-on-fill`. It is not a label, and it is 4.57:1 on `#1c7fa0`.
- **Focus rings and selections move from `--av-brand` to `--av-action`.** Today the ring is `#2bb5e3`: 2.38:1 on white, below 3:1. With `--av-action` it is 4.57:1 on the panel and 4.05:1 on the ground. A selected placement box border is 3.90–4.08:1 on the six signer fills. Nothing else uses `--av-brand`, so the token is deleted.
- **Dark mode cannot be reached.** `enforce_theme 'light'` disables the theme picker, and the app's surfaces (`--av-panel`, `--av-ground`) are fixed light colours. The spec's dark-mode line is therefore satisfied with no extra work. Task 3 drops the dark-mode screenshots and confirms the enforced theme instead.
- **`#00679e` remains in two tokens on purpose.** `--av-info-dot` is a status colour and `--av-signer-0-stroke` is a signer colour, and the spec keeps both. The Vitest guard therefore allows the old blues only in the info status and first-signer tokens. It does not ban the hex from `src/`.

## File map

| File | Change | Task |
|---|---|---|
| `src/styles/identity.css` | Action/tint tokens read Nextcloud variables; add `--av-on-action`; focus ring in `--av-action`; delete `--av-brand` | 1, 2 |
| `src/styles/identity.spec.ts` | Theme-colour token guards; focus ring expectation; no `var(--av-brand)` left | 1, 2 |
| `src/ui/AvButton.vue` | Primary label `--av-on-action` | 1 |
| `src/ui/AvButton.spec.ts` | Primary fill/label and outline/ghost text guards | 1 |
| `src/wizard/WizardStepper.vue` | Done marker label `--av-on-action` | 1 |
| `src/wizard/wizard-stepper-styles.spec.ts` | New: done/current marker paint | 1 |
| `src/dashboard/EnvelopeCards.vue` | Card focus ring `--av-action` | 2 |
| `src/dashboard/envelope-cards-styles.spec.ts` | Ring expectation | 2 |
| `src/placement/DocumentRail.vue` | Selected page outline `--av-action` | 2 |
| `src/placement/document-rail-styles.spec.ts` | Ring colour guard | 2 |
| `src/placement/PlacementBox.vue` | Selected border and handles `--av-action` | 2 |
| `src/placement/placement-box-styles.spec.ts` | New: selected border and handle ring | 2 |
| `src/detail/DetailHeader.vue` | Comment no longer names `#00679e` | 2 |
| `appinfo/info.xml`, `js/`, `css/` | 0.4.10 and the build | 3 |

---

### Task 1: Action tokens read the Nextcloud theme

**Files:**
- Modify: `src/styles/identity.css` (token block, lines 11 and 23-26)
- Modify: `src/ui/AvButton.vue` (`.av-button--primary`, lines 71-74)
- Modify: `src/wizard/WizardStepper.vue` (`.wizard-stepper__step--done .wizard-stepper__marker`, lines 136-139)
- Test: `src/styles/identity.spec.ts`, `src/ui/AvButton.spec.ts`
- Create: `src/wizard/wizard-stepper-styles.spec.ts`

**Interfaces:**
- Consumes: Nextcloud CSS variables `--color-primary-element`, `--color-primary-element-hover`, `--color-primary-element-text`, `--color-primary-light`, `--color-primary-light-text` (defined on `[data-theme-light]`, on `<body>`). The test helpers come from `src/test-support/css-rules.ts`: `parseStylesheet(css): Stylesheet`, `scopedStyleOf(source): Stylesheet`, `Stylesheet.valueOf(selector, property): string | undefined`, `Stylesheet.declarationsOf(property: string | RegExp): CssDeclaration[]`.
- Produces: the CSS custom property `--av-on-action` on `.av-root` (the label colour on an action fill). `--av-action`, `--av-action-hover`, `--av-tint` and `--av-tint-text` keep their names with the new values. `--av-on-fill` stays `#ffffff`. Task 2 uses `--av-action` for rings and selections.

- [ ] **Step 0: Branch off app `main`**

```bash
cd /Users/patrickrezende/work/avuz/assinaturas
git switch main && git pull --ff-only && git switch -c plan-6-theme-color
```

Expected: `Switched to a new branch 'plan-6-theme-color'`, and `git status --short` prints nothing.

- [ ] **Step 1: Write the failing token guards in `src/styles/identity.spec.ts`**

Add these constants after `const DISABLED_KIT_FIELD = '.av-root :is(input, textarea, select):where(.av-input):disabled'` (line 23):

```ts
const THEME_COLOUR_TOKENS: Record<string, string> = {
	'--av-action': 'var(--color-primary-element)',
	'--av-action-hover': 'var(--color-primary-element-hover)',
	'--av-on-action': 'var(--color-primary-element-text)',
	'--av-tint': 'var(--color-primary-light)',
	'--av-tint-text': 'var(--color-primary-light-text)',
}
const FIXED_ACTION_BLUES = /#00679e|#004f7a|#00557f|#e3f5fc/i
const STATUS_AND_SIGNER_BLUES = ['--av-info-fill', '--av-info-text', '--av-info-dot', '--av-signer-0-stroke', '--av-signer-0-fill']
const WHITE = '#ffffff'
```

Inside `describe('design tokens', …)`, after the `it('keeps every colour of the components on a --av token', …)` block, add:

```ts
		describe('theme colour', () => {
			it.each(Object.entries(THEME_COLOUR_TOKENS))('resolves %s to Nextcloud\'s %s', (token, nextcloudVariable) => {
				expect(identity.valueOf('.av-root', token)).toBe(nextcloudVariable)
			})

			it('keeps the fixed blues only in the info status and the first signer\'s colours', () => {
				const fixedBlues = identity.declarationsOf(/^--av-/).filter(({ value }) => FIXED_ACTION_BLUES.test(value))

				expect(fixedBlues.map(({ property }) => property)).toEqual(STATUS_AND_SIGNER_BLUES)
			})

			it('keeps a white label on ink and signer fills, whatever the theme colour', () => {
				expect(identity.valueOf('.av-root', '--av-on-fill')).toBe(WHITE)
			})
		})
```

- [ ] **Step 2: Write the failing button guards in `src/ui/AvButton.spec.ts`**

Before the last line of the file (the closing `})` of `describe('AvButton', …)`), add:

```ts

	describe('in the theme colour', () => {
		const style = scopedStyleOf(BUTTON_SOURCE)

		it('fills a primary button with the action colour and labels it in the colour Nextcloud picks for that fill', () => {
			expect(style.valueOf('.av-button--primary', '--av-control-fill')).toBe('var(--av-action)')
			expect(style.valueOf('.av-button--primary', '--av-control-text')).toBe('var(--av-on-action)')
			expect(style.valueOf('.av-button--primary:hover', '--av-control-fill')).toBe('var(--av-action-hover)')
		})

		it('draws outline and ghost buttons in the action colour', () => {
			expect(style.valueOf('.av-button--outline', '--av-control-border')).toBe('var(--av-action)')
			expect(style.valueOf('.av-button--outline', '--av-control-text')).toBe('var(--av-action)')
			expect(style.valueOf('.av-button--ghost', '--av-control-text')).toBe('var(--av-action)')
			expect(style.valueOf('.av-button--ghost:hover', '--av-control-text')).toBe('var(--av-action-hover)')
		})
	})
```

- [ ] **Step 3: Create `src/wizard/wizard-stepper-styles.spec.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { scopedStyleOf } from '../test-support/css-rules.ts'
import STEPPER_SOURCE from './WizardStepper.vue?raw'

const style = scopedStyleOf(STEPPER_SOURCE)

const DONE_MARKER = '.wizard-stepper__step--done .wizard-stepper__marker'
const CURRENT_MARKER = '.wizard-stepper__step--current .wizard-stepper__marker'

describe('WizardStepper styles', () => {
	it('fills a done step\'s marker with the action colour and draws its check in the colour Nextcloud picks for that fill', () => {
		expect(style.valueOf(DONE_MARKER, 'background')).toBe('var(--av-action)')
		expect(style.valueOf(DONE_MARKER, 'color')).toBe('var(--av-on-action)')
	})

	it('keeps the current step\'s ink marker labelled in white', () => {
		expect(style.valueOf(CURRENT_MARKER, 'background')).toBe('var(--av-ink)')
		expect(style.valueOf(CURRENT_MARKER, 'color')).toBe('var(--av-on-fill)')
	})
})
```

- [ ] **Step 4: Run the new guards to see them fail**

Run: `npx vitest run src/styles/identity.spec.ts src/ui/AvButton.spec.ts src/wizard/wizard-stepper-styles.spec.ts`

Expected: FAIL with 8 failing tests. All five `resolves --av-… to Nextcloud's var(--color-…)` tests fail (for example `expected '#00679e' to be 'var(--color-primary-element)'`, and `expected undefined to be 'var(--color-primary-element-text)'` for `--av-on-action`). `keeps the fixed blues only…` fails on an array that also lists `--av-action`, `--av-action-hover`, `--av-tint` and `--av-tint-text`. `fills a primary button…` fails with `expected 'var(--av-on-fill)' to be 'var(--av-on-action)'`. `fills a done step's marker…` fails the same way. The white-label, outline/ghost and current-marker tests pass already.

- [ ] **Step 5: Point the tokens at the Nextcloud theme in `src/styles/identity.css`**

Replace:

```css
	--av-action: #00679e;
	--av-action-hover: #004f7a;
	--av-tint: #e3f5fc;
	--av-tint-text: #00557f;
```

with:

```css
	/* Nextcloud's theme colour (theming app), so the app matches the rest of the instance and follows a tenant's own colour. */
	--av-action: var(--color-primary-element);
	--av-action-hover: var(--color-primary-element-hover);
	/* The label on an action fill: Nextcloud picks black or white for 4.5:1 against it. --av-on-fill stays white for ink and signer fills. */
	--av-on-action: var(--color-primary-element-text);
	--av-tint: var(--color-primary-light);
	--av-tint-text: var(--color-primary-light-text);
```

Leave `--av-on-fill: #ffffff;` (line 11) as it is.

- [ ] **Step 6: Label the primary button with `--av-on-action` in `src/ui/AvButton.vue`**

Replace:

```css
.av-button--primary {
	--av-control-fill: var(--av-action);
	--av-control-text: var(--av-on-fill);
}
```

with:

```css
.av-button--primary {
	--av-control-fill: var(--av-action);
	--av-control-text: var(--av-on-action);
}
```

- [ ] **Step 7: Label the done stepper marker with `--av-on-action` in `src/wizard/WizardStepper.vue`**

Replace:

```css
.wizard-stepper__step--done .wizard-stepper__marker {
	background: var(--av-action);
	color: var(--av-on-fill);
}
```

with:

```css
.wizard-stepper__step--done .wizard-stepper__marker {
	background: var(--av-action);
	color: var(--av-on-action);
}
```

- [ ] **Step 8: Run the guards to see them pass**

Run: `npx vitest run src/styles/identity.spec.ts src/ui/AvButton.spec.ts src/wizard/wizard-stepper-styles.spec.ts`

Expected: PASS, `Test Files  3 passed (3)`.

- [ ] **Step 9: Run the gates, each on its own**

Run: `npm run typecheck` → exit 0, no output after the script banner.
Run: `npm run lint` → exit 0, no problems reported.
Run: `npm test` → exit 0, `Test Files  89 passed (89)`, `Tests  1792 passed (1792)`.

- [ ] **Step 10: Commit**

```bash
git add src/styles/identity.css src/styles/identity.spec.ts src/ui/AvButton.vue src/ui/AvButton.spec.ts src/wizard/WizardStepper.vue src/wizard/wizard-stepper-styles.spec.ts
git commit -m "feat(theme): paint buttons and links in the Nextcloud theme colour" -m "The action and tint tokens read --color-primary-element*, --color-primary-light*. Filled actions are labelled in --av-on-action (Nextcloud's contrast pick); --av-on-fill stays white for ink and signer fills."
```

---

### Task 2: Focus rings and selections follow the action colour

**Files:**
- Modify: `src/styles/identity.css` (delete `--av-brand`, line 22; `:focus-visible` rule, lines 234-240)
- Modify: `src/dashboard/EnvelopeCards.vue:97-100`
- Modify: `src/placement/DocumentRail.vue:293-298`
- Modify: `src/placement/PlacementBox.vue:391-396`, `:419-426`, `:428-429`
- Modify: `src/detail/DetailHeader.vue:169` (comment only)
- Test: `src/styles/identity.spec.ts`, `src/dashboard/envelope-cards-styles.spec.ts`, `src/placement/document-rail-styles.spec.ts`
- Create: `src/placement/placement-box-styles.spec.ts`

**Interfaces:**
- Consumes: `--av-action` from Task 1 (`var(--color-primary-element)`), and the `describe('theme colour', …)` block plus the `tokensDeclared` and `declarationsOfComponents` helpers that already exist in `src/styles/identity.spec.ts`.
- Produces: `--av-brand` no longer exists. Focus rings and selection outlines use `var(--av-action)`. `--av-brand-dot` does not change.

- [ ] **Step 1: Update and add the identity guards in `src/styles/identity.spec.ts`**

Add after `const WHITE = '#ffffff'`:

```ts
const BRAND_REFERENCE = /var\(--av-brand\)/
```

In `it('guards the kit focus ring against the !important Nextcloud ring', …)`, replace:

```ts
			expect(identity.valueOf(KIT_BUTTON_FOCUS_RING, 'outline')).toBe('2px solid var(--av-brand) !important')
```

with:

```ts
			expect(identity.valueOf(KIT_BUTTON_FOCUS_RING, 'outline')).toBe('2px solid var(--av-action) !important')
```

Inside `describe('theme colour', …)`, after the white-label test, add:

```ts
			it('draws focus rings and selections in the action colour instead of the fixed brand blue', () => {
				const brandReferences = declarationsOfComponents(/./).filter(({ value }) => BRAND_REFERENCE.test(value))

				expect(brandReferences).toEqual([])
				expect(tokensDeclared).not.toContain('--av-brand')
			})
```

- [ ] **Step 2: Update the card ring guard in `src/dashboard/envelope-cards-styles.spec.ts`**

Replace:

```ts
			expect(style.valueOf('.envelope-card__title:focus-visible::after', 'outline')).toBe('2px solid var(--av-brand)')
```

with:

```ts
			expect(style.valueOf('.envelope-card__title:focus-visible::after', 'outline')).toBe('2px solid var(--av-action)')
```

- [ ] **Step 3: Add the rail ring guard in `src/placement/document-rail-styles.spec.ts`**

Replace the doc comment:

```ts
/** `outline: 2px solid var(--av-brand)` → its width. */
```

with:

```ts
/** `outline: 2px solid var(--av-action)` → its width. */
```

After `it('keeps the ring of the selected page inside the card', …)`, add:

```ts

		it('rings the selected page in the action colour', () => {
			expect(rail.valueOf('.document-rail__thumbnail--current', 'outline')).toBe('2px solid var(--av-action)')
		})
```

- [ ] **Step 4: Create `src/placement/placement-box-styles.spec.ts`**

```ts
import { describe, expect, it } from 'vitest'
import { scopedStyleOf } from '../test-support/css-rules.ts'
import BOX_SOURCE from './PlacementBox.vue?raw'

const style = scopedStyleOf(BOX_SOURCE)

describe('PlacementBox styles', () => {
	describe('when selected', () => {
		it('borders the box in the action colour', () => {
			expect(style.valueOf('.placement-box--selected', '--av-control-border')).toBe('var(--av-action)')
		})

		it('rings its resize handles in the action colour', () => {
			expect(style.valueOf('.placement-box__handle', 'border')).toBe('1.5px solid var(--av-action)')
		})
	})
})
```

- [ ] **Step 5: Run the guards to see them fail**

Run: `npx vitest run src/styles/identity.spec.ts src/dashboard/envelope-cards-styles.spec.ts src/placement/document-rail-styles.spec.ts src/placement/placement-box-styles.spec.ts`

Expected: FAIL with 6 failing tests:
- `guards the kit focus ring…` (`expected '2px solid var(--av-brand) !important'…`)
- `draws focus rings and selections…` (lists the `var(--av-brand)` declarations in `EnvelopeCards.vue`, `DocumentRail.vue` and `PlacementBox.vue`)
- `draws the focus ring around the card…`
- `rings the selected page in the action colour`
- `borders the box in the action colour`
- `rings its resize handles in the action colour`

- [ ] **Step 6: Move the kit focus ring and delete `--av-brand` in `src/styles/identity.css`**

Delete the line:

```css
	--av-brand: #2bb5e3;
```

Replace:

```css
.av-root :focus-visible,
.av-root button.av-control[type]:focus-visible {
	outline: 2px solid var(--av-brand) !important;
```

with:

```css
.av-root :focus-visible,
.av-root button.av-control[type]:focus-visible {
	outline: 2px solid var(--av-action) !important;
```

- [ ] **Step 7: Move the card ring in `src/dashboard/EnvelopeCards.vue`**

Replace:

```css
.envelope-card__title:focus-visible::after {
	outline: 2px solid var(--av-brand);
```

with:

```css
.envelope-card__title:focus-visible::after {
	outline: 2px solid var(--av-action);
```

- [ ] **Step 8: Move the selected-page outline in `src/placement/DocumentRail.vue`**

Replace:

```css
/* Line 297: the selected page takes a white border inside a 2px brand outline. */
.document-rail__thumbnail--current {
	--av-control-border: var(--av-panel);
	outline: 2px solid var(--av-brand);
```

with:

```css
/* Line 297: the selected page takes a white border inside a 2px outline in the action colour. */
.document-rail__thumbnail--current {
	--av-control-border: var(--av-panel);
	outline: 2px solid var(--av-action);
```

- [ ] **Step 9: Move the selected box border and handles in `src/placement/PlacementBox.vue`**

Replace:

```css
/* Lines 162-169: the selected box takes a solid brand border and four white handles. */
.placement-box--selected {
	--av-control-border: var(--av-brand);
```

with:

```css
/* Lines 162-169: the selected box takes a solid border in the action colour and four white handles. */
.placement-box--selected {
	--av-control-border: var(--av-action);
```

Replace:

```css
.placement-box__handle {
	position: absolute;
	box-sizing: border-box;
	border: 1.5px solid var(--av-brand);
```

with:

```css
.placement-box__handle {
	position: absolute;
	box-sizing: border-box;
	border: 1.5px solid var(--av-action);
```

Replace:

```css
 * Phone-Placement.dc.html lines 47-50: white circles with a 2px brand ring. A finger reaches each one in a 44px
```

with:

```css
 * Phone-Placement.dc.html lines 47-50: white circles with a 2px ring in the action colour. A finger reaches each one in a 44px
```

- [ ] **Step 10: Drop the fixed hex from the comment in `src/detail/DetailHeader.vue`**

Replace:

```css
/* The artboard's "Alterar prazo" is an `<a href="#">` coloured #00679e; it opens a dialog, so it is a button that looks like that link. */
```

with:

```css
/* The artboard's "Alterar prazo" is an `<a href="#">` in the action colour; it opens a dialog, so it is a button that looks like that link. */
```

- [ ] **Step 11: Run the guards to see them pass**

Run: `npx vitest run src/styles/identity.spec.ts src/dashboard/envelope-cards-styles.spec.ts src/placement/document-rail-styles.spec.ts src/placement/placement-box-styles.spec.ts`

Expected: PASS, `Test Files  4 passed (4)`.

Run: `grep -rn "var(--av-brand)" src`
Expected: no output, exit 1.

- [ ] **Step 12: Run the gates, each on its own**

Run: `npm run typecheck` → exit 0.
Run: `npm run lint` → exit 0, no problems reported.
Run: `npm test` → exit 0, `Test Files  90 passed (90)`, `Tests  1796 passed (1796)`.

- [ ] **Step 13: Commit**

```bash
git add src/styles/identity.css src/styles/identity.spec.ts src/dashboard/EnvelopeCards.vue src/dashboard/envelope-cards-styles.spec.ts src/placement/DocumentRail.vue src/placement/document-rail-styles.spec.ts src/placement/PlacementBox.vue src/placement/placement-box-styles.spec.ts src/detail/DetailHeader.vue
git commit -m "fix(theme): draw focus rings and selections in the theme colour" -m "Rings, the selected page and the selected placement box used --av-brand (#2bb5e3, 2.4:1 on white, below the 3:1 non-text minimum). They now use --av-action (4.6:1 on the panel, 4.1:1 on the ground). --av-brand had no other user and is removed."
```

---

### Task 3: Release 0.4.10 and hand over the staging checks

**Files:**
- Modify: `appinfo/info.xml:8`
- Modify (generated): `js/`, `css/`

**Interfaces:**
- Consumes: the source changes from Tasks 1–2.
- Produces: app version `0.4.10` with the built `js/` and `css/` committed. The controller pins this commit in avuz-server (`apps/assinaturas`).

- [ ] **Step 1: Bump the version in `appinfo/info.xml`**

Replace:

```xml
    <version>0.4.9</version>
```

with:

```xml
    <version>0.4.10</version>
```

The bump also changes Nextcloud's `?v=` cache-buster, so cached browsers load the new CSS.

- [ ] **Step 2: Run the gates, each on its own**

Run: `npm run typecheck` → exit 0.
Run: `npm run lint` → exit 0, no problems reported.
Run: `npm test` → exit 0, `Test Files  90 passed (90)`, `Tests  1796 passed (1796)`.
Run: `npm run build` → exit 0, ends with Vite's `✓ built in …`.

- [ ] **Step 3: Check the build output carries the theme variables**

Run: `grep -l "color-primary-element" css/*.css | head`
Expected: at least one file that holds the identity tokens, for example `css/assinaturas-main.css` or an `identity-*.chunk.css`.

Run: `grep -c "#004f7a" css/*.css js/*.mjs | grep -v ":0"`
Expected: no output (the old hover blue has gone from the build).

- [ ] **Step 4: Confirm no PHP changed, so the PHP gates are skipped**

Run: `git diff --stat main -- lib appinfo/routes.php tests/Unit tests/Integration`
Expected: no output. Do not run `tests/env/phpunit.sh`.

- [ ] **Step 5: Commit the release**

```bash
git add appinfo/info.xml js css
git status --short
```

Expected: only staged `appinfo/info.xml`, `js/…` and `css/…` entries. No untracked files remain under `js/` or `css/`.

```bash
git commit -m "chore: release 0.4.10 (theme colour)"
```

- [ ] **Step 6: Hand the staging checklist to the controller (no action in this task)**

The controller runs these checks on conecta-2 after it pins `0.4.10` in avuz-server and deploys `:staging-2`.

Before deploying, take the **before** screenshots on the running 0.4.9. After deploying, take the **after** screenshots. Use the same user, the same envelope and a desktop viewport (1440×900), plus a phone viewport (390×844) for the wizard placement step:

1. Dashboard: the header with the primary "Novo envelope" button, a card with keyboard focus (Tab), and pagination.
2. Wizard, Documents step: tiles and the "Principal" tag.
3. Wizard, Signers step: the "how it works" icon.
4. Wizard, Placement step: a selected box with handles, the selected page in the document rail, and on the phone the bottom sheet's "+" signer button.
5. Wizard, Review step: the "Editar" ghost buttons, the done stepper markers and the primary send button (hover it).
6. Detail page: the "Alterar prazo" link, the progress card link, the document ghost buttons and a focused button.
7. Admin page (`/settings/admin/assinaturas`): no visual change is expected, because the page uses no `--av-*` tokens.
8. Files sidebar tab: the envelope card link and the primary send button.
9. Navigation: the current item (tint fill, tint text).

Dark mode: skip it. `enforce_theme` is `light` on every tenant (`docker/entrypoint.sh:408`). Confirm this with `occ config:system:get enforce_theme`, which should print `light`.

Measure contrast in the browser console on the after-deploy pages. Paste this into the console:

```js
const luminance = (rgb) => rgb.match(/\d+/g).slice(0, 3).map(Number).map((channel) => channel / 255).map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0)
const contrast = (foreground, background) => { const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a); return ((lighter + 0.05) / (darker + 0.05)).toFixed(2) }
const paint = (selector) => getComputedStyle(document.querySelector(selector))
```

Then call `contrast(paint('<selector>').color, paint('<selector>').backgroundColor)` (or `outlineColor` against the surface behind it). Expected values with the Avuz primary `#1c7fa0`:

| Check | Pair | Expected | Minimum |
|---|---|---|---|
| Label on a filled button | `#ffffff` on `#1c7fa0` | 4.57 | 4.5 |
| Label on a hovered filled button | `#ffffff` on `#176782` | 6.37 | 4.5 |
| Link on the panel ("Alterar prazo", "Corrigir e-mail") | `#1c7fa0` on `#ffffff` | 4.57 | 4.5 |
| Outline button text (pagination, back) | `#1c7fa0` on `#ffffff` | 4.57 | 4.5 |
| Navigation current item | `#0b3240` on `#e8f2f5` | 11.95 | 4.5 |
| Focus ring on the panel | `#1c7fa0` vs `#ffffff` | 4.57 | 3 |
| Focus ring on the ground | `#1c7fa0` vs `#f1f1f1` | 4.05 | 3 |
| Selected placement box on a signer fill | `#1c7fa0` vs `#f1eafd` (lowest) | 3.90 | 3 |
| Icon tile | `#1c7fa0` on `#f1f4f6` | 4.14 | 3 |

If any value comes in below its minimum, stop and report. Do not adjust colours on staging.
