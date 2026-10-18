# Avuz Conecta design system

Tokens and component rules for engineers building Avuz Conecta screens: Drive, Tarefas, Agenda, Talk, Conecta Mail, Assinaturas, and the theme around them.

## Principles

1. **Clear hierarchy.** One primary action per view. Title, then content, then secondary actions. Size and weight carry the order, not color.
2. **Few colors.** Neutrals do most of the work. Brand blue `#2bb5e3` marks the brand and focus; action blue `#00679e` marks what you click; olive `#d2e314` marks what is new. Red and green mean status, nothing else.
3. **Generous spacing.** 4px grid. When in doubt, add one step of space before adding a border or a color.
4. **Real content.** Design and test with real Portuguese text: card titles, contract names, CPF-length fields, long company names. No lorem ipsum.
5. **No generic dashboard look.** No stat-tile walls, no gradient hero cards, no decorative charts. Show the user's work (cards, contracts, files) and the next step.
6. **Accessible by default.** WCAG AA contrast (numbers in [tokens.md](tokens.md#contrast)), visible focus, 44px touch targets, works at 390px wide.

## How to use

**Inside Avuz Conecta apps** (Vue/PHP templates that run in the instance): use the theming vars (`var(--color-primary-element)` and friends). The instance derives them from the tenant's primary color and switches dark mode itself. Define app tokens as aliases of them, as Assinaturas does:

```css
.my-app {
	--av-action: var(--color-primary-element);
	--av-action-hover: var(--color-primary-element-hover);
	--av-on-fill: var(--color-primary-element-text);
}
```

Full mapping: [tokens.md › In-app mapping](tokens.md#in-app-mapping-theming-vars).

**Outside the app shell** (site, emails, static pages, prototypes): include [`tokens.css`](tokens.css) and use the `--avuz-*` properties.

```html
<html data-theme="dark"> <!-- optional; without it, prefers-color-scheme decides -->
<link rel="stylesheet" href="tokens.css">
```

Rules that hold in both places:

- Never white text on `#2bb5e3` (2.38:1). Filled buttons use `#00679e` in light mode.
- Never blue and olive both as text colors.
- Never hard-code a hex inside an app that a theming var covers.
- Call the product "Avuz Conecta" in UI copy and docs.

## Files

| File | Contents |
|---|---|
| [tokens.md](tokens.md) | Colors (light/dark), in-app mapping, contrast table, type, spacing, radius, shadows |
| [tokens.css](tokens.css) | The same tokens as `--avuz-*` CSS custom properties |
| [components.md](components.md) | Buttons, cards, tags, tables, forms, empty states: anatomy, tokens, states |
| [components.html](components.html) | Static preview of every component, light and dark side by side |
