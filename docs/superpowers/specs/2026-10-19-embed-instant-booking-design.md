# Instant booking from the embedded booking page — design

Date: 2026-10-19. Owner: Patrick. Repos: `avuz-conecta/avuz-server` (main change), `avuz-conecta/avuz-conecta-web` (copy).

## Why

The site's conversion is a booked demo: visitor lands on a module page → `/agendar` (app3 booking page embedded in an iframe) → picks a slot → `/agendamento-solicitado`. Today Nextcloud Calendar only creates a **pending** booking and e-mails the visitor a confirmation link; the meeting exists only after they click it. Prospects are hard to get, and many never do that last step, so warm leads are lost. Clicking "book" in the widget must **be** the booking.

## Goals

1. A booking made through the **embedded** demo booking page ("Agende sua demonstração", token `MxXcZpTEzNcH` on app3) is confirmed immediately: no confirmation e-mail, the event lands in the organizer's calendar right away.
2. The visitor gets the existing "booking accepted" e-mail (details + `.ics`) right away. When the booking page has "create a Talk room" on, that e-mail and the calendar event carry the per-meeting Talk link.
3. The organizer gets what they get today after a confirmation: their e-mail and the Nextcloud notification.
4. The site's confirmation page says the meeting is booked and the link is in the e-mail.

## Non-goals

