# Instant booking from the embedded demo page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A booking made on the embedded demo booking page (app3, token `MxXcZpTEzNcH`) is confirmed at once: event in the organizer's calendar, "accepted" e-mail with the Talk link, no confirmation e-mail.

**Architecture:** The embed script adds a header to the `book` request in embed mode. A small gate in `avuz_theme` (`InstantBooking`) accepts it only when the instance has an embed allowlist and the page token is in `AVUZ_INSTANT_BOOKING_TOKENS`. A Calendar 6.2.1 PHP overlay (full-file replacements, like spreed's) routes allowed requests to a new `BookingService::bookInstantly()` that inserts the booking and runs upstream `confirmBooking()`, with the spec's failure fallbacks; the Talk listener stops letting exceptions abort a booking.

**Tech Stack:** Nextcloud 33 / Calendar 6.2.1 (PHP 8), PHPUnit 13, vanilla JS + `node:test`, bash boot scripts, Astro site (`avuz-conecta-web`).

**Spec:** `docs/superpowers/specs/2026-10-19-embed-instant-booking-design.md`

## Global Constraints

- Calendar version pinned: `6.2.1` (`AVUZ_CALENDAR_OVERLAY_VERSION`); overlay PHP files are full copies of the 6.2.1 files from `apps/calendar/lib/` with the minimal change.
- Gate = header present **and** `avuz_theme.embed_allowed_origins` parses to ≥1 origin (read without the `_route` check) **and** config token listed in `avuz_theme.instant_booking_tokens`. Anything else → upstream `book()`.
- Env `AVUZ_INSTANT_BOOKING_TOKENS`: comma-separated config tokens, empty = off, synced every boot to app config `avuz_theme instant_booking_tokens` (string).
- Header: `X-Avuz-Embed-Booking: 1`, only on the `book` request, only in embed mode.
- E-mail templates and pt_BR wording unchanged.
- Never push `:latest`; release with `./scripts/build-push.sh <YYYY.MM.DD>-<sha> prod --no-latest`.
- Commit messages: no Claude/AI attribution (user rule).
- PHP tests run with `/private/tmp/avuz-theme-phpunit/vendor/bin/phpunit` (PHPUnit 13.4). If missing: `composer require --working-dir=/private/tmp/avuz-theme-phpunit phpunit/phpunit:^13.4 psr/event-dispatcher:^1.0`. JS tests: `node --test <file>`. Shell tests: `docker run --rm -v "$PWD/docker:/w/docker:ro" -w /w bash:5.2 bash docker/tests/apps.test.sh` (2 "purge … failed move" tests already fail as root; ignore those two).
- All work in worktree `/Users/patrickrezende/work/avuz/avuz-server/.claude/worktrees/release-agendar-embed`, branch `embed-instant-booking`. `apps/calendar` is gitignored but present on disk there (copied from the primary checkout); it is the 6.2.1 source to copy from.

## Review Focus

1. A `book` request with the header for a token **not** in the list (another app3 user's page) → upstream flow with confirmation e-mail. Test in Task 1 and Task 4.
2. Header present but allowlist empty (every tenant but app3) → upstream. Test in Task 1.
3. Slot taken between insert and confirm → 404 to the visitor and the booking row deleted, no confirmation e-mail. Test in Task 4.
4. Calendar write throws → booking kept pending, confirmation e-mail sent, controller returns success. DB update throws after the write → no confirmation e-mail (no second event later). Tests in Task 4.
5. Embed page opened directly (not framed) still books via upstream: the header must not be sent outside embed mode. Test in Task 2.

---

### Task 1: `InstantBooking` gate + env sync

**Files:**
- Create: `apps/avuz_theme/lib/Service/InstantBooking.php`
- Test: `apps/avuz_theme/tests/Unit/Service/InstantBookingTest.php`
- Modify: `docker/lib-apps.sh` (add `avuz_sync_instant_booking_tokens` after `avuz_sync_embed_allowed_origins`, ~line 512)
- Modify: `docker/entrypoint.sh` (call it right after `avuz_sync_embed_allowed_origins`, ~line 957)
- Modify: `docker-compose.yml`, `portainer-stack.yml`, `portainer-stack-s3.yml` (add `- AVUZ_INSTANT_BOOKING_TOKENS=` under each `AVUZ_EMBED_ALLOWED_ORIGINS=` line, with a 2-line comment: comma-separated booking page tokens that book instantly from the embed; empty = off; app3 only)
- Test: `docker/tests/apps.test.sh` (next to the embed allowlist sync tests, ~line 500)

**Interfaces:**
- Produces: `OCA\AvuzTheme\Service\InstantBooking` with
  - `public const HEADER = 'X-Avuz-Embed-Booking'`, `public const HEADER_VALUE = '1'`, `public const CONFIG_KEY = 'instant_booking_tokens'`
  - `__construct(IAppConfig $appConfig)`
  - `isAllowed(IRequest $request, string $configToken): bool`
  - `public static function parseTokens(string $commaSeparated): array` → `list<string>`: trimmed, only `/^[A-Za-z0-9]+$/`, unique, order kept
- Consumes: `AppointmentEmbed::parseOrigins(string): array`, `AppointmentEmbed::CONFIG_KEY`, `Application::APP_ID`.

- [ ] **Step 1: Write the failing tests** (`InstantBookingTest`, mocks of `IRequest::getHeader` and `IAppConfig::getValueString`)

```php
// allowlist 'https://www.avuzconecta.com.br', tokens 'MxXcZpTEzNcH', header '1'
public function testAllowsTheListedPageFromTheEmbed(): void { /* isAllowed($request, 'MxXcZpTEzNcH') === true */ }
public function testRefusesWithoutTheHeader(): void { /* header '' → false */ }
public function testRefusesAnotherHeaderValue(): void { /* header 'true' → false */ }
public function testRefusesWhenTheInstanceHasNoAllowlist(): void { /* allowlist '' → false */ }
public function testRefusesWhenTheAllowlistHasOnlyInvalidOrigins(): void { /* 'http://x.com' → false */ }
public function testRefusesAPageThatIsNotListed(): void { /* token 'OtherToken1' → false */ }
public function testRefusesWhenNoPageIsListed(): void { /* tokens '' → false */ }
public function testParsesTokensTrimmedUniqueAndAlphanumericOnly(): void {
    $this->assertSame(['abc', 'Def9'], InstantBooking::parseTokens(' abc, Def9 ,abc,bad-token,, '));
}
```

- [ ] **Step 2: Run, expect FAIL** — `/private/tmp/avuz-theme-phpunit/vendor/bin/phpunit -c apps/avuz_theme/tests/phpunit.xml --filter InstantBooking` → class not found.
- [ ] **Step 3: Implement `InstantBooking`.** Read both app config values with `getValueString(Application::APP_ID, …)`; allowlist via `AppointmentEmbed::parseOrigins()` (no route check); header via `$request->getHeader(self::HEADER)`.
- [ ] **Step 4: Run, expect PASS** (same command; full suite also green: 17 + 8 tests).
- [ ] **Step 5: Write the failing shell tests** in `docker/tests/apps.test.sh`, mirroring the three `avuz_sync_embed_allowed_origins` asserts: syncs `AVUZ_INSTANT_BOOKING_TOKENS` → `config avuz_theme instant_booking_tokens AVUZ_INSTANT_BOOKING_TOKENS --type=string`; unset → empty value; failure → `✗ Could not sync AVUZ_INSTANT_BOOKING_TOKENS — instant booking keeps its previous pages`.
- [ ] **Step 6: Run, expect FAIL** (command not found), **implement `avuz_sync_instant_booking_tokens`** (same shape as `avuz_sync_embed_allowed_origins`), wire it in `entrypoint.sh`, add the compose/stack env lines, **run, expect PASS**; `bash -n docker/entrypoint.sh` clean.
- [ ] **Step 7: Commit** — `feat(avuz_theme): instant-booking gate (embed header + allowlist + listed page token), AVUZ_INSTANT_BOOKING_TOKENS sync`

### Task 2: Embed script sends the header on `book`; hide the page title in the widget

**Files:**
- Modify: `apps/avuz_theme/js/appointment-embed.js` (XHR `send` hook ~line 248, `fetch` hook ~line 266; constants near line 50; header comment last paragraph)
- Modify: `apps/avuz_theme/css/appointment-embed.css` (`html.avuz-embed #content .booking__name` rule)
- Test: `apps/avuz_theme/tests/js/appointment-embed-css.test.mjs`
- Test: `apps/avuz_theme/tests/js/appointment-embed.test.mjs` (make the fake XHR `setRequestHeader` (line 163) and the fetch fake record headers)

**Interfaces:**
- Produces: header `X-Avuz-Embed-Booking: 1` on `POST …/appointment/<token>/book` when `embedMode` is true. Server side reads it as `InstantBooking::HEADER` (Task 1).

- [ ] **Step 1: Write the failing tests** under a new `describe('instant booking header')`:
  - `it('marks the book request as coming from the embed in embed mode')` — XHR and fetch both carry `X-Avuz-Embed-Booking: '1'`.
  - `it('does not mark the slots request')`.
  - `it('does not mark the book request when the page is not framed')` and `when the parent origin is not allowlisted` — header absent, `OCS-APIRequest` still present.
- [ ] **Step 2: Run, expect FAIL** — `node --test apps/avuz_theme/tests/js/appointment-embed.test.mjs`.
- [ ] **Step 3: Implement**: constants `INSTANT_BOOKING_HEADER = 'X-Avuz-Embed-Booking'`, `INSTANT_BOOKING_HEADER_VALUE = '1'`; set it next to the CSRF header only when `action === BOOK_ACTION && embedMode`. Replace the comment line "A booked appointment stays pending until the visitor confirms it by email." with: in embed mode the `book` request carries `X-Avuz-Embed-Booking: 1`; the server books instantly only for pages listed in `AVUZ_INSTANT_BOOKING_TOKENS` (otherwise it stays pending until the e-mail confirmation).
- [ ] **Step 4: Run, expect PASS** (both `appointment-embed*.test.mjs` files, all green).
- [ ] **Step 5: Hide the booking page title in embed mode (Patrick, Oct 19).** The widget no longer shows the appointment name ("Agende sua demonstração", `.booking__name`); the site card already titles it. Failing test first in `apps/avuz_theme/tests/js/appointment-embed-css.test.mjs`, `describe('organizer')`: `it('hides the booking page title')` → `ruleBody(STYLESHEET, \`${EMBED_SCOPE} #content .booking__name\`)` matches `/display:\s*none !important;/`. Replace the existing `html.avuz-embed #content .booking__name` rule (font sizes) with `display: none !important;`. Keep `.booking__display-name` ("Conheça o AvuzConecta") and `.booking__description`. Run `node --test apps/avuz_theme/tests/js/appointment-embed-css.test.mjs` → PASS.
- [ ] **Step 6: Commit** — `feat(avuz_theme): embed marks the book request for instant booking; hide the page title`

### Task 3: Calendar PHP overlay plumbing (build, boot, test harness)

**Files:**
- Create: `docker/overlays/calendar/lib/Listener/AppointmentBookedListener.php` (copy of `apps/calendar/lib/Listener/AppointmentBookedListener.php`)
- Create: `docker/overlays/calendar/tests/bootstrap.php`, `docker/overlays/calendar/tests/phpunit.xml`
- Test: `docker/overlays/calendar/tests/Unit/AppointmentBookedListenerTest.php`
- Modify: `Dockerfile` (calendar overlay `RUN`, ~line 40: also `cp -R …/overlays/calendar/lib/. /var/www/html/apps/calendar/lib/`)
- Modify: `docker/entrypoint.sh` `reapply_avuz_calendar_overlay` (~line 210: also copy `lib/`); `verify_avuz_patches` checks (~line 150): add `"AVUZ-TALK-ROOM-SAFE-V1|calendar|lib/Listener/AppointmentBookedListener.php|calendar overlay missing — a Talk error would abort appointment bookings; redeploy or rerun reapply_avuz_calendar_overlay"`
- Modify: `docker/overlays/calendar/README.md` (new section: PHP files, why, sentinels, how to run the tests)

**Interfaces:**
- Produces: test harness — `bootstrap.php` autoloads `OCA\Calendar\` from `docker/overlays/calendar/lib/` **first**, then `apps/calendar/lib/`; `OCP\`/`OC\` from `lib/public`, `lib/private`; `3rdparty/autoload.php`. Run with `/private/tmp/avuz-theme-phpunit/vendor/bin/phpunit -c docker/overlays/calendar/tests/phpunit.xml`. Fails with a clear message if `apps/calendar/appinfo/info.xml` is not 6.2.1.
- Produces: listener behavior — an exception from `IBroker::createConversation` (or `getAbsoluteUrl`) is caught (`\Throwable`), logged as warning with config id, booking continues without `talkUrl`.

- [ ] **Step 1: Write the failing test** `testBooksWithoutALinkWhenTalkFailsToCreateTheRoom`: config with `createTalkRoom` true, broker `hasBackend` true, `createConversation` throws `\RuntimeException`; `handle()` does not throw, `getTalkUrl()` stays null, logger `warning` called once. Plus `testSetsTheTalkLinkWhenTheRoomIsCreated` (upstream behavior kept).
- [ ] **Step 2: Run, expect FAIL** (the exception escapes).
- [ ] **Step 3: Implement**: copy the 6.2.1 listener, wrap conversation creation + `setTalkUrl` in `try/catch (\Throwable $e)`; comment `// AVUZ-TALK-ROOM-SAFE-V1: a Talk failure must not abort the booking (book without a link).`
- [ ] **Step 4: Run, expect PASS.** Then Dockerfile/entrypoint/README edits; `bash -n docker/entrypoint.sh`; `grep -c AVUZ-TALK-ROOM-SAFE-V1 docker/overlays/calendar/lib/Listener/AppointmentBookedListener.php` = 1.
- [ ] **Step 5: Commit** — `feat(calendar overlay): PHP overlay support; Talk failure no longer aborts a booking`

### Task 4: Instant path in `BookingService` and `BookingController`

**Files:**
- Create: `docker/overlays/calendar/lib/Service/Appointments/BookingService.php` (copy of 6.2.1)
- Create: `docker/overlays/calendar/lib/Controller/BookingController.php` (copy of 6.2.1)
- Test: `docker/overlays/calendar/tests/Unit/BookingServiceInstantTest.php`, `docker/overlays/calendar/tests/Unit/BookingControllerInstantTest.php`
- Modify: `docker/entrypoint.sh` `verify_avuz_patches`: add `"AVUZ-INSTANT-BOOKING-V1|calendar|lib/Service/Appointments/BookingService.php|…"` and `"AVUZ-INSTANT-BOOKING-V1|calendar|lib/Controller/BookingController.php|…"` (message: calendar overlay missing — embedded demo bookings would wait for e-mail confirmation again; redeploy or rerun reapply_avuz_calendar_overlay)
- Modify: `docker/overlays/calendar/README.md`

**Interfaces:**
- Consumes: `InstantBooking::isAllowed(IRequest, string): bool` (Task 1); listener from Task 3.
- Produces:
  - `BookingService::bookInstantly(AppointmentConfig $config, int $start, int $end, string $timeZone, string $displayName, string $email, ?string $description = null): Booking` — throws `NoSlotFoundException` / `InvalidArgumentException` / `ServiceException` like `book()`.
  - `private BookingService::createBooking(...same params...): Booking` — the insert part of upstream `book()`; `book()` = `createBooking()` + `sendConfirmationEmail` (upstream behavior unchanged).
  - `BookingController::bookSlot` picks `bookInstantly` when `class_exists(InstantBooking::class) && \OCP\Server::get(InstantBooking::class)->isAllowed($this->request, $appointmentConfigToken)`, else `book`. Same responses as upstream.

`bookInstantly` failure handling (the spec's §4; the only non-obvious logic):

```php
$booking = $this->createBooking(...);
try {
    return $this->confirmBooking($booking, $config);
} catch (ClientException $e) {               // slot gone between insert and confirm
    $this->bookingMapper->delete($booking);
    throw new NoSlotFoundException('Slot for booking is not available any more', 0, $e);
} catch (\Throwable $e) {                    // calendar write or DB update failed
    $this->logger->error('Instant booking could not be saved, falling back to e-mail confirmation', [...config id, booking id, exception]);
    if (!$booking->isConfirmed()) {          // event not written: classic flow
        $this->mailService->sendConfirmationEmail($booking, $config);
    }                                        // else: event exists, never send a second confirm
    return $booking;
}
```

Sentinel comment `// AVUZ-INSTANT-BOOKING-V1` in both files at the changed code.

- [ ] **Step 1: Write the failing service tests** (mocks: `BookingMapper`, `BookingCalendarWriter`, `MailService`, `IEventDispatcher`, `LoggerInterface`, slot filters returning one slot, `ISecureRandom`):
  - `testBookInstantlyConfirmsWithoutTheConfirmationEmail` — writer `write` called once; `sendBookingInformationEmail` + `sendOrganizerBookingInformationEmail` called; `sendConfirmationEmail` never; returned booking `isConfirmed()`.
  - `testBookInstantlyReturnsNotFoundAndDeletesTheRowWhenTheSlotIsGone` — second `getAvailableSlots` (inside confirm) empty → `NoSlotFoundException`, `bookingMapper->delete` once, no e-mail.
  - `testBookInstantlyFallsBackToTheConfirmationEmailWhenTheCalendarWriteFails` — writer throws `RuntimeException` → returns booking not confirmed, `sendConfirmationEmail` once, logger `error` once.
  - `testBookInstantlyDoesNotAskForConfirmationWhenOnlyTheDatabaseUpdateFails` — `bookingMapper->update` throws → `sendConfirmationEmail` never, logger `error` once.
  - `testBookStillSendsTheConfirmationEmail` — upstream `book()` unchanged.
- [ ] **Step 2: Run, expect FAIL** (`bookInstantly` undefined).
- [ ] **Step 3: Implement** in the overlay `BookingService.php`.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Write the failing controller tests**: `testBooksInstantlyWhenTheGateAllows` (gate stub true → `bookInstantly` called, `book` not); `testBooksTheClassicWayWhenTheGateRefuses` (false → `book`). Register the gate stub via `\OC::$server`/`OCP\Server` override as available in the harness, or inject a `?callable` seam — implementer's call, keep production path `\OCP\Server::get`.
- [ ] **Step 6: Run, expect FAIL; implement; run, expect PASS.** Whole overlay suite green; `grep -c AVUZ-INSTANT-BOOKING-V1` = 1 in each file; `bash -n docker/entrypoint.sh`.
- [ ] **Step 7: Commit** — `feat(calendar overlay): instant booking for listed pages booked through the embed`

### Task 5: Site copy (`avuz-conecta-web`)

**Files** (repo `/Users/patrickrezende/work/avuz/avuz-conecta-web/.claude/worktrees/repo-briefing-setup-2f56ca`, branch → `main`):
- Modify: `src/pages/agendamento-solicitado.astro` (top comment, `<h1>`, `data-slot-fallback` and `data-slot-note` paragraphs, `<title>`)
- Modify: `docs/ads-booking-conversion.md` ("Limits"), `docs/tags-manual.md` (§1 flow note if any, §8/§9 wording), `CHANGELOG.md`

Exact copy (spec §6):
- `<h1>Demonstração agendada!</h1>`
- note: `Enviamos para o seu e-mail os detalhes e o link da reunião no Talk. Confira também a caixa de spam.`
- fallback (no slot in URL): `Recebemos seu agendamento. Os detalhes e o link da reunião estão no seu e-mail.` + existing "Voltar para a agenda" link
- title: `Demonstração agendada | avuzconecta`
- "Limits" in `ads-booking-conversion.md`: the conversion is a confirmed booking (instant since this change); the e-mail-confirmation caveat is removed.

- [ ] **Step 1:** Edit the page and docs. **Step 2:** `npm run build` → `grep -o '<h1>[^<]*</h1>' dist/agendamento-solicitado.html` = `<h1>Demonstração agendada!</h1>`; `node --test tests/agendar/*.test.mjs tests/lead/*.test.mjs` green. **Step 3: Commit** `agendamento-solicitado: copy for instant booking` and push `main`. **Do not deploy** until Task 6 step 4.

### Task 6: Release and end-to-end check (ops, Patrick confirms each outward step)

- [ ] **Step 1:** Push `embed-instant-booking` to `avuz-customization` (fast-forward). Build: `KEEP_DOCKER=1 ./scripts/build-push.sh 2026.10.<DD>-<sha> prod --no-latest`; check `docker buildx imagetools inspect registry.avuz.app/admin/avuzconecta:latest` digest still `sha256:8f6d956d…`.
- [ ] **Step 2:** Stack 14 (endpoint 6): image → new tag, add `- AVUZ_INSTANT_BOOKING_TOKENS=MxXcZpTEzNcH` after the `AVUZ_EMBED_ALLOWED_ORIGINS` line; save the current compose first for rollback; redeploy via Portainer API PUT (`pullImage: true`).
- [ ] **Step 3:** After boot: status 200; `occ config:app:get avuz_theme instant_booking_tokens` = `MxXcZpTEzNcH`; oidc discovery 200; boot log shows no sentinel failure; bump the theming cachebuster.
- [ ] **Step 4:** Patrick turns on "create Talk room" on "Agende sua demonstração". Deploy the site (`docs/tags-manual.md` §6, `--branch main`).
- [ ] **Step 5 (positive):** On `https://www.avuzconecta.com.br/agendar` book a slot with a real inbox → no confirmation e-mail; "aceito" e-mail with Talk link (Local) and `.ics`; event in Jeferson's calendar with the Talk link as location; organizer e-mail + notification; site shows "Demonstração agendada!". Cancel the test meeting. Watch the iframe between clicking "book" and the redirect: if Calendar's own "check your e-mail to confirm" screen flashes, hide it with a rule in `apps/avuz_theme/css/appointment-embed.css` (scoped `html.avuz-embed`, CSS test in `appointment-embed-css.test.mjs`) and ship it with the next release.
- [ ] **Step 6 (negative):** book on `https://app3.avuz.app/apps/calendar/appointment/MxXcZpTEzNcH` directly → confirmation e-mail as before. `curl` a `book` POST with the header for a token not listed → confirmation e-mail flow (or skip if no second page exists; then rely on Task 1/4 tests).
