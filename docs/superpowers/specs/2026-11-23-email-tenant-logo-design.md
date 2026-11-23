# E-mails show the client's logo (Deck #516)

Status: approved by Patrick 2026-11-23 (tenant logo; set through an admin upload field).

## Why

Ramires sends calendar invites to their own clients (Dellanno). The guest sees
the Avuz Conecta logo at the top and gets confused about who is inviting them.
Every e-mail of every tenant carries the same fixed Avuz logo today
(`apps/avuz_theme/img/logo-email.png`, 140 px wide since 2026-10-20). The
Aceitar / Recusar / Mais opções buttons already exist (dav
`invitation_link_recipients` is at its default "yes" on app3 and HML); they are
not part of this change.

## What changes

- New admin field **"Logo dos e-mails"** in Administração › Personalização
  (the theming section): preview of the logo e-mails use now, upload (PNG or
  JPEG, up to 1 MB), and "Usar o logo do Avuz Conecta" to remove it. Avuz sets it
  per client; the client's admins can change it too.
- When a tenant has a logo, it replaces the Avuz logo at the top of **all** that
  tenant's e-mails (invites, shares, password reset, welcome, Assinaturas — they
  share one template). Without one, e-mails stay as today.
- The logo fits in 140 × 56 px, aspect ratio kept (width/height attributes for
  Outlook). The footer keeps "Avuz Conecta" small (the "via Avuz Conecta").
- Nothing else changes: login page and screens keep the Avuz branding.

## Design

- `OCA\AvuzTheme\Service\EmailLogo`: stores the image in the app's IAppData
  (folder `email-logo`, works on S3), re-encoded as PNG with GD (drops metadata
  and anything that is not a plain image), max 2000 × 2000 source pixels;
  app config `email_logo_version` (cache-bust) and the stored pixel size.
  `save(string $bytes)`, `remove()`, `current(): ?array{url, width, height}`
  where width/height are already fitted to 140 × 56.
- Public route `GET /apps/avuz_theme/email-logo` serves the PNG (mail clients
  fetch it anonymously), `Cache-Control: public, max-age=86400`, 404 when none;
  URLs carry `?v=<version>`.
- Admin-only routes (no NoAdminRequired, CSRF required): `POST
  /apps/avuz_theme/email-logo` (multipart `logo`), `DELETE
  /apps/avuz_theme/email-logo`.
- `EMailTemplate::addHeader()` uses `EmailLogo::current()` when set, the Avuz
  logo otherwise. The template is built by core with a fixed constructor, so it
  looks the service up through `OCP\Server`; tests override that lookup.
- Admin section: `Settings\EmailLogoAdmin` (section `theming`), template +
  vanilla `js/email-logo-admin.js`, pt_BR text in place (as the IP-access page).

## Tests

- PHPUnit: EmailLogo (rejects non-images, >1 MB, too large; re-encodes; fit
  140 × 56 for wide/tall/small logos), controller (show 404/200 + headers;
  upload/remove), EMailTemplate (tenant logo with fitted size; fallback).
- HML: upload a logo through the admin page, render a calendar invite with the
  real template in the container (no send) and fetch its logo URL anonymously;
  remove → Avuz logo back.

## Out of scope

Login page/theming logo, per-user logos, SVG logos (mail clients don't render
SVG reliably).