- Changing the confirmation flow anywhere else: the same booking page opened directly on app3 (not embedded), every other booking page on app3 (other users, even if embedded or with a faked signal), and every other tenant's booking pages keep upstream behavior (confirmation e-mail first).
- Changing e-mail wording or templates. The pt_BR text ("Seu compromisso … foi aceito", "sua reserva foi aceita") stays as is (Patrick's call).
- Forcing a Talk room. The link comes from the booking page's existing "create Talk room" setting; Patrick turns it on in the Calendar UI.
- Anti-abuse beyond what exists (rate limit `AnonRateLimit 10/1200s` on `bookSlot`). Fake/junk bookings without e-mail verification are an accepted risk.

## Anti-goals (would be a failure even if it works)

- A tenant without an embed allowlist can skip confirmation by crafting a request.
- A booking is confirmed but the visitor gets no e-mail at all, or the visitor sees an error although the event was created.
- Upstream behavior changes for non-embedded bookings.
- The patch silently disappears on a Calendar upgrade (must fail the build/boot like the other overlays).

## Current behavior (Calendar 6.2.1, `apps/calendar`)

- `BookingController::bookSlot` (public, `#[AnonRateLimit]`) → `BookingService::book()`: inserts a `Booking`, sends `MailService::sendConfirmationEmail`, returns. On mail failure it deletes the booking.
- Visitor clicks the link → `BookingController::confirmBooking($token)` → `BookingService::confirmBooking($booking, $config)`: re-checks the slot, dispatches `BeforeAppointmentBookedEvent` (Calendar's own `AppointmentBookedListener` creates a public Talk conversation when `config.createTalkRoom` and sets `booking.talkUrl`), `BookingCalendarWriter::write` (event in the organizer's calendar, `LOCATION` = Talk URL or config location), marks confirmed, sends `sendBookingInformationEmail` (visitor, with Talk link as "Local:") + `sendOrganizerBookingInformationEmail` + `sendOrganizerBookingInformationNotification`. Mail failures are logged, not fatal.
- Live config (app3, token `MxXcZpTEzNcH`): name "Agende sua demonstração", organizer `jeferson@avuz.cloud`, 45 min, `createTalkRoom: false` (Patrick will turn it on).

## Embed today (`apps/avuz_theme`)

- `lib/Service/AppointmentEmbed.php`: allowlist from app config `avuz_theme.embed_allowed_origins` (synced at boot from `AVUZ_EMBED_ALLOWED_ORIGINS`; only app3 has it), `isEmbedRequested()` (`?embed=1` on `calendar.appointment.show`).
- `js/appointment-embed.js`: in a cross-site iframe there are no session cookies, so it already hooks `XMLHttpRequest`/`fetch` for the `slots` and `book` requests and adds `OCS-APIRequest: true` (CSRF proof). It marks `<html class="avuz-embed">` only when framed by an allowlisted origin, and after a `book` 200 posts `avuz:appointment-booked` {start,end,timeZone} to that origin; the site then redirects the top page to `/agendamento-solicitado`.

## Design (decided)

1. **Signal.** In embed mode (the same condition that sets `html.avuz-embed`: framed by an allowlisted origin), the embed script adds a request header to the `book` request only, e.g. `X-Avuz-Embed-Booking: 1`. Not on `slots`, not outside embed mode. Cookies can't carry this (no cookies in the cross-site iframe; Nextcloud sends `Referrer-Policy: no-referrer`, so no Referer either).
2. **Server honors the signal only when all three hold** (Patrick: only the demo page):
   - the header is present on the `book` request;
   - the instance has a non-empty embed allowlist (app config `avuz_theme.embed_allowed_origins`). Read it **without** the route check: `AppointmentEmbed::allowedOrigins()` returns `[]` unless the route is `calendar.appointment.show`, and `book` is a different route; reuse `AppointmentEmbed::parseOrigins()` on the same config value;
   - the booking page's token is in a new per-stack list, env `AVUZ_INSTANT_BOOKING_TOKENS` (comma-separated config tokens, app3: `MxXcZpTEzNcH`), synced at every boot into app config `avuz_theme.instant_booking_tokens` exactly like `AVUZ_EMBED_ALLOWED_ORIGINS` (`docker/lib-apps.sh`, `docker-compose.yml`, both `portainer-stack*.yml`, empty = off), and added to the app3 stack env on deploy.
   Anything else → upstream flow. The header is spoofable; on the listed page that only skips the e-mail check, which is the accepted risk.
3. **Instant path** = upstream `book()` minus the confirmation e-mail, then upstream `confirmBooking()` on the same booking, so the Talk room, calendar event, both e-mails and the notification come from upstream code. The only changes around it are the failure handling below.
4. **Failure handling.**
   - Slot taken between insert and confirm → delete the booking, return the same 404 the controller returns for `NoSlotFoundException`.
   - Talk room can't be created → book anyway, no link. Upstream already logs-and-returns when Talk is off / has no backend / no organizer, but an exception thrown by `IBroker::createConversation` escapes `AppointmentBookedListener` and aborts `confirmBooking`. Catch it in the listener (overlay), log a warning, continue without `talkUrl`. This also hardens the normal confirmation flow; acceptable.
   - Saving the meeting fails for another reason (`BookingCalendarWriter::write` throws: no writable calendar, CalDAV error; or the DB update fails) → **fall back to upstream** (Patrick): keep the booking pending, send the normal confirmation e-mail, return 200, and log an error (level error, with config id and booking id) so it gets noticed. Never create a second calendar event: if the event was already written and only the DB update failed, log and return 200 without sending the confirmation e-mail. Known mismatch, accepted: the site says "agendada" while the e-mail asks to confirm.
   - Booking-information e-mail fails → booking stays (upstream logs it). Visitor still sees success; Jeferson's calendar has the event and the visitor's e-mail address.
5. **Patch delivery.** Calendar is an Avuz-owned app pinned at 6.2.1 with a build-time version guard (`AVUZ_CALENDAR_OVERLAY_VERSION`). Today the calendar overlay is **JS only**: the `Dockerfile` (`cp -R …/overlays/calendar/js/.`) and `reapply_avuz_calendar_overlay` in `docker/entrypoint.sh` copy only `js/`. Extend both to copy `docker/overlays/calendar/lib/` (full-file replacements, like spreed's overlay), keep the version guard, and add a sentinel per patched PHP file to `verify_avuz_patches` (pattern: `AVUZ-CHUNKED-UPLOAD-V2` for spreed), so a Calendar upgrade or a missing overlay fails loudly.
6. **Site copy** (`avuz-conecta-web`, `src/pages/agendamento-solicitado.astro`):
   - `<h1>Demonstração agendada!</h1>`
   - note: "Enviamos para o seu e-mail os detalhes e o link da reunião no Talk. Confira também a caixa de spam."
   - fallback paragraph (no slot in the URL) and the doc comment no longer mention confirming by e-mail; slot date/time block unchanged. Also update `docs/ads-booking-conversion.md` and `docs/tags-manual.md` "Limits": the conversion is now a real booking, not a request.
7. **Docs.** Update the header comment of `appointment-embed.js` (last line says bookings stay pending) and `docker/overlays/calendar/README.md`.

## Left to the builder

- Where the server-side branch lives: patch `BookingService::book()` / `BookingController::bookSlot` in an overlay, or a small wrapper (e.g. in `avuz_theme`) that the controller calls. Recommendation: the smallest full-file overlay of `BookingController.php` or `BookingService.php`, reading the header through `IRequest` and the allowlist through `AppointmentEmbed`, because it reuses upstream `confirmBooking()` with no copied logic.
- Header name and exact value.
- Whether Calendar's own post-booking screen inside the iframe ("check your e-mail to confirm") needs hiding. The top page navigates away on the `book` 200, so it is visible for a moment at most. Hide it with the embed CSS if it shows.
- Test shape. Expected: JS test in `apps/avuz_theme/tests/js/appointment-embed.test.mjs` (header only on `book` in embed mode); PHP unit tests for the gate (header + allowlist + listed token → instant; any one missing → upstream) and the failure paths (slot taken → 404 and row deleted; writer throws → confirmation e-mail sent, 200; Talk throws → booked without link); shell test for the `AVUZ_INSTANT_BOOKING_TOKENS` sync like the embed-origins one in `docker/tests/apps.test.sh`; boot sentinel covered like spreed's.

## Rollout and verification

1. Merge to `avuz-customization`; build `./scripts/build-push.sh <YYYY.MM.DD>-<sha> prod --no-latest` (never `:latest`: ~12 tenants run it); point app3 stack 14 (endpoint 6) at the new tag **and add `AVUZ_INSTANT_BOOKING_TOKENS=MxXcZpTEzNcH`** to its env (literal line, next to `AVUZ_EMBED_ALLOWED_ORIGINS`); boot must reinstall oidc/previewgenerator by itself (it does since `81e8282`). Bump the theming cachebuster after boot (`occ config:app:set theming cachebuster`) so browsers drop the old `appointment-embed.js` — a cached old script sends no header and bookings would stay pending while the site says "agendada".
2. Patrick turns on "create Talk room" on the "Agende sua demonstração" booking page.
3. Deploy the site copy (Cloudflare Pages, `docs/tags-manual.md` §6).
4. Test on `https://www.avuzconecta.com.br/agendar` (the embed only loads on the production domain): book a slot with a real inbox → no confirmation e-mail; "accepted" e-mail arrives with the Talk link and `.ics`; event in Jeferson's calendar with the Talk link as location; organizer e-mail + notification; site shows "Demonstração agendada!". Cancel the test meeting afterwards.
5. Negative tests: the same booking page opened directly (`https://app3.avuz.app/apps/calendar/appointment/MxXcZpTEzNcH`) still sends the confirmation e-mail; a `book` request with the header for a token not in `AVUZ_INSTANT_BOOKING_TOKENS` still sends the confirmation e-mail.

## Success

Every booking on the site becomes a meeting on Jeferson's calendar with a Talk link, with zero extra steps for the visitor.
