# Assinaturas Plan 7: Signers from Nextcloud Contacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the wizard's signers step, the owner finds signers among their own contacts and the instance's users instead of typing them, and new signers are saved to their contacts after a successful send.

**Architecture:** A new `GET /api/v1/signer-suggestions` endpoint searches the user's own CardDAV address books (through Nextcloud's contacts API objects, `OCP\IAddressBook`) and the user manager, and says whether the user has an address book to save to. Each draft signer stores a `save_to_contacts` choice; `PUT …/signers` updates that choice in place (keeping the placed boxes) when the signers themselves are unchanged. After `EnvelopeSender` moves an envelope to `pending`, `SignerContacts` creates the chosen contacts in the owner's default writable address book; it never throws. The frontend turns the name and email fields into WAI-ARIA comboboxes fed by a debounced, cancellable TanStack query, and shows a "Salvar nos contatos" checkbox only when that same query says the email is unknown.

**Tech Stack:** PHP 8.3 / Nextcloud 33 app (QBMapper, attribute routes, PHPUnit 9 in the Docker test env), DAV app's CardDAV loader, Vue 3.5 + TypeScript strict + TanStack Vue Query 5 + Vitest 4 (happy-dom).

**Spec (single source of requirements):** `docs/superpowers/specs/2026-10-07-assinaturas-signer-contacts-design.md` (avuz-server worktree).

**App repo:** `/Users/patrickrezende/work/avuz/assinaturas` — every path below is relative to it unless it starts with `/`. Every command runs from it.

## Global Constraints

- App version bump happens in the **last task only**: `appinfo/info.xml` → `0.5.0` (`package.json` has no version on purpose). This plan runs after Plan 6 (theme color, `0.4.10`); Task 1 stops if `appinfo/info.xml` is not at `0.4.10`.
- Gates, each run separately, all exit 0: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` (commit built `js/` and `css/`); `composer run lint`; `tests/env/phpunit.sh`.
- `tests/env/phpunit.sh` auto-runs `tests/env/reset.sh` when the local `avuzconecta:latest` image id differs from `~/.assinaturas-test-image-id`. Never rebuild that image during the plan. Before every `tests/env/phpunit.sh` run, compare the two ids (command in Task 1, Step 2); if they differ, **stop and ask** — never let a reset happen (it wipes the local sandbox token).
- Never run `tests/env/reset.sh`, `tests/e2e/lifecycle.php` or `tests/spike/run.php`. Tests never reach the real ZapSign (use `FakeHttpTransport` / `ZapSignDoubles`).
- Never leave a test run going: run every command in the foreground and wait; before replying, `docker ps` shows no phpunit container and `pgrep -f vitest` is empty. No background jobs, no `sleep` loops.
- TypeScript: no `any`, almost no `as` (`as const` is fine), named exports, no barrel files, `async`/`await`, hash maps over `switch`, named constants (no magic strings/numbers), early returns, descriptive names. Data fetching only through TanStack Vue Query (`useQuery`/`useMutation`), never in `onMounted` or watchers; query keys only from `QUERY_KEYS` in `src/api/query-keys.ts`. API types live once in `src/api/types.ts`.
- UI: build from the kit in `src/ui/` (native elements), never `NcButton`/`NcTextField`/`NcSelect`/…; design tokens only through `var(--av-…)` from `src/styles/identity.css`. Props are written camelCase in templates, as the repo does.
- PHP: query builder only (no raw SQL strings), typed properties, early returns, tabs. The app talks to Nextcloud through OCP; the single exception this plan adds is `OCA\DAV\…` inside `lib/Contacts/OwnAddressBooks.php`, pinned by a test (Task 3).
- Tests describe behaviour in the 3rd person (`it('returns …')`, `testReturns…`), never "should". Test behaviour, not implementation. TDD: write the failing test, run it and see the expected failure, then implement.
- Accessibility: WCAG 2.x AA. The name and email fields follow the WAI-ARIA APG combobox pattern (listbox popup): arrow keys move, Enter picks, Esc closes, `aria-activedescendant` exposes the active option, a polite live region announces the number of results. Every control is labelled; touch targets ≥ 44px; status never by colour alone; visible focus ring.
- White label: no user-facing string names ZapSign (`src/l10n.spec.ts` guards it). pt_BR copy is natural Brazilian Portuguese. l10n process: English source strings through `t`/`n`; every new string goes into **both** `l10n/pt_BR.json` and `l10n/pt_BR.js` in the same task (`src/l10n.spec.ts` checks both match); plural keys use `"_singular_::_plural_"`.
- Security: never log personal data beyond ids (log the envelope uuid and exception class, never names, emails or the search text); the suggestions endpoint is limited to app users (`AccessPolicy::canUseApp`, 403 otherwise) and rate limited per user; no PII in URLs beyond the `q` search query the spec defines.
- Commits: conventional messages, **no AI attribution lines (no Co-Authored-By)**. Work on branch `plan-7-signer-contacts` cut from app `main`. Never push, never switch to another branch, never rewrite history.
- Staging verification on conecta-2 (image build, submodule pin, deploy) is done by the controller after the plan; the last task lists what to check by hand.

## Nextcloud APIs used (verified in `/Users/patrickrezende/work/avuz/avuz-server`)

| What | Where | Why it matters |
|---|---|---|
| `OCP\IAddressBook::search($pattern, $searchProperties, $options)`, `createOrUpdate($properties)`, `getPermissions()`, `getUri()`, `getKey()` | `lib/public/IAddressBook.php` | The contacts API we search and write through. `getKey()` is the address book id as a string. |
| `OCP\IAddressBookEnabled::isEnabled()` (since 32) | `lib/public/IAddressBookEnabled.php` | A book the user switched off is skipped, as core does. |
| `OCP\Constants::PERMISSION_CREATE = 4` | `lib/public/Constants.php` | "Writable". |
| `OC\ContactsManager::search()` | `lib/private/ContactsManager.php:33-74` | Searches **every** registered book, system and shared included; so we do not call `IManager::search`, we call `IAddressBook::search` on each own book (the same API it delegates to). |
| DAV's `IManager` loader reads `IUserSession` once per process | `apps/dav/lib/AppInfo/Application.php:250-259`, `lib/private/ContactsManager.php:200-206` (`loadAddressBooks()` empties the loader list) | In the long-running `assinaturas-worker` (`occ background-job:worker`, up to 1 h per process) the shared `IManager` has no user, or the first user's books; never usable for the owner of a send. |
| `OCA\DAV\CardDAV\ContactsManager::setupContactsProvider(IManager $cm, $userId, IURLGenerator $urlGenerator)` | `apps/dav/lib/CardDAV/ContactsManager.php:36-40` | Registers that user's books (`AddressBookImpl`, user-scoped) plus the system book into any `IManager`. The Contacts app uses it the same way in background jobs (`apps/contacts/lib/Service/SocialApiService.php:122-125`). We pass our own collector. |
| `OCA\DAV\CardDAV\CardDavBackend::getUsersOwnAddressBooks($principalUri)` | `apps/dav/lib/CardDAV/CardDavBackend.php:195-221` | Only the books whose `principaluri` is the user: no shared, no system books. Its row `id`s filter the collected books. |
| `CardDavBackend::PERSONAL_ADDRESSBOOK_URI = 'contacts'` | `apps/dav/lib/CardDAV/CardDavBackend.php:39`; created at first login in `apps/dav/lib/Listener/UserEventsListener.php:184-191` | The default address book ("Contatos"). |
| `AddressBookImpl::getPermissions()` (owner ACL `{DAV:}write` → CREATE), `search()` (wildcard `ILIKE %pattern%` by default), `createOrUpdate()` (new vCard with UID when no `URI`) | `apps/dav/lib/CardDAV/AddressBookImpl.php:85-176` | Writable = owned; search is substring, case-insensitive; `EMAIL` comes back as a list. |
| `IUserManager::searchDisplayName($pattern, $limit)` | `lib/public/IUserManager.php:124`; DB backend matches uid, display name **and** email: `lib/private/User/Database.php:272-301` | Instance users by name or email. |
| `IUserManager::getByEmail($email)`, `IUser::getEMailAddress()`, `isEnabled()`, `setSystemEMailAddress()` | `lib/public/IUserManager.php:221`, `lib/public/IUser.php` | "Belongs to a user". |
| `IAppManager::isEnabledForUser($appId, $user)` | `lib/public/App/IAppManager.php:80` | "Contacts app disabled" (pass the `IUser`: `null` means the session user). |
| `occ migrations:execute <app> <version>` | `core/Command/Db/Migrations/ExecuteCommand.php` | Applies the new migration in the test env without bumping the version before the last task. |

## Decisions that resolve spec ambiguities

1. **Search scope:** `IManager::search` cannot leave out shared and system books, so search runs `IAddressBook::search` on each of the user's own, enabled books (`FN`, `EMAIL`), loaded through DAV's loader so the same code serves the request and the send job.
2. **Response shape:** `GET /signer-suggestions` returns `{"suggestions": [≤10 × {name, email, source}], "canSaveContacts": bool}`. The checkbox needs both answers for the typed email, so one request gives both (no new initial-state field, no cost on the Files page).
3. **Checkbox visibility:** the frontend looks the typed email up through the same endpoint (`q` = the email, debounced); the box shows when `canSaveContacts` is true and no suggestion has exactly that email. The server ranks an exact email match first, so it never falls outside the 10.
4. **Stored value vs visibility:** the draft stores the owner's choice as is (new rows start `true`); at send time the server creates a contact only when the email is in none of the owner's own books **and** belongs to no enabled user. So a picked contact or user is never duplicated even if its stored choice is `true`.
5. **Default writable address book:** the own book with URI `contacts`, else the first other own writable one.
6. **Toggling the box must not clear boxes:** `PUT …/signers` with the same signers (same emails, names and groups, any order) only updates `save_to_contacts` and keeps ids, colours and boxes; the frontend only asks "Alterar signatários?" when a name, email, group or row count changed.
7. **Entries dropped:** users without email, disabled users, contacts without a name (`FN`) and invalid emails. A contact with several emails yields one suggestion per email.
8. **Rate limit:** 300 requests per user per 5 minutes (typing is debounced at 250 ms).
9. **Avatar:** initials avatar from the kit (`AvAvatar`), never a Nextcloud avatar URL (no uid in the page).

## File Structure

Backend (`lib/`):
- Create `lib/Migration/Version000500Date20261007000000.php` — adds `assinaturas_signers.save_to_contacts` (boolean, nullable, default false).
- Modify `lib/Db/Signer.php` — `saveToContacts` field + `savesToContacts(): bool`.
- Modify `lib/Draft/EnvelopeDrafts.php` — stores the choice; same-signers list updates choices in place.
- Modify `lib/Api/EnvelopeView.php` — signer JSON gains `saveToContacts`.
- Create `lib/Contacts/CollectedAddressBooks.php` — an `OCP\Contacts\IManager` that only collects registered books.
- Create `lib/Contacts/OwnAddressBooks.php` — a user's own enabled books (session-free) + `defaultWritable()`. The only DAV dependency.
- Create `lib/Contacts/ContactEmails.php` — normalized emails of a contacts-API contact array.
- Create `lib/Contacts/SuggestionSource.php`, `lib/Contacts/SignerSuggestion.php`, `lib/Contacts/SignerSuggestions.php` — the search.
- Create `lib/Controller/SignerSuggestionController.php` — the endpoint.
- Create `lib/Contacts/SignerContacts.php` — saves chosen signers after a send; never throws.
- Modify `lib/Send/EnvelopeSender.php` — calls `SignerContacts::saveChosen()` once the envelope is `pending`.

Frontend (`src/`):
- Modify `src/api/types.ts`, `src/api/query-keys.ts`.
- Create `src/api/signer-suggestions.ts` (HTTP) and `src/api/signer-suggestions-query.ts` (query options; separate so specs can mock the HTTP module).
- Modify `src/wizard/signer-form.ts` — `saveToContacts` in drafts/inputs, `signerIdentitiesChanged`, `looksLikeEmail`.
- Modify `src/wizard/SignersStep.vue` — only identity changes ask about / forget boxes; binds the choice.
- Create `src/ui/combobox.ts`, `src/ui/AvCombobox.vue`, `src/ui/AvCheckbox.vue` — kit controls.
- Create `src/wizard/signer-suggestions.ts` — debounce constant, query normalisation, `useSignerSuggestions`, `useContactLookup`, labels.
- Create `src/wizard/SignerSuggestionOption.vue` — one suggestion row (avatar, name, email, source).
- Modify `src/wizard/SignerFormRow.vue` — comboboxes + checkbox.
- Modify `src/test-support/envelope-fixtures.ts`, `l10n/pt_BR.json`, `l10n/pt_BR.js`.

Tests: `tests/Integration/TestAddressBooks.php` (trait), `tests/Fakes/FixedAddressBooks.php`, `tests/Fakes/UnwritableAddressBook.php`, new `*Test.php` per class, `*.spec.ts` beside each TS module.

Docs: `docs/api.md`. Env: `tests/env/reset.sh` enables the Contacts app.

---

### Task 1: Store each draft signer's choice to be saved to contacts

**Files:**
- Modify: `tests/env/reset.sh` (enable Contacts after a reset)
- Create: `lib/Migration/Version000500Date20261007000000.php`
- Modify: `lib/Db/Signer.php`
- Modify: `lib/Draft/EnvelopeDrafts.php` (`replaceSigners`, new `wantsSavingToContacts`)
- Modify: `lib/Api/EnvelopeView.php` (`signer()`)
- Modify: `docs/api.md`
- Test: `tests/Integration/Draft/EnvelopeDraftsEditingTest.php`, `tests/Integration/Controller/EnvelopeControllerTest.php`

**Interfaces:**
- Consumes: nothing new.
- Produces: column `assinaturas_signers.save_to_contacts`; `Signer::setSaveToContacts(bool)`, `Signer::getSaveToContacts(): ?bool`, `Signer::savesToContacts(): bool`; `EnvelopeDrafts::replaceSigners()` reads each entry's `saveToContacts` (only JSON `true` counts); private static `EnvelopeDrafts::wantsSavingToContacts(mixed $signer): bool`; signer JSON key `saveToContacts: bool`.

- [ ] **Step 1: Branch off app `main` and check the starting point**

```bash
cd /Users/patrickrezende/work/avuz/assinaturas
git status --short
git checkout main
grep -o '<version>[^<]*' appinfo/info.xml
git checkout -b plan-7-signer-contacts
```
Expected: `git status --short` prints nothing; the version line is `<version>0.4.10`. If it is `0.4.9`, Plan 6 has not landed on `main`: **stop and ask**. Do not pull or push.

- [ ] **Step 2: Check the test env will not reset, and that nothing is left running**

```bash
[ "$(cat ~/.assinaturas-test-image-id)" = "$(docker image inspect avuzconecta:latest --format '{{.Id}}')" ] && echo SAME || echo DIFFERENT
docker ps --format '{{.Names}}' | grep -c phpunit || true
tests/env/php.sh occ status
```
Expected: `SAME`; `0`; the status lists `installed: true` and `needsDbUpgrade: false`. If `DIFFERENT`: **stop and ask** (a phpunit run would wipe the env). If `needsDbUpgrade: true`: run `tests/env/php.sh occ upgrade`; if it complains about stale bundled apps, run `tests/env/php.sh occ app:disable bruteforcesettings files_downloadlimit notifications text`, then `tests/env/php.sh occ upgrade`, `tests/env/php.sh occ maintenance:mode --off`, and `tests/env/php.sh occ app:enable --force bruteforcesettings files_downloadlimit notifications text`.

Repeat the `SAME`/`DIFFERENT` check before every `tests/env/phpunit.sh` in this plan.

- [ ] **Step 3: Enable the Contacts app in the test env, and after any future reset**

```bash
tests/env/php.sh occ app:enable contacts
```
Expected: `contacts 8.4.1 enabled` (the version may differ).

In `tests/env/reset.sh`, after the `files_external` lines and before `docker image inspect …`, add:

```bash
echo "[reset] enabling contacts (signer suggestions search the user's address books)"
"$PHP" occ app:enable contacts
```

- [ ] **Step 4: Write the failing tests**

In `tests/Integration/Draft/EnvelopeDraftsEditingTest.php`, add after `testSavesASignerWithoutSurnameSinceTheOwnerMayStillBeTypingIt()`:

```php
	public function testKeepsEachSignersChoiceToBeSavedToContacts(): void {
		$this->drafts->replaceSigners($this->envelope, [
			['name' => 'Ana Lima', 'email' => 'ana@example.com', 'saveToContacts' => true],
			['name' => 'Bruno Souza', 'email' => 'bruno@example.com', 'saveToContacts' => false],
		]);

		$stored = Server::get(SignerMapper::class)->findByEnvelope($this->envelope->getId());

		$this->assertSame([true, false], array_map(fn (Signer $signer): bool => $signer->savesToContacts(), $stored));
	}

	/** @return array<string, array{array<string, mixed>}> */
	public static function signersNotAskingToBeSaved(): array {
		return [
			'without the choice, as an older client sends' => [['name' => 'Ana Lima', 'email' => 'ana@example.com']],
			'false' => [['name' => 'Ana Lima', 'email' => 'ana@example.com', 'saveToContacts' => false]],
			'text' => [['name' => 'Ana Lima', 'email' => 'ana@example.com', 'saveToContacts' => 'yes']],
			'a number' => [['name' => 'Ana Lima', 'email' => 'ana@example.com', 'saveToContacts' => 1]],
		];
	}

	/**
	 * @dataProvider signersNotAskingToBeSaved
	 * @param array<string, mixed> $signer
	 */
	public function testSavesASignerToContactsOnlyWhenTheChoiceIsTrue(array $signer): void {
		$this->drafts->replaceSigners($this->envelope, [$signer]);

		$this->assertFalse(Server::get(SignerMapper::class)->findByEnvelope($this->envelope->getId())[0]->savesToContacts());
	}
```

In `tests/Integration/Controller/EnvelopeControllerTest.php`, add after `testShowsEveryFieldOfEachSignerInTheDetail()`:

```php
	public function testShowsEachSignersChoiceToBeSavedToContacts(): void {
		$uuid = $this->createDraft('Contrato');

		$detail = $this->controller()->replaceSigners($uuid, [
			['name' => 'Ana Lima', 'email' => 'ana@example.com', 'saveToContacts' => true],
			['name' => 'Bruno Souza', 'email' => 'bruno@example.com', 'saveToContacts' => false],
		])->getData();

		$this->assertSame([true, false], array_column($detail['signers'], 'saveToContacts'));
	}
```

- [ ] **Step 5: Run them to see them fail**

Run: `tests/env/phpunit.sh --filter 'testKeepsEachSignersChoiceToBeSavedToContacts|testSavesASignerToContactsOnlyWhenTheChoiceIsTrue|testShowsEachSignersChoiceToBeSavedToContacts'`
Expected: FAIL — `Error: Call to undefined method OCA\Assinaturas\Db\Signer::savesToContacts()` and, for the controller test, `Failed asserting that an array is identical` (no `saveToContacts` key).

- [ ] **Step 6: Add the migration**

Create `lib/Migration/Version000500Date20261007000000.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\DB\Types;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * Keeps each draft signer's "save to contacts" choice until the envelope is sent. Nextcloud requires boolean
 * columns to be nullable; existing signers read as not chosen.
 */
final class Version000500Date20261007000000 extends SimpleMigrationStep {
	private const TABLE = 'assinaturas_signers';
	private const COLUMN = 'save_to_contacts';

	public function changeSchema(IOutput $output, Closure $schemaClosure, array $options): ?ISchemaWrapper {
		/** @var ISchemaWrapper $schema */
		$schema = $schemaClosure();
		$table = $schema->getTable(self::TABLE);
		if ($table->hasColumn(self::COLUMN)) {
			return null;
		}
		$table->addColumn(self::COLUMN, Types::BOOLEAN, ['notnull' => false, 'default' => false]);
		return $schema;
	}
}
```

- [ ] **Step 7: Add the field to the entity**

In `lib/Db/Signer.php`:

1. In the class docblock, after ` * @method void setColor(int $color)`, add:
```php
 * @method bool|null getSaveToContacts()
 * @method void setSaveToContacts(bool $saveToContacts)
```
2. In `FIELD_TYPES`, after `'color' => Types::INTEGER,`, add:
```php
		'saveToContacts' => Types::BOOLEAN,
```
3. After `protected $color = 0;`, add:
```php
	protected $saveToContacts = false;
```
4. After `statusValue()`, add:
```php
	/** Whether the owner chose to add this signer to their contacts once the envelope is sent. */
	public function savesToContacts(): bool {
		return $this->getSaveToContacts() === true;
	}
```

- [ ] **Step 8: Store the choice when signers are replaced**

In `lib/Draft/EnvelopeDrafts.php`, in `replaceSigners()`:

1. Change the `@param` line of its docblock to:
```php
	 * @param list<mixed> $signers objects, each with name, email, saveToContacts and (when ordered) orderGroup
```
2. After `$entity->setColor($index % self::COLOR_COUNT);`, add:
```php
				$entity->setSaveToContacts(self::wantsSavingToContacts($signer));
```

Then add this method right after `assertSigner()`:

```php
	/** Only a JSON `true` asks for it: an older client that sends no choice saves nobody to contacts. */
	private static function wantsSavingToContacts(mixed $signer): bool {
		return is_array($signer) && ($signer['saveToContacts'] ?? false) === true;
	}
```

- [ ] **Step 9: Show the choice in the detail**

In `lib/Api/EnvelopeView.php`, in `signer()`, after `'emailBouncedAt' => $signer->getEmailBouncedAt(),`, add:

```php
			'saveToContacts' => $signer->savesToContacts(),
```

- [ ] **Step 10: Apply the migration in the test env and check the column**

```bash
tests/env/php.sh occ migrations:execute assinaturas 000500Date20261007000000
docker exec assinaturas-test-db psql -U assinaturas -d assinaturas -c '\d oc_assinaturas_signers' | grep save_to_contacts
```
Expected: the first command exits 0; the second prints a line like `save_to_contacts | boolean | | | false`.

- [ ] **Step 11: Run the tests to see them pass**

Run: `tests/env/phpunit.sh --filter 'testKeepsEachSignersChoiceToBeSavedToContacts|testSavesASignerToContactsOnlyWhenTheChoiceIsTrue|testShowsEachSignersChoiceToBeSavedToContacts'`
Expected: `OK (6 tests, …)`.

- [ ] **Step 12: Document the field**

In `docs/api.md`:

1. In the *Envelope detail* example, replace
`   "color": 0, "releasedAt": null, "lastReminderAt": null, "viewedAt": null, "signedAt": null, "emailBouncedAt": null}],`
with
`   "color": 0, "releasedAt": null, "lastReminderAt": null, "viewedAt": null, "signedAt": null, "emailBouncedAt": null, "saveToContacts": false}],`
2. In *Routes*, replace the body cell of `PUT /envelopes/{uuid}/signers` (keep the rest of the row) with:
``{"signers": [{"name", "email", "orderGroup": 1..20, "saveToContacts": bool}…]}` (`orderGroup` only matters with `signingOrder`; `saveToContacts` counts only when it is JSON `true`)``

- [ ] **Step 13: Run the gates**

```bash
composer run lint
tests/env/phpunit.sh
```
Expected: lint prints `No syntax errors detected` for every file and exits 0; PHPUnit ends with `OK (… tests, … assertions)` and no warnings, deprecations or risky tests.

- [ ] **Step 14: Commit**

```bash
git add tests/env/reset.sh lib/Migration/Version000500Date20261007000000.php lib/Db/Signer.php lib/Draft/EnvelopeDrafts.php lib/Api/EnvelopeView.php docs/api.md tests/Integration/Draft/EnvelopeDraftsEditingTest.php tests/Integration/Controller/EnvelopeControllerTest.php
git commit -m "feat(signers): keep each draft signer's choice to be saved to contacts"
```

---

### Task 2: Change only the contact choice without clearing the boxes

**Files:**
- Modify: `lib/Draft/EnvelopeDrafts.php` (`replaceSigners` and three new private helpers)
- Modify: `docs/api.md`
- Test: `tests/Integration/Draft/EnvelopeDraftsEditingTest.php`

**Interfaces:**
- Consumes: `Signer::savesToContacts()`, `Signer::setSaveToContacts()`, `EnvelopeDrafts::wantsSavingToContacts()` (Task 1).
- Produces: `EnvelopeDrafts::replaceSigners(Envelope, list<mixed>): list<Signer>` — when the entries name the same signers (same normalized emails, trimmed names and effective groups, any order) it updates `save_to_contacts` in place and returns the existing signers (same ids, colours, boxes); otherwise it replaces them as before.

- [ ] **Step 1: Write the failing tests**

In `tests/Integration/Draft/EnvelopeDraftsEditingTest.php`, add after `testClearsTheSignatureBoxesWhenSignersAreReplaced()`:

```php
	public function testKeepsTheSignersAndTheirBoxesWhenOnlyTheContactChoiceChanges(): void {
		$signers = $this->drafts->replaceSigners($this->envelope, [['name' => 'Ana Lima', 'email' => 'ana@example.com', 'saveToContacts' => true]]);
		$documentId = $this->documentId();
		$this->drafts->replaceFields($this->envelope, $documentId, [self::PORTRAIT_PAGE], [self::box($signers[0]->getId())]);

		$kept = $this->drafts->replaceSigners($this->envelope, [['name' => ' Ana Lima ', 'email' => 'ANA@example.com', 'saveToContacts' => false]]);

		$this->assertSame([$signers[0]->getId()], array_map(fn (Signer $signer): int => $signer->getId(), $kept));
		$this->assertFalse(Server::get(SignerMapper::class)->findByEnvelope($this->envelope->getId())[0]->savesToContacts());
		$this->assertCount(1, Server::get(FieldMapper::class)->findByDocument($documentId));
	}

	public function testKeepsTheBoxesWhenTheSameSignersComeInAnotherOrder(): void {
		$signers = $this->drafts->replaceSigners($this->envelope, [
			['name' => 'Ana Lima', 'email' => 'ana@example.com'],
			['name' => 'Bruno Souza', 'email' => 'bruno@example.com'],
		]);
		$documentId = $this->documentId();
		$this->drafts->replaceFields($this->envelope, $documentId, [self::PORTRAIT_PAGE], [self::box($signers[1]->getId())]);

		$this->drafts->replaceSigners($this->envelope, [
			['name' => 'Bruno Souza', 'email' => 'bruno@example.com', 'saveToContacts' => true],
			['name' => 'Ana Lima', 'email' => 'ana@example.com'],
		]);

		$this->assertCount(1, Server::get(FieldMapper::class)->findByDocument($documentId));
		$this->assertEqualsCanonicalizing(
			[$signers[0]->getId(), $signers[1]->getId()],
			array_map(fn (Signer $signer): int => $signer->getId(), Server::get(SignerMapper::class)->findByEnvelope($this->envelope->getId())),
		);
	}

	public function testClearsTheBoxesWhenANameChangesAlongWithTheContactChoice(): void {
		$signers = $this->drafts->replaceSigners($this->envelope, [['name' => 'Ana Lima', 'email' => 'ana@example.com', 'saveToContacts' => true]]);
		$documentId = $this->documentId();
		$this->drafts->replaceFields($this->envelope, $documentId, [self::PORTRAIT_PAGE], [self::box($signers[0]->getId())]);

		$this->drafts->replaceSigners($this->envelope, [['name' => 'Ana Souza', 'email' => 'ana@example.com', 'saveToContacts' => false]]);

		$this->assertSame([], Server::get(FieldMapper::class)->findByDocument($documentId));
	}

	public function testClearsTheBoxesWhenASignerMovesToAnotherGroup(): void {
		$ordered = $this->drafts->updateSettings($this->envelope, 'Contrato', true, null, null, '');
		$signers = $this->drafts->replaceSigners($ordered, [
			['name' => 'Ana Lima', 'email' => 'ana@example.com', 'orderGroup' => 1],
			['name' => 'Bruno Souza', 'email' => 'bruno@example.com', 'orderGroup' => 2],
		]);
		$documentId = $this->documentId();
		$this->drafts->replaceFields($ordered, $documentId, [self::PORTRAIT_PAGE], [self::box($signers[0]->getId())]);

		$this->drafts->replaceSigners($ordered, [
			['name' => 'Ana Lima', 'email' => 'ana@example.com', 'orderGroup' => 1],
			['name' => 'Bruno Souza', 'email' => 'bruno@example.com', 'orderGroup' => 1],
		]);

		$this->assertSame([], Server::get(FieldMapper::class)->findByDocument($documentId));
	}
```

- [ ] **Step 2: Run them to see them fail**

Run: `tests/env/phpunit.sh --filter 'testKeepsTheSignersAndTheirBoxesWhenOnlyTheContactChoiceChanges|testKeepsTheBoxesWhenTheSameSignersComeInAnotherOrder|testClearsTheBoxesWhenANameChangesAlongWithTheContactChoice|testClearsTheBoxesWhenASignerMovesToAnotherGroup'`
Expected: the two `testKeeps…` tests FAIL (`Failed asserting that two arrays are identical` for the ids, or `Failed asserting that actual size 0 matches expected size 1`); the two `testClears…` tests PASS already.

- [ ] **Step 3: Implement the in-place update**

In `lib/Draft/EnvelopeDrafts.php`, add the constant after `INTEGER_PATTERN`:

```php
	private const FIRST_GROUP = 1;
```

Replace the whole `replaceSigners()` method (docblock included) with:

```php
	/**
	 * Replaces every signer. Signature boxes point at signers, so this also clears the boxes, unless the list names
	 * the same signers as the draft (same emails, names and groups, in any order): then only each signer's choice to
	 * be saved to the owner's contacts changes, and the signers keep their ids, colours and boxes.
	 *
	 * @param list<mixed> $signers objects, each with name, email, saveToContacts and (when ordered) orderGroup
	 * @return list<Signer>
	 * @throws DraftRejected
	 */
	public function replaceSigners(Envelope $envelope, array $signers): array {
		$this->assertDraft($envelope);
		if ($signers === []) {
			throw new DraftRejected('no_signers', 'Add at least one signer');
		}
		if (count($signers) > EnvelopeLimits::MAX_SIGNERS) {
			throw new DraftRejected('too_many_signers', 'An envelope has at most ' . EnvelopeLimits::MAX_SIGNERS . ' signers');
		}
		$emails = [];
		foreach ($signers as $signer) {
			$emails[] = self::assertSigner($signer, $envelope->getSigningOrder());
		}
		if (count(array_unique($emails)) !== count($emails)) {
			throw new DraftRejected('signer_email_duplicate', 'Each signer needs a different email');
		}
		$entries = array_values($signers);
		$existing = $this->signerMapper->findByEnvelope($envelope->getId());
		if (self::namesTheSameSigners($existing, $entries, $emails, $envelope->getSigningOrder())) {
			return $this->inTransaction(fn (): array => $this->updateContactChoices($envelope, $existing, $entries, $emails));
		}
		return $this->inTransaction(function () use ($envelope, $entries, $emails): array {
			$this->deleteSignersAndBoxes($envelope);
			$created = [];
			foreach ($entries as $index => $signer) {
				$entity = new Signer();
				$entity->setEnvelopeId($envelope->getId());
				$entity->setName(trim((string)$signer['name']));
				$entity->setEmail($emails[$index]);
				$entity->setOrderGroup(self::orderGroupOf($signer, $envelope->getSigningOrder()));
				$entity->setColor($index % self::COLOR_COUNT);
				$entity->setSaveToContacts(self::wantsSavingToContacts($signer));
				$created[] = $this->signerMapper->insert($entity);
			}
			$this->touch($envelope);
			return $created;
		});
	}

	/**
	 * @param list<Signer> $existing
	 * @param list<mixed> $entries
	 * @param list<string> $emails the normalized email of each entry
	 * @return list<Signer>
	 */
	private function updateContactChoices(Envelope $envelope, array $existing, array $entries, array $emails): array {
		$choices = array_combine($emails, array_map(fn (mixed $entry): bool => self::wantsSavingToContacts($entry), $entries));
		foreach ($existing as $signer) {
			$choice = $choices[$signer->getEmail()] ?? false;
			if ($signer->savesToContacts() === $choice) {
				continue;
			}
			$signer->setSaveToContacts($choice);
			$this->signerMapper->update($signer);
		}
		$this->touch($envelope);
		return $existing;
	}

	/**
	 * Whether the entries name exactly the signers the draft holds: same emails, names and groups, in any order.
	 *
	 * @param list<Signer> $existing
	 * @param list<mixed> $entries already checked by assertSigner
	 * @param list<string> $emails the normalized email of each entry
	 */
	private static function namesTheSameSigners(array $existing, array $entries, array $emails, bool $signingOrder): bool {
		if (count($existing) !== count($entries)) {
			return false;
		}
		$existingByEmail = [];
		foreach ($existing as $signer) {
			$existingByEmail[$signer->getEmail()] = $signer;
		}
		foreach ($entries as $index => $entry) {
			$match = $existingByEmail[$emails[$index]] ?? null;
			$isSame = $match !== null
				&& $match->getName() === trim((string)$entry['name'])
				&& $match->getOrderGroup() === self::orderGroupOf($entry, $signingOrder);
			if (!$isSame) {
				return false;
			}
		}
		return true;
	}

	/** The group a checked entry signs in: its own with signing order on, else the first. */
	private static function orderGroupOf(mixed $entry, bool $signingOrder): int {
		return $signingOrder ? (int)self::integer($entry['orderGroup']) : self::FIRST_GROUP;
	}
```

- [ ] **Step 4: Run the tests to see them pass**

Run the Step 2 command again.
Expected: `OK (4 tests, …)`.

- [ ] **Step 5: Document the behaviour**

In `docs/api.md`, in the `PUT /envelopes/{uuid}/signers` row, replace `Replaces every signer **and clears every box**` with:
`Replaces every signer **and clears every box**, unless the list names the same signers as the draft (same emails, names and groups, in any order): then only `saveToContacts` changes and the signers keep their ids, colours and boxes`

- [ ] **Step 6: Run the gates**

```bash
composer run lint
tests/env/phpunit.sh
```
Expected: both exit 0; PHPUnit `OK`. If a pre-existing test fails because it sent an identical signer list and expected new ids or cleared boxes, that is the intended change: update that one expectation to the kept rows and list it in your report.

- [ ] **Step 7: Commit**

```bash
git add lib/Draft/EnvelopeDrafts.php docs/api.md tests/Integration/Draft/EnvelopeDraftsEditingTest.php
git commit -m "feat(signers): change the contact choice without clearing the boxes"
```

---

### Task 3: Load a user's own address books without a session

**Files:**
- Create: `lib/Contacts/CollectedAddressBooks.php`
- Create: `lib/Contacts/OwnAddressBooks.php`
- Create: `lib/Contacts/ContactEmails.php`
- Create: `tests/Integration/TestAddressBooks.php`
- Modify: `tests/Unit/AppInfo/PublicApiOnlyTest.php`
- Test: `tests/Integration/Contacts/OwnAddressBooksTest.php`, `tests/Unit/Contacts/ContactEmailsTest.php`

**Interfaces:**
- Consumes: DAV (`OCA\DAV\CardDAV\ContactsManager`, `OCA\DAV\CardDAV\CardDavBackend`), OCP contacts API.
- Produces:
  - `class OwnAddressBooks` (not final): `public const CONTACTS_APP_ID = 'contacts'`, `public const DEFAULT_URI = 'contacts'`; `public function of(string $userId): array` → `list<OCP\IAddressBook>` (own, enabled; `[]` when the user is unknown or the Contacts app is off for them); `public static function defaultWritable(array $books): ?OCP\IAddressBook`.
  - `final class CollectedAddressBooks implements OCP\Contacts\IManager` — `getUserAddressBooks(): list<IAddressBook>`.
  - `final class ContactEmails`: `public static function of(array $contact): array` → `list<string>` (lowercase, trimmed, valid); `public static function normalized(mixed $value): ?string`.
  - Test trait `TestAddressBooks`: `createAddressBook(string $userId, string $uri = 'contacts'): int`, `addContact(int $addressBookId, string $name, string ...$emails): void`, `shareAddressBook(int $addressBookId, string $withUserId): void`, `contactsIn(int $addressBookId): list<array{name: string, emails: list<string>}>`, `withContactsAppOff(callable $action): void`.

- [ ] **Step 1: Write the test helpers**

Create `tests/Integration/TestAddressBooks.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration;

use OCA\Assinaturas\Contacts\OwnAddressBooks;
use OCA\DAV\CardDAV\AddressBook;
use OCA\DAV\CardDAV\CardDavBackend;
use OCP\App\IAppManager;
use OCP\L10N\IFactory;
use OCP\Server;
use Sabre\VObject\Reader;

/** Real CardDAV address books for integration tests. Nextcloud deletes them with their user (TestUsers). */
trait TestAddressBooks {
	private function createAddressBook(string $userId, string $uri = OwnAddressBooks::DEFAULT_URI): int {
		return (int)Server::get(CardDavBackend::class)->createAddressBook("principals/users/$userId", $uri, ['{DAV:}displayname' => $uri]);
	}

	private function addContact(int $addressBookId, string $name, string ...$emails): void {
		$uid = bin2hex(random_bytes(8));
		$lines = ['BEGIN:VCARD', 'VERSION:3.0', "UID:$uid", "FN:$name", ...array_map(fn (string $email): string => "EMAIL:$email", $emails), 'END:VCARD'];
		Server::get(CardDavBackend::class)->createCard($addressBookId, "$uid.vcf", implode("\r\n", $lines) . "\r\n");
	}

	private function shareAddressBook(int $addressBookId, string $withUserId): void {
		$backend = Server::get(CardDavBackend::class);
		$info = $backend->getAddressBookById($addressBookId) ?? throw new \RuntimeException("No address book $addressBookId");
		$addressBook = new AddressBook($backend, $info, Server::get(IFactory::class)->get('dav'));
		$backend->updateShares($addressBook, [['href' => "principal:principals/users/$withUserId", 'readOnly' => false]], []);
	}

	/** @return list<array{name: string, emails: list<string>}> */
	private function contactsIn(int $addressBookId): array {
		return array_values(array_map(function (array $card): array {
			$vCard = Reader::read($card['carddata']);
			return [
				'name' => (string)$vCard->FN,
				'emails' => array_map(fn ($email): string => (string)$email, array_values($vCard->select('EMAIL'))),
			];
		}, Server::get(CardDavBackend::class)->getCards($addressBookId)));
	}

	private function withContactsAppOff(callable $action): void {
		$appManager = Server::get(IAppManager::class);
		$appManager->disableApp(OwnAddressBooks::CONTACTS_APP_ID);
		try {
			$action();
		} finally {
			$appManager->enableApp(OwnAddressBooks::CONTACTS_APP_ID);
		}
	}
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/Integration/Contacts/OwnAddressBooksTest.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Contacts;

use OCA\Assinaturas\Contacts\OwnAddressBooks;
use OCA\Assinaturas\Tests\Integration\TestAddressBooks;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\IAddressBook;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class OwnAddressBooksTest extends TestCase {
	use TestUsers;
	use TestAddressBooks;

	private string $owner;

	protected function setUp(): void {
		parent::setUp();
		$this->owner = $this->createUser('Maria Souza');
	}

	protected function tearDown(): void {
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testListsOnlyTheAddressBooksTheUserOwns(): void {
		$contacts = $this->createAddressBook($this->owner);
		$work = $this->createAddressBook($this->owner, 'trabalho');
		$colleague = $this->createUser('Carla Dias');
		$this->shareAddressBook($this->createAddressBook($colleague), $this->owner);

		$keys = array_map(fn (IAddressBook $book): string => (string)$book->getKey(), $this->addressBooks()->of($this->owner));

		$this->assertEqualsCanonicalizing([(string)$contacts, (string)$work], $keys);
	}

	public function testListsNoneWhileTheContactsAppIsOff(): void {
		$this->createAddressBook($this->owner);

		$this->withContactsAppOff(function (): void {
			$this->assertSame([], $this->addressBooks()->of($this->owner));
		});
	}

	public function testListsNoneForAnUnknownUser(): void {
		$this->assertSame([], $this->addressBooks()->of('nobody-' . bin2hex(random_bytes(4))));
	}

	public function testDefaultsToTheContactsAddressBook(): void {
		$this->createAddressBook($this->owner, 'trabalho');
		$this->createAddressBook($this->owner);

		$this->assertSame(OwnAddressBooks::DEFAULT_URI, OwnAddressBooks::defaultWritable($this->addressBooks()->of($this->owner))?->getUri());
	}

	public function testFallsBackToAnotherAddressBookOfTheUser(): void {
		$this->createAddressBook($this->owner, 'trabalho');

		$this->assertSame('trabalho', OwnAddressBooks::defaultWritable($this->addressBooks()->of($this->owner))?->getUri());
	}

	public function testHasNoDefaultWithoutAnAddressBook(): void {
		$this->assertNull(OwnAddressBooks::defaultWritable($this->addressBooks()->of($this->owner)));
	}

	private function addressBooks(): OwnAddressBooks {
		return Server::get(OwnAddressBooks::class);
	}
}
```

Create `tests/Unit/Contacts/ContactEmailsTest.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Unit\Contacts;

use OCA\Assinaturas\Contacts\ContactEmails;
use PHPUnit\Framework\TestCase;

final class ContactEmailsTest extends TestCase {
	public function testReadsASingleEmailInLowerCase(): void {
		$this->assertSame(['ana@example.com'], ContactEmails::of(['EMAIL' => ' Ana@Example.com ']));
	}

	public function testReadsEveryEmailOfAContact(): void {
		$this->assertSame(['ana@example.com', 'ana.lima@example.com'], ContactEmails::of(['EMAIL' => ['ana@example.com', 'ana.lima@example.com']]));
	}

	public function testDropsValuesThatAreNotEmails(): void {
		$this->assertSame(['ana@example.com'], ContactEmails::of(['EMAIL' => ['ana@', '', 42, 'ana@example.com']]));
	}

	public function testReadsNoneFromAContactWithoutEmail(): void {
		$this->assertSame([], ContactEmails::of(['FN' => 'Ana Lima']));
	}
}
```

In `tests/Unit/AppInfo/PublicApiOnlyTest.php`, add after `testUsesNoPrivateNextcloudClassInLib()`:

```php
	/** OCP\Contacts\IManager only knows the signed-in user; loading the owner's address books in the Send job needs DAV's own loader. */
	public function testReachesIntoTheDavAppOnlyToLoadAUsersAddressBooks(): void {
		$users = [];
		$files = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(dirname(__DIR__, 3) . '/lib', \FilesystemIterator::SKIP_DOTS));
		foreach ($files as $file) {
			if ($file->getExtension() === 'php' && str_contains((string)file_get_contents($file->getPathname()), 'OCA\\DAV\\')) {
				$users[] = $file->getFilename();
			}
		}

		$this->assertSame(['OwnAddressBooks.php'], $users);
	}
```

- [ ] **Step 3: Run them to see them fail**

Run: `tests/env/phpunit.sh --filter 'OwnAddressBooksTest|ContactEmailsTest|PublicApiOnlyTest'`
Expected: FAIL — `Error: Class "OCA\Assinaturas\Contacts\OwnAddressBooks" not found`, `Error: Class "OCA\Assinaturas\Contacts\ContactEmails" not found`, and `testReachesIntoTheDavAppOnlyToLoadAUsersAddressBooks` fails with `[] is identical to ['OwnAddressBooks.php']`.

- [ ] **Step 4: Implement the collector**

Create `lib/Contacts/CollectedAddressBooks.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Contacts;

use OCP\Contacts\IManager;
use OCP\IAddressBook;

/**
 * Receives the address books DAV registers for one user, apart from the request's shared contacts manager (whose
 * loader only knows the signed-in user). Callers use the collected address books directly; searching or writing
 * through the collector itself is not supported.
 */
final class CollectedAddressBooks implements IManager {
	private const USE_THE_ADDRESS_BOOKS = 'Search and write through the collected address books';

	/** @var array<array-key, IAddressBook> by key */
	private array $addressBooks = [];

	public function search($pattern, $searchProperties = [], $options = []): never {
		throw new \LogicException(self::USE_THE_ADDRESS_BOOKS);
	}

	public function delete($id, $addressBookKey): never {
		throw new \LogicException(self::USE_THE_ADDRESS_BOOKS);
	}

	public function createOrUpdate($properties, $addressBookKey): never {
		throw new \LogicException(self::USE_THE_ADDRESS_BOOKS);
	}

	public function isEnabled(): bool {
		return $this->addressBooks !== [];
	}

	public function registerAddressBook(IAddressBook $addressBook): void {
		$this->addressBooks[(string)$addressBook->getKey()] = $addressBook;
	}

	public function unregisterAddressBook(IAddressBook $addressBook): void {
		unset($this->addressBooks[(string)$addressBook->getKey()]);
	}

	public function register(\Closure $callable): void {
		$callable($this);
	}

	/** @return list<IAddressBook> */
	public function getUserAddressBooks(): array {
		return array_values($this->addressBooks);
	}

	public function clear(): void {
		$this->addressBooks = [];
	}
}
```

- [ ] **Step 5: Implement the own address books**

Create `lib/Contacts/OwnAddressBooks.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Contacts;

use OCA\DAV\CardDAV\CardDavBackend;
use OCA\DAV\CardDAV\ContactsManager;
use OCP\App\IAppManager;
use OCP\Constants;
use OCP\IAddressBook;
use OCP\IAddressBookEnabled;
use OCP\IURLGenerator;
use OCP\IUserManager;

/**
 * The address books a user owns, as Nextcloud's contacts API objects, with or without a session.
 * OCP\Contacts\IManager loads only the signed-in user's books, once per process, so the Send job (a long-running
 * background worker) cannot use it. This is the one place the app reaches into the DAV app, through the loader the
 * Contacts app itself uses for its background jobs. Shared and system address books, and books the user switched
 * off, are left out. Not final: tests replace it.
 */
class OwnAddressBooks {
	public const CONTACTS_APP_ID = 'contacts';
	/** The address book Nextcloud creates for every user at first login ("Contatos"). */
	public const DEFAULT_URI = 'contacts';
	private const USER_PRINCIPAL_PREFIX = 'principals/users/';

	public function __construct(
		private ContactsManager $davContacts,
		private CardDavBackend $cardDav,
		private IURLGenerator $urlGenerator,
		private IAppManager $appManager,
		private IUserManager $userManager,
	) {
	}

	/** @return list<IAddressBook> the user's own enabled address books; none while the Contacts app is off for them */
	public function of(string $userId): array {
		$user = $this->userManager->get($userId);
		if ($user === null || !$this->appManager->isEnabledForUser(self::CONTACTS_APP_ID, $user)) {
			return [];
		}
		$ownKeys = array_map(
			fn (array $row): string => (string)$row['id'],
			$this->cardDav->getUsersOwnAddressBooks(self::USER_PRINCIPAL_PREFIX . $userId),
		);
		$collected = new CollectedAddressBooks();
		$this->davContacts->setupContactsProvider($collected, $userId, $this->urlGenerator);
		return array_values(array_filter(
			$collected->getUserAddressBooks(),
			fn (IAddressBook $book): bool => in_array((string)$book->getKey(), $ownKeys, true) && self::isEnabled($book),
		));
	}

	/**
	 * Where a new contact goes: the user's "contacts" address book, else their first other writable one.
	 *
	 * @param list<IAddressBook> $books
	 */
	public static function defaultWritable(array $books): ?IAddressBook {
		$writable = array_values(array_filter(
			$books,
			fn (IAddressBook $book): bool => ((int)$book->getPermissions() & Constants::PERMISSION_CREATE) !== 0,
		));
		foreach ($writable as $book) {
			if ($book->getUri() === self::DEFAULT_URI) {
				return $book;
			}
		}
		return $writable[0] ?? null;
	}

	private static function isEnabled(IAddressBook $book): bool {
		return !$book instanceof IAddressBookEnabled || $book->isEnabled();
	}
}
```

- [ ] **Step 6: Implement the email reader**

Create `lib/Contacts/ContactEmails.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Contacts;

/** The email addresses of a contact as Nextcloud's contacts API returns it (one string or a list), normalized. */
final class ContactEmails {
	private const EMAIL_PROPERTY = 'EMAIL';

	/**
	 * @param array<array-key, mixed> $contact
	 * @return list<string>
	 */
	public static function of(array $contact): array {
		$values = $contact[self::EMAIL_PROPERTY] ?? [];
		$emails = [];
		foreach (is_array($values) ? $values : [$values] as $value) {
			$email = self::normalized($value);
			if ($email !== null) {
				$emails[] = $email;
			}
		}
		return $emails;
	}

	/** Lower case without surrounding spaces, or null when it is not an email address. */
	public static function normalized(mixed $value): ?string {
		if (!is_string($value)) {
			return null;
		}
		$email = strtolower(trim($value));
		return filter_var($email, FILTER_VALIDATE_EMAIL) === false ? null : $email;
	}
}
```

- [ ] **Step 7: Run the tests to see them pass**

Run: `tests/env/phpunit.sh --filter 'OwnAddressBooksTest|ContactEmailsTest|PublicApiOnlyTest'`
Expected: `OK (… tests, …)` with every test green.

- [ ] **Step 8: Run the gates**

```bash
composer run lint
tests/env/phpunit.sh
```
Expected: both exit 0; PHPUnit `OK`.

- [ ] **Step 9: Commit**

```bash
git add lib/Contacts/CollectedAddressBooks.php lib/Contacts/OwnAddressBooks.php lib/Contacts/ContactEmails.php tests/Integration/TestAddressBooks.php tests/Integration/Contacts/OwnAddressBooksTest.php tests/Unit/Contacts/ContactEmailsTest.php tests/Unit/AppInfo/PublicApiOnlyTest.php
git commit -m "feat(contacts): load a user's own address books without a session"
```

---

### Task 4: Suggest signers from contacts and instance users

**Files:**
- Create: `lib/Contacts/SuggestionSource.php`, `lib/Contacts/SignerSuggestion.php`, `lib/Contacts/SignerSuggestions.php`
- Create: `lib/Controller/SignerSuggestionController.php`
- Modify: `docs/api.md`
- Test: `tests/Integration/Contacts/SignerSuggestionsTest.php`, `tests/Integration/Controller/SignerSuggestionControllerTest.php`, `tests/Unit/Controller/SignerSuggestionRateLimitTest.php`

**Interfaces:**
- Consumes: `OwnAddressBooks::of()`, `OwnAddressBooks::defaultWritable()`, `ContactEmails` (Task 3); `EnvelopeAccess::currentUserId()`, `AccessPolicy::canUseApp()`.
- Produces:
  - `enum SuggestionSource: string { Contact = 'contact'; User = 'user' }`.
  - `final class SignerSuggestion(string $name, string $email, SuggestionSource $source)` with `toArray(): array{name: string, email: string, source: string}`.
  - `final class SignerSuggestions`: `MIN_QUERY_LENGTH = 2`, `MAX_QUERY_LENGTH = 320`, `MAX_RESULTS = 10`; `search(string $userId, string $query): array{suggestions: list<array{name: string, email: string, source: string}>, canSaveContacts: bool}`.
  - Route `GET /apps/assinaturas/api/v1/signer-suggestions?q=<text>` → 200 that array; 403 `{"error": "forbidden", …}`; `#[UserRateLimit(limit: 300, period: 300)]`.

- [ ] **Step 1: Write the failing tests**

Create `tests/Integration/Contacts/SignerSuggestionsTest.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Contacts;

use OCA\Assinaturas\Contacts\SignerSuggestions;
use OCA\Assinaturas\Tests\Integration\TestAddressBooks;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\IUserManager;
use OCP\Server;
use Test\TestCase;

/**
 * Names and emails carry a random tag, so other users of the test instance never match.
 *
 * @group DB
 */
final class SignerSuggestionsTest extends TestCase {
	use TestUsers;
	use TestAddressBooks;

	private string $member;
	private string $tag;
	private int $addressBookId;

	protected function setUp(): void {
		parent::setUp();
		$this->member = $this->createUser('Maria Souza');
		$this->tag = 'q' . bin2hex(random_bytes(4));
		$this->addressBookId = $this->createAddressBook($this->member);
	}

	protected function tearDown(): void {
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testSuggestsTheUsersContactsByNameOrEmail(): void {
		$this->addContact($this->addressBookId, "Ana {$this->tag} Lima", 'ana.lima@exemplo.com.br');
		$this->addContact($this->addressBookId, 'Bruno Costa', "bruno.{$this->tag}@exemplo.com.br");

		$this->assertEqualsCanonicalizing([
			['name' => "Ana {$this->tag} Lima", 'email' => 'ana.lima@exemplo.com.br', 'source' => 'contact'],
			['name' => 'Bruno Costa', 'email' => "bruno.{$this->tag}@exemplo.com.br", 'source' => 'contact'],
		], $this->search($this->tag)['suggestions']);
	}

	public function testSuggestsEveryEmailOfAContact(): void {
		$this->addContact($this->addressBookId, "Ana {$this->tag} Lima", 'ana@exemplo.com.br', 'ana.lima@trabalho.com.br');

		$this->assertEqualsCanonicalizing(['ana@exemplo.com.br', 'ana.lima@trabalho.com.br'], array_column($this->search($this->tag)['suggestions'], 'email'));
	}

	public function testSuggestsUsersOfTheInstanceThatHaveAnEmail(): void {
		$this->createUserWithEmail("Carla {$this->tag} Dias", "carla.{$this->tag}@exemplo.com.br");
		$this->createUser("Davi {$this->tag} Melo");

		$this->assertSame(
			[['name' => "Carla {$this->tag} Dias", 'email' => "carla.{$this->tag}@exemplo.com.br", 'source' => 'user']],
			$this->search($this->tag)['suggestions'],
		);
	}

	public function testLeavesDisabledUsersOut(): void {
		$userId = $this->createUserWithEmail("Eva {$this->tag} Rocha", "eva.{$this->tag}@exemplo.com.br");
		Server::get(IUserManager::class)->get($userId)?->setEnabled(false);

		$this->assertSame([], $this->search($this->tag)['suggestions']);
	}

	public function testPrefersTheUserWhenAContactHasTheSameEmail(): void {
		$email = "fabio.{$this->tag}@exemplo.com.br";
		$this->createUserWithEmail("Fábio {$this->tag} Nunes", $email);
		$this->addContact($this->addressBookId, "Fábio {$this->tag} (cliente)", strtoupper($email));

		$this->assertSame([['name' => "Fábio {$this->tag} Nunes", 'email' => $email, 'source' => 'user']], $this->search($this->tag)['suggestions']);
	}

	public function testListsAtMostTenSuggestions(): void {
		foreach (range(1, 12) as $number) {
			$this->addContact($this->addressBookId, "Cliente {$this->tag} $number", "cliente$number.{$this->tag}@exemplo.com.br");
		}

		$this->assertCount(SignerSuggestions::MAX_RESULTS, $this->search($this->tag)['suggestions']);
	}

	public function testPutsTheExactEmailFirst(): void {
		$exact = "gil.{$this->tag}@exemplo.com.br";
		$this->addContact($this->addressBookId, 'Gilberto Alves', "x.$exact");
		$this->addContact($this->addressBookId, 'Gil Souza', $exact);

		$this->assertSame($exact, $this->search(strtoupper($exact))['suggestions'][0]['email'] ?? null);
	}

	public function testDropsContactsWithoutAnEmail(): void {
		$this->addContact($this->addressBookId, "Heitor {$this->tag} Lima");

		$this->assertSame([], $this->search($this->tag)['suggestions']);
	}

	public function testSearchesNothingBelowTwoCharacters(): void {
		$this->addContact($this->addressBookId, "Ana {$this->tag} Lima", 'ana@exemplo.com.br');

		$this->assertSame([], $this->search(' a ')['suggestions']);
	}

	public function testLeavesOutAddressBooksOthersShareWithTheUser(): void {
		$colleague = $this->createUser('Carla Dias');
		$shared = $this->createAddressBook($colleague);
		$this->addContact($shared, "Iara {$this->tag} Costa", 'iara@exemplo.com.br');
		$this->shareAddressBook($shared, $this->member);

		$this->assertSame([], $this->search($this->tag)['suggestions']);
	}

	public function testSuggestsOnlyUsersWhileTheContactsAppIsOff(): void {
		$this->addContact($this->addressBookId, "Joana {$this->tag} Reis", 'joana@exemplo.com.br');
		$this->createUserWithEmail("João {$this->tag} Reis", "joao.{$this->tag}@exemplo.com.br");

		$this->withContactsAppOff(function (): void {
			$found = $this->search($this->tag);

			$this->assertSame(['user'], array_column($found['suggestions'], 'source'));
			$this->assertFalse($found['canSaveContacts']);
		});
	}

	public function testSaysWhetherTheUserHasAnAddressBookToSaveTo(): void {
		$withoutAddressBook = $this->createUser('Lia Prado');

		$this->assertTrue($this->search($this->tag)['canSaveContacts']);
		$this->assertFalse(Server::get(SignerSuggestions::class)->search($withoutAddressBook, $this->tag)['canSaveContacts']);
	}

	/** @return array{suggestions: list<array{name: string, email: string, source: string}>, canSaveContacts: bool} */
	private function search(string $query): array {
		return Server::get(SignerSuggestions::class)->search($this->member, $query);
	}

	private function createUserWithEmail(string $displayName, string $email): string {
		$userId = $this->createUser($displayName);
		Server::get(IUserManager::class)->get($userId)?->setSystemEMailAddress($email);
		return $userId;
	}
}
```

Create `tests/Integration/Controller/SignerSuggestionControllerTest.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Controller;

use OCA\Assinaturas\Access\SignersGroup;
use OCA\Assinaturas\Controller\SignerSuggestionController;
use OCA\Assinaturas\Tests\Integration\TestAddressBooks;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\AppFramework\Http;
use OCP\Server;
use Test\TestCase;

/**
 * @group DB
 */
final class SignerSuggestionControllerTest extends TestCase {
	use TestUsers;
	use TestAddressBooks;

	private string $member;

	protected function setUp(): void {
		parent::setUp();
		$this->member = $this->createUser();
		$this->addToGroup($this->member, SignersGroup::GROUP_ID);
		self::loginAsUser($this->member);
	}

	protected function tearDown(): void {
		self::logout();
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testSuggestsTheMembersContactsMatchingTheQuery(): void {
		$tag = 'q' . bin2hex(random_bytes(4));
		$this->addContact($this->createAddressBook($this->member), "Ana $tag Lima", "ana.$tag@exemplo.com.br");

		$response = $this->controller()->index($tag);

		$this->assertSame(Http::STATUS_OK, $response->getStatus());
		$this->assertSame([
			'suggestions' => [['name' => "Ana $tag Lima", 'email' => "ana.$tag@exemplo.com.br", 'source' => 'contact']],
			'canSaveContacts' => true,
		], $response->getData());
	}

	public function testForbidsUsersOutsideTheSignersGroup(): void {
		self::loginAsUser($this->createUser('Pessoa de Fora'));

		$response = $this->controller()->index('ana');

		$this->assertSame(Http::STATUS_FORBIDDEN, $response->getStatus());
		$this->assertSame('forbidden', $response->getData()['error']);
	}

	private function controller(): SignerSuggestionController {
		return Server::get(SignerSuggestionController::class);
	}
}
```

Create `tests/Unit/Controller/SignerSuggestionRateLimitTest.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Unit\Controller;

use OCA\Assinaturas\Controller\SignerSuggestionController;
use OCP\AppFramework\Http\Attribute\UserRateLimit;
use PHPUnit\Framework\TestCase;

/** Nextcloud enforces the attribute itself, so the declared limit is the behaviour. */
final class SignerSuggestionRateLimitTest extends TestCase {
	public function testThrottlesTheSearchPerUser(): void {
		$attributes = (new \ReflectionMethod(SignerSuggestionController::class, 'index'))->getAttributes(UserRateLimit::class);

		$this->assertCount(1, $attributes);
		$rateLimit = $attributes[0]->newInstance();
		$this->assertSame(300, $rateLimit->getLimit());
		$this->assertSame(300, $rateLimit->getPeriod());
	}
}
```

- [ ] **Step 2: Run them to see them fail**

Run: `tests/env/phpunit.sh --filter 'SignerSuggestionsTest|SignerSuggestionControllerTest|SignerSuggestionRateLimitTest'`
Expected: FAIL — `Error: Class "OCA\Assinaturas\Contacts\SignerSuggestions" not found` and `Class "OCA\Assinaturas\Controller\SignerSuggestionController" not found` (ReflectionException for the rate limit test).

- [ ] **Step 3: Implement the value types**

Create `lib/Contacts/SuggestionSource.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Contacts;

/** Where a suggested signer comes from; the UI labels it "Contato" or "Usuário". */
enum SuggestionSource: string {
	case Contact = 'contact';
	case User = 'user';
}
```

Create `lib/Contacts/SignerSuggestion.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Contacts;

/** One person to fill a signer row with. */
final class SignerSuggestion {
	public function __construct(
		public readonly string $name,
		public readonly string $email,
		public readonly SuggestionSource $source,
	) {
	}

	/** @return array{name: string, email: string, source: string} */
	public function toArray(): array {
		return ['name' => $this->name, 'email' => $this->email, 'source' => $this->source->value];
	}
}
```

- [ ] **Step 4: Implement the search**

Create `lib/Contacts/SignerSuggestions.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Contacts;

use OCP\IAddressBook;
use OCP\IUserManager;

/**
 * People to fill a signer row with, matching what the owner types by name or email: their own contacts and the
 * instance's enabled users that have an email. Shared and system address books are not searched. One entry per
 * email (a user before a contact), an exact email match first, at most ten.
 */
final class SignerSuggestions {
	public const MIN_QUERY_LENGTH = 2;
	public const MAX_QUERY_LENGTH = 320;
	public const MAX_RESULTS = 10;
	private const SEARCH_PROPERTIES = ['FN', 'EMAIL'];
	private const NAME_PROPERTY = 'FN';

	public function __construct(
		private OwnAddressBooks $addressBooks,
		private IUserManager $userManager,
	) {
	}

	/**
	 * `canSaveContacts` says whether the user has an address book a new signer can be saved to.
	 *
	 * @return array{suggestions: list<array{name: string, email: string, source: string}>, canSaveContacts: bool}
	 */
	public function search(string $userId, string $query): array {
		$books = $this->addressBooks->of($userId);
		$canSaveContacts = OwnAddressBooks::defaultWritable($books) !== null;
		$text = trim($query);
		$length = mb_strlen($text);
		if ($length < self::MIN_QUERY_LENGTH || $length > self::MAX_QUERY_LENGTH) {
			return ['suggestions' => [], 'canSaveContacts' => $canSaveContacts];
		}
		$byEmail = [];
		foreach ([...$this->users($text), ...$this->contacts($books, $text)] as $suggestion) {
			$byEmail[$suggestion->email] ??= $suggestion;
		}
		$ranked = self::exactEmailFirst(array_values($byEmail), mb_strtolower($text));
		return [
			'suggestions' => array_map(fn (SignerSuggestion $suggestion): array => $suggestion->toArray(), array_slice($ranked, 0, self::MAX_RESULTS)),
			'canSaveContacts' => $canSaveContacts,
		];
	}

	/** @return list<SignerSuggestion> */
	private function users(string $text): array {
		$found = [];
		foreach ($this->userManager->searchDisplayName($text, self::MAX_RESULTS) as $user) {
			$email = ContactEmails::normalized($user->getEMailAddress());
			$name = trim($user->getDisplayName());
			if ($email === null || $name === '' || !$user->isEnabled()) {
				continue;
			}
			$found[] = new SignerSuggestion($name, $email, SuggestionSource::User);
		}
		return $found;
	}

	/**
	 * @param list<IAddressBook> $books
	 * @return list<SignerSuggestion> one per email of each matching contact that has a name
	 */
	private function contacts(array $books, string $text): array {
		$found = [];
		foreach ($books as $book) {
			foreach ($book->search($text, self::SEARCH_PROPERTIES, ['limit' => self::MAX_RESULTS]) as $contact) {
				$name = is_string($contact[self::NAME_PROPERTY] ?? null) ? trim($contact[self::NAME_PROPERTY]) : '';
				if ($name === '') {
					continue;
				}
				foreach (ContactEmails::of($contact) as $email) {
					$found[] = new SignerSuggestion($name, $email, SuggestionSource::Contact);
				}
			}
		}
		return $found;
	}

	/**
	 * @param list<SignerSuggestion> $suggestions
	 * @return list<SignerSuggestion> the same, an exact email match first (the sort is stable)
	 */
	private static function exactEmailFirst(array $suggestions, string $text): array {
		usort(
			$suggestions,
			fn (SignerSuggestion $first, SignerSuggestion $second): int => (int)($second->email === $text) <=> (int)($first->email === $text),
		);
		return $suggestions;
	}
}
```

- [ ] **Step 5: Implement the endpoint**

Create `lib/Controller/SignerSuggestionController.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Controller;

use OCA\Assinaturas\Access\AccessPolicy;
use OCA\Assinaturas\Access\EnvelopeAccess;
use OCA\Assinaturas\AppInfo\Application;
use OCA\Assinaturas\Contacts\SignerSuggestions;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\FrontpageRoute;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\UserRateLimit;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IRequest;

/** People to fill a signer row with, for the wizard's name and email fields. Never logs the query. */
final class SignerSuggestionController extends Controller {
	/** Per user, enforced by Nextcloud with a 429. Typing is debounced, so this is about one search a second. */
	private const RATE_LIMIT = 300;
	private const RATE_LIMIT_PERIOD_SECONDS = 300;

	public function __construct(
		IRequest $request,
		private EnvelopeAccess $access,
		private AccessPolicy $accessPolicy,
		private SignerSuggestions $suggestions,
	) {
		parent::__construct(Application::APP_ID, $request);
	}

	#[NoAdminRequired]
	#[FrontpageRoute(verb: 'GET', url: '/api/v1/signer-suggestions')]
	#[UserRateLimit(limit: self::RATE_LIMIT, period: self::RATE_LIMIT_PERIOD_SECONDS)]
	public function index(string $q = ''): JSONResponse {
		$userId = $this->access->currentUserId();
		if (!$this->accessPolicy->canUseApp($userId)) {
			return new JSONResponse(['error' => 'forbidden', 'message' => 'You are not allowed to do this'], Http::STATUS_FORBIDDEN);
		}
		return new JSONResponse($this->suggestions->search($userId, $q));
	}
}
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `tests/env/phpunit.sh --filter 'SignerSuggestionsTest|SignerSuggestionControllerTest|SignerSuggestionRateLimitTest'`
Expected: `OK (15 tests, …)`.

- [ ] **Step 7: Document the route**

In `docs/api.md`:

1. In the *Routes* table, after the `GET /envelopes/{uuid}/activity-report` row, add:
```markdown
| GET | `/signer-suggestions?q=<text>` | — (members of the `assinaturas` group and admins; 403 `forbidden` for anyone else) | `{"suggestions": [{"name", "email", "source": "contact"\|"user"}…], "canSaveContacts": bool}`. See *Signer suggestions* below |
```
2. After the **Signing links:** paragraph, add:
```markdown
**Signer suggestions:** `q` is matched, case-insensitively and anywhere in the text, against the names and emails of the user's own contacts (their own CardDAV address books; books shared by others and the system address book are not searched) and against the display names, ids and emails of the instance's enabled users that have an email. There is one entry per email (lower case); a user wins over a contact with the same email; an entry equal to `q` comes first; at most 10 are returned. Entries without a name or a valid email are dropped. `q` shorter than 2 or longer than 320 characters (trimmed) returns `[]` without searching. `canSaveContacts` is `true` when the Contacts app is enabled for the user and they have a writable address book of their own; while the Contacts app is off, only users are suggested. The query is never logged.
```
3. In the *Rate limits* table, add the row:
```markdown
| `GET /signer-suggestions` | 300 per 5 minutes |
```

- [ ] **Step 8: Run the gates**

```bash
composer run lint
tests/env/phpunit.sh
```
Expected: both exit 0; PHPUnit `OK`.

- [ ] **Step 9: Commit**

```bash
git add lib/Contacts/SuggestionSource.php lib/Contacts/SignerSuggestion.php lib/Contacts/SignerSuggestions.php lib/Controller/SignerSuggestionController.php docs/api.md tests/Integration/Contacts/SignerSuggestionsTest.php tests/Integration/Controller/SignerSuggestionControllerTest.php tests/Unit/Controller/SignerSuggestionRateLimitTest.php
git commit -m "feat(contacts): suggest signers from contacts and instance users"
```

---

### Task 5: Save chosen signers to the owner's contacts after a successful send

**Files:**
- Create: `lib/Contacts/SignerContacts.php`
- Modify: `lib/Send/EnvelopeSender.php` (constructor, `finish()`, class docblock)
- Create: `tests/Fakes/FixedAddressBooks.php`, `tests/Fakes/UnwritableAddressBook.php`
- Modify: `tests/Integration/Send/EnvelopeSenderTest.php`, `tests/Integration/Sync/EnvelopeLifecycleTest.php` (constructor argument)
- Modify: `docs/api.md`
- Test: `tests/Integration/Contacts/SignerContactsTest.php`, `tests/Integration/Send/EnvelopeSenderTest.php`

**Interfaces:**
- Consumes: `OwnAddressBooks::of()`, `OwnAddressBooks::defaultWritable()`, `ContactEmails::of()` (Task 3); `Signer::savesToContacts()` (Task 1); `TestAddressBooks` (Task 3).
- Produces: `final class SignerContacts(OwnAddressBooks, SignerMapper, IUserManager, LoggerInterface)` with `saveChosen(Envelope $envelope): void` (never throws; logs `warning` "Saving a signer to the owner's contacts failed" with context `['envelope' => <uuid>, 'exception' => <class>]` per failure). `EnvelopeSender::__construct(…, Counters $counters, SignerContacts $signerContacts)` — new last argument. Test fakes `FixedAddressBooks(list<IAddressBook>)`, `UnwritableAddressBook` (`FAILURE_MESSAGE`).

- [ ] **Step 1: Write the fakes**

Create `tests/Fakes/FixedAddressBooks.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Fakes;

use OCA\Assinaturas\Contacts\OwnAddressBooks;
use OCP\IAddressBook;

/** Gives every user the same address books, without DAV. */
final class FixedAddressBooks extends OwnAddressBooks {
	/** @param list<IAddressBook> $books */
	public function __construct(private array $books) {
	}

	public function of(string $userId): array {
		return $this->books;
	}
}
```

Create `tests/Fakes/UnwritableAddressBook.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Fakes;

use OCP\Constants;
use OCP\IAddressBook;

/** An empty address book whose every write fails, as a CardDAV backend error would. */
final class UnwritableAddressBook implements IAddressBook {
	public const FAILURE_MESSAGE = 'Simulated CardDAV failure';

	public function getKey(): string {
		return '1';
	}

	public function getUri(): string {
		return 'contacts';
	}

	public function getDisplayName(): string {
		return 'Contatos';
	}

	public function search($pattern, $searchProperties, $options): array {
		return [];
	}

	public function createOrUpdate($properties): never {
		throw new \RuntimeException(self::FAILURE_MESSAGE);
	}

	public function getPermissions(): int {
		return Constants::PERMISSION_ALL;
	}

	public function delete($id): bool {
		return false;
	}

	public function isShared(): bool {
		return false;
	}

	public function isSystemAddressBook(): bool {
		return false;
	}
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/Integration/Contacts/SignerContactsTest.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Tests\Integration\Contacts;

use OCA\Assinaturas\Contacts\OwnAddressBooks;
use OCA\Assinaturas\Contacts\SignerContacts;
use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\SignerMapper;
use OCA\Assinaturas\Draft\EnvelopeDrafts;
use OCA\Assinaturas\Tests\Fakes\FixedAddressBooks;
use OCA\Assinaturas\Tests\Fakes\RecordingLogger;
use OCA\Assinaturas\Tests\Fakes\UnwritableAddressBook;
use OCA\Assinaturas\Tests\Integration\EnvelopeCleanup;
use OCA\Assinaturas\Tests\Integration\TestAddressBooks;
use OCA\Assinaturas\Tests\Integration\TestUsers;
use OCP\IUserManager;
use OCP\Server;
use Test\TestCase;

/**
 * Emails carry a random tag, so no user of the test instance has them.
 *
 * @group DB
 */
final class SignerContactsTest extends TestCase {
	use TestUsers;
	use TestAddressBooks;
	use EnvelopeCleanup;

	private string $owner;
	private string $tag;
	private RecordingLogger $logger;

	protected function setUp(): void {
		parent::setUp();
		$this->owner = $this->createUser('Maria Souza');
		$this->tag = 'q' . bin2hex(random_bytes(4));
		$this->logger = new RecordingLogger();
	}

	protected function tearDown(): void {
		$this->deleteEnvelopesOf($this->createdUserIds);
		$this->deleteCreatedUsers();
		parent::tearDown();
	}

	public function testAddsEachChosenSignerToTheDefaultAddressBook(): void {
		$work = $this->createAddressBook($this->owner, 'trabalho');
		$contacts = $this->createAddressBook($this->owner);
		$envelope = $this->envelopeWith([
			['Ana Lima', $this->email('ana'), true],
			['Bruno Souza', $this->email('bruno'), true],
			['Carla Dias', $this->email('carla'), false],
		]);

		$this->signerContacts()->saveChosen($envelope);

		$this->assertEqualsCanonicalizing([
			['name' => 'Ana Lima', 'emails' => [$this->email('ana')]],
			['name' => 'Bruno Souza', 'emails' => [$this->email('bruno')]],
		], $this->contactsIn($contacts));
		$this->assertSame([], $this->contactsIn($work));
		$this->assertSame([], $this->logger->records);
	}

	public function testLeavesAnEmailAlreadyInTheOwnersContactsAsItIs(): void {
		$work = $this->createAddressBook($this->owner, 'trabalho');
		$contacts = $this->createAddressBook($this->owner);
		$this->addContact($work, 'Ana (cliente)', strtoupper($this->email('ana')));
		$envelope = $this->envelopeWith([['Ana Lima', $this->email('ana'), true]]);

		$this->signerContacts()->saveChosen($envelope);

		$this->assertSame([], $this->contactsIn($contacts));
		$this->assertSame([['name' => 'Ana (cliente)', 'emails' => [strtoupper($this->email('ana'))]]], $this->contactsIn($work));
	}

	public function testLeavesTheEmailOfAUserOfTheInstanceOut(): void {
		$contacts = $this->createAddressBook($this->owner);
		$colleague = $this->createUser('Bia Ramos');
		Server::get(IUserManager::class)->get($colleague)?->setSystemEMailAddress($this->email('bia'));
		$envelope = $this->envelopeWith([['Bia Ramos', $this->email('bia'), true]]);

		$this->signerContacts()->saveChosen($envelope);

		$this->assertSame([], $this->contactsIn($contacts));
	}

	public function testSavesNothingWithoutAnAddressBook(): void {
		$envelope = $this->envelopeWith([['Ana Lima', $this->email('ana'), true]]);

		$this->signerContacts()->saveChosen($envelope);

		$this->assertSame([], $this->logger->records);
	}

	public function testSavesNothingWhileTheContactsAppIsOff(): void {
		$contacts = $this->createAddressBook($this->owner);
		$envelope = $this->envelopeWith([['Ana Lima', $this->email('ana'), true]]);

		$this->withContactsAppOff(fn () => $this->signerContacts()->saveChosen($envelope));

		$this->assertSame([], $this->contactsIn($contacts));
	}

	public function testLogsEachFailureWithTheEnvelopeIdAndNothingAboutTheSigner(): void {
		$envelope = $this->envelopeWith([
			['Ana Lima', $this->email('ana'), true],
			['Bruno Souza', $this->email('bruno'), true],
		]);

		$this->signerContacts(new FixedAddressBooks([new UnwritableAddressBook()]))->saveChosen($envelope);

		$failure = ['level' => 'warning', 'message' => "Saving a signer to the owner's contacts failed", 'context' => ['envelope' => $envelope->getUuid(), 'exception' => \RuntimeException::class]];
		$this->assertSame([$failure, $failure], $this->logger->records);
		$this->assertStringNotContainsString($this->tag, $this->logger->serialized());
		$this->assertStringNotContainsString('Ana Lima', $this->logger->serialized());
	}

	private function signerContacts(?OwnAddressBooks $addressBooks = null): SignerContacts {
		return new SignerContacts($addressBooks ?? Server::get(OwnAddressBooks::class), Server::get(SignerMapper::class), Server::get(IUserManager::class), $this->logger);
	}

	private function email(string $name): string {
		return "$name.{$this->tag}@exemplo.com.br";
	}

	/** @param list<array{string, string, bool}> $signers name, email, save to contacts */
	private function envelopeWith(array $signers): Envelope {
		$drafts = Server::get(EnvelopeDrafts::class);
		$envelope = $drafts->create($this->owner, 'Contrato', [$this->writeFile($this->owner, 'Contrato.pdf', self::minimalPdf())->getId()]);
		$drafts->replaceSigners($envelope, array_map(fn (array $signer): array => ['name' => $signer[0], 'email' => $signer[1], 'saveToContacts' => $signer[2]], $signers));
		return $envelope;
	}
}
```

In `tests/Integration/Send/EnvelopeSenderTest.php`:

1. Add these `use` lines (keep the list sorted):
```php
use OCA\Assinaturas\Contacts\SignerContacts;
use OCA\Assinaturas\Tests\Fakes\FixedAddressBooks;
use OCA\Assinaturas\Tests\Fakes\RecordingLogger;
use OCA\Assinaturas\Tests\Fakes\UnwritableAddressBook;
use OCA\Assinaturas\Tests\Integration\TestAddressBooks;
```
2. Add `use TestAddressBooks;` after `use ZapSignDoubles;` in the class body.
3. Add the constants after `PORTRAIT_PAGE`:
```php
	private const ANA_EMAIL = 'ana.contato@example.com';
	private const BRUNO_EMAIL = 'bruno.contato@example.com';
```
4. Add the property after `private array $queuedJobs = [];`:
```php
	/** Null: the real one, which reads the owner's address books. */
	private ?SignerContacts $signerContacts = null;
```
5. In `sender()`, after `new Counters($this->inMemoryAppConfig(), new NullLogger()),`, add:
```php
			$this->signerContacts ?? Server::get(SignerContacts::class),
```
6. Add these tests after `testReleasesEverySignerAndSkipsPlacementWhenThereAreNoBoxes()`:
```php
	public function testSavesTheChosenSignersToTheOwnersContactsOnceSent(): void {
		$addressBookId = $this->createAddressBook($this->owner);
		[$envelope, $signers] = $this->draftChoosingContacts(true, false);
		$this->sender()->claim($envelope);
		$this->transport->willRespond(200, $this->createdPayload($envelope, $signers))
			->willRespond(200, '{}')
			->willRespond(200, '{}');

		$this->sender()->send($envelope->getId());

		$this->assertSame(EnvelopeStatus::Pending, Server::get(EnvelopeMapper::class)->findById($envelope->getId())->statusValue());
		$this->assertSame([['name' => 'Ana Lima', 'emails' => [self::ANA_EMAIL]]], $this->contactsIn($addressBookId));
	}

	public function testSavesNoContactWhenTheSendFails(): void {
		$addressBookId = $this->createAddressBook($this->owner);
		[$envelope] = $this->draftChoosingContacts(true, true);
		$this->sender()->claim($envelope);
		$this->transport->willRespond(400, '{"detail":"Documento inválido"}');

		$this->sender()->send($envelope->getId());

		$this->assertSame(EnvelopeStatus::Failed, Server::get(EnvelopeMapper::class)->findById($envelope->getId())->statusValue());
		$this->assertSame([], $this->contactsIn($addressBookId));
	}

	public function testFinishesTheSendWhenSavingAContactFails(): void {
		$logger = new RecordingLogger();
		$this->signerContacts = new SignerContacts(new FixedAddressBooks([new UnwritableAddressBook()]), Server::get(SignerMapper::class), Server::get(IUserManager::class), $logger);
		[$envelope, $signers] = $this->draftChoosingContacts(true, false);
		$this->sender()->claim($envelope);
		$this->transport->willRespond(200, $this->createdPayload($envelope, $signers))
			->willRespond(200, '{}')
			->willRespond(200, '{}');

		$this->sender()->send($envelope->getId());

		$this->assertSame(EnvelopeStatus::Pending, Server::get(EnvelopeMapper::class)->findById($envelope->getId())->statusValue());
		$this->assertSame([[
			'level' => 'warning',
			'message' => "Saving a signer to the owner's contacts failed",
			'context' => ['envelope' => $envelope->getUuid(), 'exception' => \RuntimeException::class],
		]], $logger->records);
	}
```
7. Add this helper after `draft()`:
```php
	/** @return array{Envelope, list<Signer>} one document, no boxes, no signing order; Ana and Bruno with the given choices */
	private function draftChoosingContacts(bool $saveAna, bool $saveBruno): array {
		$drafts = Server::get(EnvelopeDrafts::class);
		$envelope = $drafts->create($this->owner, 'Contrato de serviços', [$this->writeFile($this->owner, 'Contrato.pdf', self::minimalPdf('contrato'))->getId()]);
		$signers = $drafts->replaceSigners($envelope, [
			['name' => 'Ana Lima', 'email' => self::ANA_EMAIL, 'saveToContacts' => $saveAna],
			['name' => 'Bruno Souza', 'email' => self::BRUNO_EMAIL, 'saveToContacts' => $saveBruno],
		]);
		return [Server::get(EnvelopeMapper::class)->findById($envelope->getId()), $signers];
	}
```

In `tests/Integration/Sync/EnvelopeLifecycleTest.php`, add `use OCA\Assinaturas\Contacts\SignerContacts;` and, in the `new EnvelopeSender(` call, after `new Counters($this->inMemoryAppConfig(), new NullLogger()),`, add:
```php
			Server::get(SignerContacts::class),
```

- [ ] **Step 3: Run them to see them fail**

Run: `tests/env/phpunit.sh --filter 'SignerContactsTest|EnvelopeSenderTest|EnvelopeLifecycleTest'`
Expected: FAIL — `Error: Class "OCA\Assinaturas\Contacts\SignerContacts" not found` (every test of the three classes errors, since `sender()` builds it).

- [ ] **Step 4: Implement the saving**

Create `lib/Contacts/SignerContacts.php`:

```php
<?php

declare(strict_types=1);

namespace OCA\Assinaturas\Contacts;

use OCA\Assinaturas\Db\Envelope;
use OCA\Assinaturas\Db\Signer;
use OCA\Assinaturas\Db\SignerMapper;
use OCP\IAddressBook;
use OCP\IUser;
use OCP\IUserManager;
use Psr\Log\LoggerInterface;

/**
 * After a successful Send, adds each signer the owner chose to the owner's default writable address book
 * (`FN` = name, `EMAIL` = email). An email already in one of the owner's address books, or belonging to an enabled
 * user, is left alone: nothing is created or merged. Never throws: a failure is logged with the envelope id only.
 */
final class SignerContacts {
	private const NAME_PROPERTY = 'FN';
	private const EMAIL_PROPERTY = 'EMAIL';

	public function __construct(
		private OwnAddressBooks $addressBooks,
		private SignerMapper $signerMapper,
		private IUserManager $userManager,
		private LoggerInterface $logger,
	) {
	}

	public function saveChosen(Envelope $envelope): void {
		try {
			$this->saveEachChosen($envelope);
		} catch (\Throwable $failure) {
			$this->logFailure($envelope, $failure);
		}
	}

	private function saveEachChosen(Envelope $envelope): void {
		$chosen = array_values(array_filter(
			$this->signerMapper->findByEnvelope($envelope->getId()),
			fn (Signer $signer): bool => $signer->savesToContacts(),
		));
		if ($chosen === []) {
			return;
		}
		$books = $this->addressBooks->of($envelope->getOwnerUid());
		$target = OwnAddressBooks::defaultWritable($books);
		if ($target === null) {
			return;
		}
		foreach ($chosen as $signer) {
			$this->saveOne($envelope, $signer, $books, $target);
		}
	}

	/** @param list<IAddressBook> $books */
	private function saveOne(Envelope $envelope, Signer $signer, array $books, IAddressBook $target): void {
		try {
			if ($this->isKnown($signer->getEmail(), $books)) {
				return;
			}
			$target->createOrUpdate([self::NAME_PROPERTY => $signer->getName(), self::EMAIL_PROPERTY => $signer->getEmail()]);
		} catch (\Throwable $failure) {
			$this->logFailure($envelope, $failure);
		}
	}

	/** @param list<IAddressBook> $books */
	private function isKnown(string $email, array $books): bool {
		$users = array_filter($this->userManager->getByEmail($email), fn (IUser $user): bool => $user->isEnabled());
		if ($users !== []) {
			return true;
		}
		foreach ($books as $book) {
			foreach ($book->search($email, [self::EMAIL_PROPERTY], []) as $contact) {
				if (in_array($email, ContactEmails::of($contact), true)) {
					return true;
				}
			}
		}
		return false;
	}

	private function logFailure(Envelope $envelope, \Throwable $failure): void {
		$this->logger->warning("Saving a signer to the owner's contacts failed", ['envelope' => $envelope->getUuid(), 'exception' => $failure::class]);
	}
}
```

- [ ] **Step 5: Call it once the envelope is sent**

In `lib/Send/EnvelopeSender.php`:

1. Add `use OCA\Assinaturas\Contacts\SignerContacts;` to the imports.
2. In the class docblock, after "…so a worker that lost its lease stops.", add the line:
```php
 * Once the envelope is pending, the signers the owner chose are added to their contacts; that never fails the Send.
```
3. In the constructor, after `private Counters $counters,`, add:
```php
		private SignerContacts $signerContacts,
```
4. Replace `finish()` with:
```php
	private function finish(Envelope $envelope, HeldLease $lease): void {
		$now = $this->timeFactory->getTime();
		$isSent = $this->envelopeMapper->transitionStatus($envelope->getId(), [EnvelopeStatus::Sending], EnvelopeStatus::Pending, null, $now, $lease->until, [
			'sent_at' => $now,
			'next_sync_at' => $now + self::FIRST_SYNC_DELAY_SECONDS,
			'error' => null,
		]);
		if (!$isSent) {
			return;
		}
		$this->signerContacts->saveChosen($envelope);
	}
```

- [ ] **Step 6: Run the tests to see them pass**

Run: `tests/env/phpunit.sh --filter 'SignerContactsTest|EnvelopeSenderTest|EnvelopeLifecycleTest'`
Expected: `OK (… tests, …)`.

- [ ] **Step 7: Document the send-time behaviour**

In `docs/api.md`, *Envelope detail* value notes, after the `emailBouncedAt` bullet, add:
```markdown
- Signer `saveToContacts` is the owner's choice to add the signer to their contacts. Once the envelope is sent (it becomes `pending`), the app creates a contact (`FN` = name, `EMAIL` = email) in the owner's default writable address book (their own book with URI `contacts`, else their first other own writable one) for each signer with `true`, unless the email is already in one of the owner's own address books or belongs to an enabled user. Nothing happens while the Contacts app is off for the owner or they have no writable address book. A failure is logged as a warning with the envelope uuid only and never fails or undoes the send.
```

- [ ] **Step 8: Run the gates**

```bash
composer run lint
tests/env/phpunit.sh
```
Expected: both exit 0; PHPUnit `OK`.

- [ ] **Step 9: Commit**

```bash
git add lib/Contacts/SignerContacts.php lib/Send/EnvelopeSender.php docs/api.md tests/Fakes/FixedAddressBooks.php tests/Fakes/UnwritableAddressBook.php tests/Integration/Contacts/SignerContactsTest.php tests/Integration/Send/EnvelopeSenderTest.php tests/Integration/Sync/EnvelopeLifecycleTest.php
git commit -m "feat(send): save chosen signers to the owner's contacts after sending"
```

---

### Task 6: Fetch signer suggestions through a cancellable cached query

**Files:**
- Modify: `src/api/types.ts`, `src/api/query-keys.ts`
- Create: `src/api/signer-suggestions.ts`, `src/api/signer-suggestions-query.ts`
- Test: `src/api/signer-suggestions.spec.ts`, `src/api/signer-suggestions-query.spec.ts`

**Interfaces:**
- Consumes: the route of Task 4.
- Produces:
  - Types `SignerSuggestionSource = 'contact' | 'user'`, `SignerSuggestion { name: string, email: string, source: SignerSuggestionSource }`, `SignerSuggestions { suggestions: SignerSuggestion[], canSaveContacts: boolean }`.
  - `QUERY_KEYS.signerSuggestions(query: string): readonly ['signer-suggestions', string]`.
  - `searchSignerSuggestions(query: string, signal?: AbortSignal): Promise<SignerSuggestions>` in `src/api/signer-suggestions.ts`.
  - `MIN_SUGGESTION_QUERY_LENGTH = 2`, `isSuggestionQuery(query: string): boolean`, `signerSuggestionsQueryOptions(query: string)` (key, `queryFn` passing TanStack's `signal`, `enabled` from 2 characters) in `src/api/signer-suggestions-query.ts`.

- [ ] **Step 1: Write the failing specs**

Create `src/api/signer-suggestions.spec.ts`:

```ts
import { AxiosError, AxiosHeaders } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { searchSignerSuggestions } from './signer-suggestions.ts'

const { get } = vi.hoisted(() => ({ get: vi.fn() }))

vi.mock('@nextcloud/axios', () => ({ default: { get } }))
vi.mock('@nextcloud/router', () => ({ generateUrl: (path: string) => `/index.php${path}` }))

const ROUTE = '/index.php/apps/assinaturas/api/v1/signer-suggestions'

beforeEach(() => {
	vi.resetAllMocks()
})

describe('searchSignerSuggestions', () => {
	it('asks for the people matching the query, with a signal that can cancel the request', async () => {
		const found = { suggestions: [{ name: 'Ana Lima', email: 'ana@exemplo.com.br', source: 'contact' }], canSaveContacts: true }
		get.mockResolvedValue({ data: found })
		const controller = new AbortController()

		expect(await searchSignerSuggestions('ana', controller.signal)).toEqual(found)
		expect(get).toHaveBeenCalledWith(ROUTE, { params: { q: 'ana' }, signal: controller.signal })
	})

	it('rejects with the server\'s code when the user may not use the app', async () => {
		get.mockRejectedValue(new AxiosError('forbidden', '403', undefined, undefined, {
			status: 403,
			statusText: '',
			headers: {},
			config: { headers: new AxiosHeaders() },
			data: { error: 'forbidden', message: 'You are not allowed to do this' },
		}))

		await expect(searchSignerSuggestions('ana')).rejects.toMatchObject({ code: 'forbidden', httpStatus: 403 })
	})
})
```

Create `src/api/signer-suggestions-query.spec.ts`:

```ts
import type { SignerSuggestions } from './types.ts'

import { QueryClient } from '@tanstack/vue-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QUERY_KEYS } from './query-keys.ts'
import { searchSignerSuggestions } from './signer-suggestions.ts'
import { isSuggestionQuery, signerSuggestionsQueryOptions } from './signer-suggestions-query.ts'
import { deferred } from '../test-support/deferred.ts'

vi.mock('./signer-suggestions.ts', () => ({ searchSignerSuggestions: vi.fn() }))

beforeEach(() => {
	vi.mocked(searchSignerSuggestions).mockReset()
})

describe('signerSuggestionsQueryOptions', () => {
	it('keeps one cache entry per query', () => {
		expect(signerSuggestionsQueryOptions('ana').queryKey).toEqual(QUERY_KEYS.signerSuggestions('ana'))
	})

	it('never asks for fewer than two characters', () => {
		expect(isSuggestionQuery('a')).toBe(false)
		expect(signerSuggestionsQueryOptions('a').enabled).toBe(false)
		expect(signerSuggestionsQueryOptions('an').enabled).toBe(true)
	})

	it('aborts the request of a query nobody waits for any more', async () => {
		const answer = deferred<SignerSuggestions>()
		vi.mocked(searchSignerSuggestions).mockReturnValue(answer.promise)
		const queryClient = new QueryClient()
		const options = signerSuggestionsQueryOptions('ana')
		const fetching = queryClient.fetchQuery(options).catch(() => null)
		await vi.waitFor(() => expect(searchSignerSuggestions).toHaveBeenCalledTimes(1))

		await queryClient.cancelQueries({ queryKey: options.queryKey })
		await fetching

		expect(vi.mocked(searchSignerSuggestions).mock.calls[0]?.[1]?.aborted).toBe(true)
	})
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/api/signer-suggestions.spec.ts src/api/signer-suggestions-query.spec.ts`
Expected: FAIL — both suites cannot resolve `./signer-suggestions.ts` / `./signer-suggestions-query.ts` (module not found).

- [ ] **Step 3: Add the types and the key**

In `src/api/types.ts`, after the `SignerInput` interface, add:

```ts
export type SignerSuggestionSource = 'contact' | 'user'

/** A person to fill a signer row with: one of the user's own contacts, or a user of the instance. */
export interface SignerSuggestion {
	name: string
	email: string
	source: SignerSuggestionSource
}

/** The answer of `GET /signer-suggestions`: at most 10 people, and whether the user has an address book to save new signers to. */
export interface SignerSuggestions {
	suggestions: SignerSuggestion[]
	canSaveContacts: boolean
}
```

In `src/api/query-keys.ts`, inside `QUERY_KEYS`, after `adminStatus`, add:

```ts
	/** The people suggested for what was typed in a signer field (trimmed, in lower case). */
	signerSuggestions: (query: string): readonly ['signer-suggestions', string] => ['signer-suggestions', query],
```

- [ ] **Step 4: Implement the request**

Create `src/api/signer-suggestions.ts`:

```ts
import type { SignerSuggestions } from './types.ts'

import axios from '@nextcloud/axios'
import { generateUrl } from '@nextcloud/router'
import { API_ROOT } from '../app-urls.ts'
import { calling } from './api-error.ts'

/** People matching `query` by name or email: the user's own contacts and the instance's users, at most 10. */
export async function searchSignerSuggestions(query: string, signal?: AbortSignal): Promise<SignerSuggestions> {
	return calling(async () => (await axios.get<SignerSuggestions>(generateUrl(`${API_ROOT}/signer-suggestions`), { params: { q: query }, signal })).data)
}
```

Create `src/api/signer-suggestions-query.ts`:

```ts
import { queryOptions } from '@tanstack/vue-query'
import { QUERY_KEYS } from './query-keys.ts'
import { searchSignerSuggestions } from './signer-suggestions.ts'

/** The server searches from two characters; shorter text is never sent. */
export const MIN_SUGGESTION_QUERY_LENGTH = 2

export function isSuggestionQuery(query: string): boolean {
	return query.length >= MIN_SUGGESTION_QUERY_LENGTH
}

/**
 * One cache entry per query. The request takes TanStack's signal, so a query nobody waits for any more (the user
 * typed on) is aborted instead of answering late.
 */
export function signerSuggestionsQueryOptions(query: string) {
	return queryOptions({
		queryKey: QUERY_KEYS.signerSuggestions(query),
		queryFn: ({ signal }) => searchSignerSuggestions(query, signal),
		enabled: isSuggestionQuery(query),
	})
}
```

- [ ] **Step 5: Run the specs to see them pass**

Run: `npx vitest run src/api/signer-suggestions.spec.ts src/api/signer-suggestions-query.spec.ts`
Expected: `Test Files  2 passed`, `Tests  5 passed`.

- [ ] **Step 6: Run the gates**

```bash
npm run typecheck
npm run lint
npm test
npm run build
```
Expected: each exits 0 (`npm test` reports no failed tests). If lint reports only import order, run `npx eslint --fix` on the files you touched and run `npm run lint` again.

- [ ] **Step 7: Commit**

```bash
git add src/api/types.ts src/api/query-keys.ts src/api/signer-suggestions.ts src/api/signer-suggestions-query.ts src/api/signer-suggestions.spec.ts src/api/signer-suggestions-query.spec.ts js css
git commit -m "feat(api): fetch signer suggestions through a cancellable cached query"
```

---

### Task 7: Carry the contact choice in each signer row

**Files:**
- Modify: `src/api/types.ts` (`SignerInput`, `EnvelopeSigner`)
- Modify: `src/wizard/signer-form.ts` (full replacement below)
- Modify: `src/wizard/SignersStep.vue` (import, `signersSave.onSuccess`, `saveRows`)
- Modify: `src/test-support/envelope-fixtures.ts`
- Modify: `src/api/envelopes.spec.ts`, `src/wizard/signer-form.spec.ts`, `src/wizard/SignersStep.spec.ts`

**Interfaces:**
- Consumes: `saveToContacts` in the signer JSON and body (Tasks 1–2).
- Produces: `SignerInput.saveToContacts: boolean`, `EnvelopeSigner.saveToContacts: boolean`; in `signer-form.ts`: `SignerDraft.saveToContacts: boolean`, `SAVE_NEW_SIGNERS_TO_CONTACTS = true`, `looksLikeEmail(email: string): boolean`, `signerIdentitiesChanged(inputs: SignerInput[], signers: EnvelopeSigner[]): boolean`; `sameSignerInputs`/`signersChanged` now also compare the choice.

- [ ] **Step 1: Write the failing specs**

In `src/wizard/signer-form.spec.ts`:

1. Import `emptySignerDraft`, `looksLikeEmail` and `signerIdentitiesChanged` too:
```ts
import { emptySignerDraft, looksLikeEmail, signerDraftsFrom, signerGroups, signerIdentitiesChanged, signerListError, signersChanged, toSignerInputs, validateSigners, withDenseGroups } from './signer-form.ts'
```
2. Replace the `draft()` helper with:
```ts
function draft(overrides: Partial<SignerDraft> = {}): SignerDraft {
	return { key: 'ana', name: 'Ana Lima', email: 'ana@exemplo.com.br', orderGroup: 1, saveToContacts: true, ...overrides }
}
```
3. In `describe('signerDraftsFrom')`, replace the expected rows with:
```ts
			{ key: 'signer-3', name: 'Ana Lima', email: 'ana@exemplo.com.br', orderGroup: 1, saveToContacts: false },
			{ key: 'signer-4', name: 'Bruno Costa', email: 'bruno@exemplo.com.br', orderGroup: 2, saveToContacts: false },
```
4. In `describe('toSignerInputs')`, replace the expected inputs with:
```ts
			{ name: 'Ana Lima', email: 'ana@exemplo.com.br', orderGroup: 1, saveToContacts: true },
			{ name: 'Bruno', email: 'bruno@exemplo.com.br', orderGroup: 2, saveToContacts: true },
			{ name: 'Carla', email: 'carla@exemplo.com.br', orderGroup: 2, saveToContacts: true },
```
5. Inside `describe('signersChanged')`, add:
```ts
	it('is true when only the choice to save a signer to contacts changed', () => {
		const drafts = signerDraftsFrom(SAVED_SIGNERS).map((row, index) => (index === 0 ? { ...row, saveToContacts: true } : row))

		expect(signersChanged(drafts, SAVED_SIGNERS)).toBe(true)
	})
```
6. At the end of the file, add:
```ts
describe('signerIdentitiesChanged', () => {
	it('is false when only the choice to save to contacts changed', () => {
		const inputs = toSignerInputs(signerDraftsFrom(SAVED_SIGNERS).map((row) => ({ ...row, saveToContacts: true })))

		expect(signerIdentitiesChanged(inputs, SAVED_SIGNERS)).toBe(false)
	})

	it('is false for the same signers in another order', () => {
		expect(signerIdentitiesChanged(toSignerInputs(signerDraftsFrom(SAVED_SIGNERS)).reverse(), SAVED_SIGNERS)).toBe(false)
	})

	it.each([
		['a name', { name: 'Ana Souza' }],
		['an email', { email: 'ana.souza@exemplo.com.br' }],
		['a group', { orderGroup: 2 }],
	])('is true when %s changed', (_change, override) => {
		const inputs = toSignerInputs(signerDraftsFrom(SAVED_SIGNERS).map((row, index) => (index === 0 ? { ...row, ...override } : row)))

		expect(signerIdentitiesChanged(inputs, SAVED_SIGNERS)).toBe(true)
	})

	it('is true when a row was added or removed', () => {
		expect(signerIdentitiesChanged(toSignerInputs([...signerDraftsFrom(SAVED_SIGNERS), draft({ key: 'new', email: 'carla@exemplo.com.br' })]), SAVED_SIGNERS)).toBe(true)
		expect(signerIdentitiesChanged(toSignerInputs(signerDraftsFrom(SAVED_SIGNERS).slice(1)), SAVED_SIGNERS)).toBe(true)
	})
})

describe('emptySignerDraft', () => {
	it('starts a new signer with the choice to save them to contacts', () => {
		expect(emptySignerDraft('new-1', 1).saveToContacts).toBe(true)
	})
})

describe('looksLikeEmail', () => {
	it.each(['ana@exemplo.com.br', ' Ana@Exemplo.com.BR '])('accepts %j', (email) => {
		expect(looksLikeEmail(email)).toBe(true)
	})

	it.each(['', 'ana', 'ana@', 'ana@exemplo'])('refuses %j', (email) => {
		expect(looksLikeEmail(email)).toBe(false)
	})
})
```

In `src/wizard/SignersStep.spec.ts`, update the existing expectations so each saved signer row carries `saveToContacts: false` (the fixture default) and each row added in the test carries `saveToContacts: true`:

1. In `it('saves the edited signers, then continues')`, the expected array becomes:
```ts
			expect(replaceSigners).toHaveBeenCalledWith(DRAFT_UUID, [
				{ name: 'Ana Lima', email: 'ana.lima@exemplo.com.br', orderGroup: 1, saveToContacts: false },
				{ name: 'Bruno Costa', email: 'bruno@exemplo.com.br', orderGroup: 1, saveToContacts: false },
				{ name: 'Carla Souza', email: 'carla.souza@exemplo.com.br', orderGroup: 2, saveToContacts: false },
				{ name: 'Diego Ramos', email: 'diego.ramos@exemplo.com.br', orderGroup: 2, saveToContacts: false },
			])
```
2. In every `expect.arrayContaining([{ name: …, email: …, orderGroup: … }])` of a saved row (the `Carla Souza Lima` rows, the `Diego` and `Diego Ramos` rows with `diego@exemplo.com.br`), add `, saveToContacts: false` inside the object.
3. Replace the `EVA` constant with:
```ts
			const EVA = { name: 'Eva Rocha', email: 'eva@exemplo.com.br', orderGroup: 2, saveToContacts: true }
```
4. At the end of the top-level `describe('the signers step', …)` block, add:
```ts
	describe('the choice to save each signer to contacts', () => {
		it('keeps the choice a saved signer already has', async () => {
			vi.mocked(getEnvelope).mockResolvedValue(orderedEnvelope({ signers: ARTBOARD_SIGNERS.map((signer) => ({ ...signer, saveToContacts: signer.id === 4 })) }))
			const { wrapper } = await mountStep()

			await field(wrapper, 'Nome do signatário 4').setValue('Diego Ramos')
			await continueToNextStep(wrapper)

			expect(replaceSigners).toHaveBeenCalledWith(DRAFT_UUID, expect.arrayContaining([
				{ name: 'Ana Lima', email: 'ana.lima@exemplo.com.br', orderGroup: 1, saveToContacts: false },
				{ name: 'Diego Ramos', email: 'diego@exemplo.com.br', orderGroup: 2, saveToContacts: true },
			]))
		})

		it('starts a new signer with the choice to save them to contacts', async () => {
			const { wrapper } = await mountStep()
			await buttonNamed(wrapper, 'Adicionar signatário')?.trigger('click')
			await settle()
			await field(wrapper, 'Nome do signatário 5').setValue('Eva Rocha')
			await field(wrapper, 'E-mail do signatário 5').setValue('eva@exemplo.com.br')

			await continueToNextStep(wrapper)

			expect(replaceSigners).toHaveBeenCalledWith(DRAFT_UUID, expect.arrayContaining([{ name: 'Eva Rocha', email: 'eva@exemplo.com.br', orderGroup: 2, saveToContacts: true }]))
		})
	})
```

In `src/api/envelopes.spec.ts`, in `describe('replaceSigners')`, change the signers to:
```ts
		const signers = [{ name: 'Ana', email: 'a@b.c', orderGroup: 1, saveToContacts: true }]
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/wizard/signer-form.spec.ts src/wizard/SignersStep.spec.ts src/api/envelopes.spec.ts`
Expected: FAIL — `signer-form.spec.ts` fails on the missing exports (`signerIdentitiesChanged is not a function`, `looksLikeEmail is not a function`) and on rows without `saveToContacts`; `SignersStep.spec.ts` fails the updated `toHaveBeenCalledWith` expectations (the sent rows have no `saveToContacts`).

- [ ] **Step 3: Add the fields to the types and the fixture**

In `src/api/types.ts`:
1. In `EnvelopeSigner`, after `emailBouncedAt: number | null`, add:
```ts
	/** The owner's choice to add the signer to their contacts once the envelope is sent. */
	saveToContacts: boolean
```
2. In `SignerInput`, after `orderGroup: number`, add:
```ts
	saveToContacts: boolean
```

In `src/test-support/envelope-fixtures.ts`, in `envelopeSigner()`, after `emailBouncedAt: null,`, add:
```ts
		saveToContacts: false,
```

- [ ] **Step 4: Carry the choice in the form model**

Replace the whole of `src/wizard/signer-form.ts` with:

```ts
import type { EnvelopeSigner, SignerInput } from '../api/types.ts'
import type { EnvelopeLimits } from '../app-config.ts'

import { t } from '@nextcloud/l10n'
import { APP_ID } from '../app-config.ts'
import { PLAIN_TEXT } from '../presentation/plain-text.ts'

/** One signer row as typed in the wizard; `key` stays the same while the row is edited. */
export interface SignerDraft {
	key: string
	name: string
	email: string
	orderGroup: number
	/** Add the signer to the owner's contacts once the envelope is sent (the server skips anyone already known). */
	saveToContacts: boolean
}

export interface SignerErrors {
	name?: string
	email?: string
}

/** The pattern the wizard checks before the server does (docs/api.md: `signer_email_invalid`). */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_EMAIL_LENGTH = 320

/** The signing page asks for a first name and a surname (docs/api.md: `signer_name_incomplete`). */
export const MIN_NAME_WORDS = 2
const WORD_SEPARATORS = /\s+/u

/** A new signer's "Salvar nos contatos" starts ticked; the owner unticks the ones not to keep. */
export const SAVE_NEW_SIGNERS_TO_CONTACTS = true

/**
 * What the rows are checked for: a save keeps a name of one word, since the owner may still be typing it; moving on
 * needs a first name and a surname, as Send does.
 */
export type SignerCheck = 'save' | 'continue'

const NEEDS_FULL_NAME: Readonly<Record<SignerCheck, boolean>> = { save: false, continue: true }

/** The group that signs first; groups are numbered from it without gaps. */
export const FIRST_GROUP = 1

/**
 * The desktop columns of a signer row, shared by the column names above the rows (Wizard-Signers.dc.html lines 90
 * and 94): avatar, name, email, the group with a signing order, and remove.
 */
export function signerColumns(isOrdered: boolean): string {
	return isOrdered ? '36px minmax(0, 1fr) minmax(0, 1.3fr) 140px 44px' : '36px minmax(0, 1fr) minmax(0, 1.3fr) 44px'
}

export function signerDraftKey(signerId: number): string {
	return `signer-${signerId}`
}

export function signerDraftsFrom(signers: EnvelopeSigner[]): SignerDraft[] {
	return signers.map((signer) => ({ key: signerDraftKey(signer.id), name: signer.name, email: signer.email, orderGroup: signer.orderGroup, saveToContacts: signer.saveToContacts }))
}

export function emptySignerDraft(key: string, orderGroup: number): SignerDraft {
	return { key, name: '', email: '', orderGroup, saveToContacts: SAVE_NEW_SIGNERS_TO_CONTACTS }
}

function normalizedEmail(email: string): string {
	return email.trim().toLowerCase()
}

/** Whether the text reads as a whole email address, spaces and capitals aside. */
export function looksLikeEmail(email: string): boolean {
	const normalized = normalizedEmail(email)
	return normalized.length <= MAX_EMAIL_LENGTH && EMAIL_PATTERN.test(normalized)
}

function isFullName(trimmedName: string): boolean {
	return trimmedName.split(WORD_SEPARATORS).length >= MIN_NAME_WORDS
}

function nameError(name: string, limits: EnvelopeLimits, check: SignerCheck): string | undefined {
	const trimmed = name.trim()
	if (trimmed === '') {
		return t(APP_ID, 'Enter the name.')
	}
	if (trimmed.length > limits.maxNameLength) {
		return t(APP_ID, 'Use at most {count} characters.', { count: limits.maxNameLength }, undefined, PLAIN_TEXT)
	}
	if (NEEDS_FULL_NAME[check] && !isFullName(trimmed)) {
		return t(APP_ID, 'Enter the first name and surname.')
	}
	return undefined
}

function emailError(email: string, earlierEmails: ReadonlySet<string>): string | undefined {
	if (!looksLikeEmail(email)) {
		return t(APP_ID, 'Enter a valid email address.')
	}
	if (earlierEmails.has(email)) {
		return t(APP_ID, 'This email is already on the list.')
	}
	return undefined
}

/** The problems of each row, by key; a row without problems is absent. A repeated email is flagged from its second row on. */
export function validateSigners(drafts: SignerDraft[], limits: EnvelopeLimits, check: SignerCheck = 'continue'): Map<string, SignerErrors> {
	const errors = new Map<string, SignerErrors>()
	const earlierEmails = new Set<string>()
	for (const draft of drafts) {
		const email = normalizedEmail(draft.email)
		const rowErrors: SignerErrors = {}
		const name = nameError(draft.name, limits, check)
		const address = emailError(email, earlierEmails)
		earlierEmails.add(email)
		if (name !== undefined) {
			rowErrors.name = name
		}
		if (address !== undefined) {
			rowErrors.email = address
		}
		if (name !== undefined || address !== undefined) {
			errors.set(draft.key, rowErrors)
		}
	}
	return errors
}

/** A problem of the list as a whole, or null. */
export function signerListError(drafts: SignerDraft[], limits: EnvelopeLimits): string | null {
	return drafts.length > limits.maxSigners ? t(APP_ID, 'Too many signers for one envelope.') : null
}

/** Each group once, in signing order. */
export function signerGroups(drafts: SignerDraft[]): number[] {
	return [...new Set(drafts.map((draft) => draft.orderGroup))].sort((first, second) => first - second)
}

/** The rows with their groups renumbered 1, 2, 3… without gaps, keeping which group signs before which. */
export function withDenseGroups(drafts: SignerDraft[]): SignerDraft[] {
	const groups = signerGroups(drafts)
	return drafts.map((draft) => ({ ...draft, orderGroup: groups.indexOf(draft.orderGroup) + FIRST_GROUP }))
}

/** The body of `PUT /envelopes/{uuid}/signers`. */
export function toSignerInputs(drafts: SignerDraft[]): SignerInput[] {
	return withDenseGroups(drafts).map((draft) => ({ name: draft.name.trim(), email: normalizedEmail(draft.email), orderGroup: draft.orderGroup, saveToContacts: draft.saveToContacts }))
}

function isSignerInput(value: unknown): value is SignerInput {
	return typeof value === 'object' && value !== null
		&& 'name' in value && typeof value.name === 'string'
		&& 'email' in value && typeof value.email === 'string'
		&& 'orderGroup' in value && typeof value.orderGroup === 'number'
		&& 'saveToContacts' in value && typeof value.saveToContacts === 'boolean'
}

/** Whether a value is a body of `PUT /envelopes/{uuid}/signers`, e.g. what a failed save sent. */
export function isSignerInputs(value: unknown): value is SignerInput[] {
	return Array.isArray(value) && value.every(isSignerInput)
}

/** Whether two request bodies name the same signers, in the same order and groups, with the same contact choices. */
export function sameSignerInputs(first: SignerInput[], second: SignerInput[]): boolean {
	return first.length === second.length && first.every((input, index) => {
		const other = second[index]
		return other !== undefined && input.name === other.name && input.email === other.email && input.orderGroup === other.orderGroup && input.saveToContacts === other.saveToContacts
	})
}

/** Whether saving the rows would change the saved signers (spaces and capitals the server drops do not count). */
export function signersChanged(drafts: SignerDraft[], signers: EnvelopeSigner[]): boolean {
	return !sameSignerInputs(toSignerInputs(drafts), toSignerInputs(signerDraftsFrom(signers)))
}

/**
 * Whether the inputs name other signers than the saved ones: a row added or removed, or a different name, email or
 * group. Only that makes the server clear the placed boxes; a changed contact choice alone keeps them (docs/api.md).
 */
export function signerIdentitiesChanged(inputs: SignerInput[], signers: EnvelopeSigner[]): boolean {
	const savedByEmail = new Map(toSignerInputs(signerDraftsFrom(signers)).map((input) => [input.email, input]))
	return inputs.length !== savedByEmail.size || inputs.some((input) => {
		const saved = savedByEmail.get(input.email)
		return saved === undefined || saved.name !== input.name || saved.orderGroup !== input.orderGroup
	})
}
```

- [ ] **Step 5: Ask about boxes only when the signers themselves change**

In `src/wizard/SignersStep.vue`:

1. Change the `./signer-form.ts` import to:
```ts
import { emptySignerDraft, FIRST_GROUP, sameSignerInputs, signerColumns, signerDraftKey, signerDraftsFrom, signerGroups, signerIdentitiesChanged, signerListError, signersChanged, toSignerInputs, validateSigners, withDenseGroups } from './signer-form.ts'
```
2. Replace the `signersSave` mutation's docblock and `onSuccess` with:
```ts
	/**
	 * The saved rows take the server's ids and colours, unless the owner typed while the save was on its way.
	 * When the signers themselves changed, the server dropped every placed box with the old ones: no save of boxes
	 * counts any more. A save of contact choices only keeps the signers and their boxes.
	 */
	onSuccess: (detail, sent) => {
		const keptBoxes = !signerIdentitiesChanged(sent, latestEnvelope(queryClient, uuid, props.envelope).signers)
		showDetail(detail)
		forgetSettledSaves(queryClient, uuid, 'signers')
		if (!keptBoxes) {
			forgetEveryFieldsSave(queryClient, uuid)
		}
		if (sameSignerInputs(toSignerInputs(drafts.value), sent)) {
			drafts.value = draftsFor(detail)
		}
	},
```
3. In `saveRows()`, replace
```ts
	if (!isClearingConfirmed && hasPlacedBoxes(saved) && !(await confirmClearingBoxes())) {
```
with
```ts
	const clearsBoxes = hasPlacedBoxes(saved) && signerIdentitiesChanged(toSignerInputs(drafts.value), saved.signers)
	if (!isClearingConfirmed && clearsBoxes && !(await confirmClearingBoxes())) {
```

- [ ] **Step 6: Run the specs to see them pass**

Run: `npx vitest run src/wizard/signer-form.spec.ts src/wizard/SignersStep.spec.ts src/api/envelopes.spec.ts`
Expected: all three files pass.

- [ ] **Step 7: Run the gates**

```bash
npm run typecheck
npm run lint
npm test
npm run build
```
Expected: each exits 0. If `npm run typecheck` names another spec or fixture that builds an `EnvelopeSigner` or `SignerInput` literal, add the missing `saveToContacts` there (`false` for a saved signer, `true` for a new row) and list the file in your report.

- [ ] **Step 8: Commit**

```bash
git add src/api/types.ts src/wizard/signer-form.ts src/wizard/SignersStep.vue src/test-support/envelope-fixtures.ts src/api/envelopes.spec.ts src/wizard/signer-form.spec.ts src/wizard/SignersStep.spec.ts js css
git commit -m "feat(wizard): carry the contact choice in each signer row"
```

---

### Task 8: Add a combobox and a checkbox to the kit

**Files:**
- Create: `src/ui/combobox.ts`, `src/ui/AvCombobox.vue`, `src/ui/AvCheckbox.vue`
- Test: `src/ui/AvCombobox.spec.ts`, `src/ui/AvCheckbox.spec.ts`

**Interfaces:**
- Consumes: `AvField.vue` (label, error, `describedBy`), `--av-*` tokens.
- Produces:
  - `src/ui/combobox.ts`: `interface ComboboxOption { id: string }`, `NO_ACTIVE_OPTION = -1`, `COMBOBOX_MOVES: Readonly<Record<string, (current: number, count: number) => number>>` (ArrowDown/ArrowUp, wrapping).
  - `AvCombobox<Option extends ComboboxOption>`: `v-model: string`; props `label`, `labelHidden?`, `type?: 'text' | 'email'`, `error?: string | null`, `autocomplete?`, `maxlength?`, `options: Option[]`, `listLabel: string`, `announcement: string`; emits `pick: [option: Option]`; slot `option({ option })`. The input has `role="combobox"`, `aria-autocomplete="list"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`; the list opens after typing (or ↓/↑) when there are options; Enter picks the active option; Esc closes; the live region reads `announcement` only while open.
  - `AvCheckbox`: `v-model: boolean`; props `label: string`, `context?: string` (visually hidden after a comma, to tell rows apart).

- [ ] **Step 1: Write the failing specs**

Create `src/ui/AvCombobox.spec.ts`:

```ts
import type { VueWrapper } from '@vue/test-utils'

import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { h } from 'vue'
import AvCombobox from './AvCombobox.vue'

interface Person {
	id: string
	name: string
}

const PEOPLE: Person[] = [
	{ id: 'ana', name: 'Ana Lima' },
	{ id: 'bruno', name: 'Bruno Costa' },
	{ id: 'carla', name: 'Carla Souza' },
]
const ANNOUNCEMENT = '3 sugestões'

function mountCombobox(options: Person[] = PEOPLE) {
	return mount(AvCombobox, {
		props: { modelValue: '', label: 'Nome do signatário 1', options, listLabel: 'Sugestões', announcement: ANNOUNCEMENT },
		slots: { option: ({ option }: { option: Person }) => h('span', option.name) },
		attachTo: document.body,
	})
}

function input(wrapper: VueWrapper) {
	return wrapper.find('input')
}

function listbox(wrapper: VueWrapper) {
	return wrapper.find('[role="listbox"]')
}

function options(wrapper: VueWrapper) {
	return wrapper.findAll('[role="option"]')
}

function liveRegion(wrapper: VueWrapper) {
	return wrapper.find('[aria-live="polite"]')
}

async function type(wrapper: VueWrapper, text: string) {
	await input(wrapper).setValue(text)
}

async function press(wrapper: VueWrapper, key: string) {
	await input(wrapper).trigger('keydown', { key })
}

afterEach(() => {
	document.body.innerHTML = ''
})

describe('AvCombobox', () => {
	describe('the pattern', () => {
		it('labels a text box that controls a list of suggestions', () => {
			const wrapper = mountCombobox()

			expect(wrapper.find('label').attributes('for')).toBe(input(wrapper).attributes('id'))
			expect(input(wrapper).attributes('role')).toBe('combobox')
			expect(input(wrapper).attributes('aria-autocomplete')).toBe('list')
			expect(input(wrapper).attributes('aria-controls')).toBe(listbox(wrapper).attributes('id'))
			expect(listbox(wrapper).attributes('aria-label')).toBe('Sugestões')
		})

		it('stays closed until the user types', async () => {
			const wrapper = mountCombobox()

			await input(wrapper).trigger('focus')

			expect(input(wrapper).attributes('aria-expanded')).toBe('false')
			expect(listbox(wrapper).isVisible()).toBe(false)
		})

		it('opens the list once the user types', async () => {
			const wrapper = mountCombobox()

			await type(wrapper, 'An')

			expect(input(wrapper).attributes('aria-expanded')).toBe('true')
			expect(options(wrapper).map((option) => option.text())).toEqual(['Ana Lima', 'Bruno Costa', 'Carla Souza'])
		})

		it('stays closed when there is nothing to suggest', async () => {
			const wrapper = mountCombobox([])

			await type(wrapper, 'An')

			expect(input(wrapper).attributes('aria-expanded')).toBe('false')
		})
	})

	describe('the keyboard', () => {
		it('moves to the first suggestion with the down arrow and exposes it as the active one', async () => {
			const wrapper = mountCombobox()
			await type(wrapper, 'An')

			await press(wrapper, 'ArrowDown')

			expect(input(wrapper).attributes('aria-activedescendant')).toBe(options(wrapper)[0]?.attributes('id'))
			expect(options(wrapper)[0]?.attributes('aria-selected')).toBe('true')
			expect(options(wrapper)[1]?.attributes('aria-selected')).toBe('false')
		})

		it('wraps from the first suggestion to the last with the up arrow', async () => {
			const wrapper = mountCombobox()
			await type(wrapper, 'An')

			await press(wrapper, 'ArrowDown')
			await press(wrapper, 'ArrowUp')

			expect(input(wrapper).attributes('aria-activedescendant')).toBe(options(wrapper)[2]?.attributes('id'))
		})

		it('opens the list with the down arrow alone', async () => {
			const wrapper = mountCombobox()

			await press(wrapper, 'ArrowDown')

			expect(input(wrapper).attributes('aria-expanded')).toBe('true')
			expect(input(wrapper).attributes('aria-activedescendant')).toBe(options(wrapper)[0]?.attributes('id'))
		})

		it('picks the active suggestion with Enter and closes', async () => {
			const wrapper = mountCombobox()
			await type(wrapper, 'An')
			await press(wrapper, 'ArrowDown')
			await press(wrapper, 'ArrowDown')

			await press(wrapper, 'Enter')

			expect(wrapper.emitted('pick')).toEqual([[PEOPLE[1]]])
			expect(input(wrapper).attributes('aria-expanded')).toBe('false')
		})

		it('leaves Enter alone while no suggestion is active', async () => {
			const wrapper = mountCombobox()
			await type(wrapper, 'An')

			await press(wrapper, 'Enter')

			expect(wrapper.emitted('pick')).toBeUndefined()
			expect(input(wrapper).attributes('aria-expanded')).toBe('true')
		})

		it('closes with Escape without picking', async () => {
			const wrapper = mountCombobox()
			await type(wrapper, 'An')
			await press(wrapper, 'ArrowDown')

			await press(wrapper, 'Escape')

			expect(input(wrapper).attributes('aria-expanded')).toBe('false')
			expect(input(wrapper).attributes('aria-activedescendant')).toBeUndefined()
			expect(wrapper.emitted('pick')).toBeUndefined()
		})
	})

	describe('the pointer', () => {
		it('picks a suggestion when it is clicked', async () => {
			const wrapper = mountCombobox()
			await type(wrapper, 'An')

			await options(wrapper)[2]?.trigger('click')

			expect(wrapper.emitted('pick')).toEqual([[PEOPLE[2]]])
		})

		it('keeps the focus in the text box while a suggestion is pressed', async () => {
			const wrapper = mountCombobox()
			await type(wrapper, 'An')
			const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true })

			options(wrapper)[0]?.element.dispatchEvent(mousedown)

			expect(mousedown.defaultPrevented).toBe(true)
		})

		it('closes when the focus leaves it', async () => {
			const wrapper = mountCombobox()
			await type(wrapper, 'An')

			await input(wrapper).trigger('focusout', { relatedTarget: null })

			expect(input(wrapper).attributes('aria-expanded')).toBe('false')
		})
	})

	describe('the announcement', () => {
		it('reads how many suggestions there are while the list is open', async () => {
			const wrapper = mountCombobox()
			expect(liveRegion(wrapper).text()).toBe('')

			await type(wrapper, 'An')

			expect(liveRegion(wrapper).text()).toBe(ANNOUNCEMENT)
		})

		it('falls silent once the list closes', async () => {
			const wrapper = mountCombobox()
			await type(wrapper, 'An')

			await press(wrapper, 'Escape')

			expect(liveRegion(wrapper).text()).toBe('')
		})
	})
})
```

Create `src/ui/AvCheckbox.spec.ts`:

```ts
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import AvCheckbox from './AvCheckbox.vue'

describe('AvCheckbox', () => {
	it('labels the box and tells screen readers what it is about', () => {
		const wrapper = mount(AvCheckbox, { props: { modelValue: true, label: 'Salvar nos contatos', context: 'Signatário 5' } })
		const box = wrapper.find<HTMLInputElement>('input[type="checkbox"]')
		const label = wrapper.find('label')

		expect(label.attributes('for')).toBe(box.attributes('id'))
		expect(label.text()).toBe('Salvar nos contatos, Signatário 5')
		expect(label.find('.av-visually-hidden').text()).toBe(', Signatário 5')
		expect(box.element.checked).toBe(true)
	})

	it('emits the new state when it is toggled', async () => {
		const wrapper = mount(AvCheckbox, { props: { modelValue: true, label: 'Salvar nos contatos' } })

		await wrapper.find('input').setValue(false)

		expect(wrapper.emitted('update:modelValue')).toEqual([[false]])
	})
})
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/ui/AvCombobox.spec.ts src/ui/AvCheckbox.spec.ts`
Expected: FAIL — both suites cannot resolve `./AvCombobox.vue` / `./AvCheckbox.vue`.

- [ ] **Step 3: Implement the keyboard moves**

Create `src/ui/combobox.ts`:

```ts
/** What every option of a combobox carries: an id unique within its list. */
export interface ComboboxOption {
	id: string
}

/** No option is active: the text box keeps the focus and Enter does nothing. */
export const NO_ACTIVE_OPTION = -1

type ActiveMove = (current: number, count: number) => number

/** The arrow keys move the active option and wrap around (WAI-ARIA APG combobox); Home and End stay with the text. */
export const COMBOBOX_MOVES: Readonly<Record<string, ActiveMove>> = {
	ArrowDown: (current, count) => (current + 1) % count,
	ArrowUp: (current, count) => (current <= 0 ? count - 1 : current - 1),
}
```

- [ ] **Step 4: Implement the combobox**

Create `src/ui/AvCombobox.vue`:

```vue
<script setup lang="ts" generic="Option extends ComboboxOption">
import type { ComboboxOption } from './combobox.ts'

import { computed, ref, useId, useTemplateRef, watch } from 'vue'
import AvField from './AvField.vue'
import { COMBOBOX_MOVES, NO_ACTIVE_OPTION } from './combobox.ts'

const model = defineModel<string>({ required: true })

const props = withDefaults(defineProps<{
	label: string
	labelHidden?: boolean
	type?: 'text' | 'email'
	error?: string | null
	autocomplete?: string
	maxlength?: number
	/** The suggestions for what is typed; the list opens once the user types and there is at least one. */
	options: Option[]
	/** Names the list of suggestions for assistive technology. */
	listLabel: string
	/** Read out politely while the list is open, e.g. how many suggestions there are. */
	announcement: string
}>(), {
	type: 'text',
	error: null,
})

const emit = defineEmits<{ pick: [option: Option] }>()

defineSlots<{
	option(props: { option: Option }): unknown
}>()

const listboxId = `${useId()}-listbox`
const root = useTemplateRef<HTMLElement>('root')
/** Whether the user asked for the list, by typing or with an arrow key; it shows only when there is something to suggest. */
const isRequested = ref(false)
const activeIndex = ref(NO_ACTIVE_OPTION)

const isOpen = computed(() => isRequested.value && props.options.length > 0)
const activeOptionId = computed(() => (isOpen.value && activeIndex.value !== NO_ACTIVE_OPTION ? optionId(activeIndex.value) : undefined))

watch(() => props.options, () => {
	activeIndex.value = NO_ACTIVE_OPTION
})

function optionId(index: number): string {
	return `${listboxId}-option-${index}`
}

function close() {
	isRequested.value = false
	activeIndex.value = NO_ACTIVE_OPTION
}

function pick(option: Option) {
	close()
	emit('pick', option)
}

function onKeydown(event: KeyboardEvent) {
	const move = COMBOBOX_MOVES[event.key]
	if (move !== undefined) {
		event.preventDefault()
		isRequested.value = true
		activeIndex.value = props.options.length === 0 ? NO_ACTIVE_OPTION : move(activeIndex.value, props.options.length)
		return
	}
	if (!isOpen.value) {
		return
	}
	if (event.key === 'Escape') {
		event.preventDefault()
		close()
		return
	}
	const active = props.options[activeIndex.value]
	if (event.key === 'Enter' && active !== undefined) {
		event.preventDefault()
		pick(active)
	}
}

function onFocusOut(event: FocusEvent) {
	if (event.relatedTarget instanceof Node && root.value?.contains(event.relatedTarget)) {
		return
	}
	close()
}
</script>

<template>
	<AvField
		v-slot="{ id, describedBy, invalid }"
		:label="label"
		:labelHidden="labelHidden"
		:error="error">
		<div ref="root" class="av-combobox" @focusout="onFocusOut">
			<input
				:id="id"
				v-model="model"
				class="av-input av-combobox__input"
				:class="{ 'av-combobox__input--invalid': invalid }"
				:type="type"
				role="combobox"
				aria-autocomplete="list"
				:aria-expanded="isOpen ? 'true' : 'false'"
				:aria-controls="listboxId"
				:aria-activedescendant="activeOptionId"
				:autocomplete="autocomplete"
				:maxlength="maxlength"
				:aria-invalid="invalid ? 'true' : undefined"
				:aria-describedby="describedBy"
				@input="isRequested = true"
				@keydown="onKeydown">
			<ul
				v-show="isOpen"
				:id="listboxId"
				role="listbox"
				class="av-combobox__list"
				:aria-label="listLabel">
				<li
					v-for="(option, index) in options"
					:id="optionId(index)"
					:key="option.id"
					role="option"
					class="av-combobox__option"
					:class="{ 'av-combobox__option--active': index === activeIndex }"
					:aria-selected="index === activeIndex ? 'true' : 'false'"
					@mousedown.prevent
					@click="pick(option)">
					<slot name="option" :option="option" />
				</li>
			</ul>
			<p class="av-visually-hidden" aria-live="polite">
				{{ isOpen ? announcement : '' }}
			</p>
		</div>
	</AvField>
</template>

<style scoped>
.av-combobox {
	position: relative;
}

/* The kit's text field (AvTextField): a 44px pill. */
.av-combobox__input {
	box-sizing: border-box;
	width: 100%;
	min-height: var(--av-control-height);
	padding: 0 18px;
	border: 1px solid var(--av-input-border);
	border-radius: var(--av-radius-pill);
	background: var(--av-panel);
	color: var(--av-ink);
	font-family: inherit;
	font-size: var(--av-text-body);
}

.av-combobox__input--invalid {
	border-color: var(--av-danger-text);
}

/* The kit's popover (AvMenu): a white card 8px under the field, wide enough for a name and an email, never wider than a phone. */
.av-combobox__list {
	position: absolute;
	top: calc(100% + var(--av-gutter));
	left: 0;
	z-index: var(--av-layer-popover);
	box-sizing: border-box;
	width: max(100%, 320px);
	max-width: calc(100vw - 2 * var(--av-phone-inset));
	margin: 0;
	padding: 8px;
	border-radius: var(--av-radius-card);
	background: var(--av-panel);
	box-shadow: var(--av-shadow-float);
	list-style: none;
}

.av-combobox__option {
	display: flex;
	align-items: center;
	box-sizing: border-box;
	min-height: var(--av-control-height);
	padding: 6px 12px;
	border-radius: var(--av-radius-tile);
	cursor: pointer;
}

.av-combobox__option:hover {
	background: var(--av-subtle-fill);
}

/* The option the arrow keys reached: filled and ringed like the kit's focus, so it never relies on colour alone. */
.av-combobox__option--active {
	background: var(--av-subtle-fill);
	outline: 2px solid var(--av-brand);
	outline-offset: -2px;
}
</style>
```

- [ ] **Step 5: Implement the checkbox**

Create `src/ui/AvCheckbox.vue` (keep the `<label>` content on one line: a line break before the `<span>` would put a space before the comma):

```vue
<script setup lang="ts">
import { useId } from 'vue'

const model = defineModel<boolean>({ required: true })

defineProps<{
	label: string
	/** Read after the label by screen readers only, e.g. which signer a row's box is about. */
	context?: string
}>()

const id = useId()
</script>

<template>
	<span class="av-checkbox">
		<input
			:id="id"
			v-model="model"
			type="checkbox"
			class="av-input av-checkbox__box">
		<label :for="id" class="av-checkbox__label">{{ label }}<span v-if="context !== undefined" class="av-visually-hidden">, {{ context }}</span></label>
	</span>
</template>

<style scoped>
/* A 44px row: the label is part of the touch target. */
.av-checkbox {
	display: inline-flex;
	align-items: center;
	gap: 10px;
	min-height: var(--av-control-height);
}

.av-checkbox__box {
	flex-shrink: 0;
	width: 18px;
	height: 18px;
	margin: 0;
	padding: 0;
	accent-color: var(--av-action);
	cursor: pointer;
}

.av-checkbox__label {
	color: var(--av-ink);
	font-size: var(--av-text-small);
	cursor: pointer;
}
</style>
```

- [ ] **Step 6: Run the specs to see them pass**

Run: `npx vitest run src/ui/AvCombobox.spec.ts src/ui/AvCheckbox.spec.ts`
Expected: `Test Files  2 passed`, `Tests  17 passed`.

- [ ] **Step 7: Run the gates**

```bash
npm run typecheck
npm run lint
npm test
npm run build
```
Expected: each exits 0.

- [ ] **Step 8: Commit**

```bash
git add src/ui/combobox.ts src/ui/AvCombobox.vue src/ui/AvCombobox.spec.ts src/ui/AvCheckbox.vue src/ui/AvCheckbox.spec.ts js css
git commit -m "feat(ui): add a combobox and a checkbox to the kit"
```

---

### Task 9: Suggest signers and offer to save new ones to contacts

**Files:**
- Create: `src/wizard/signer-suggestions.ts`, `src/wizard/SignerSuggestionOption.vue`
- Modify: `src/wizard/SignerFormRow.vue` (full replacement below), `src/wizard/SignersStep.vue` (template)
- Modify: `l10n/pt_BR.json`, `l10n/pt_BR.js`
- Modify: `src/wizard/DocumentsStep.spec.ts`, `src/wizard/WizardView.spec.ts`, `src/wizard/ReviewStep.spec.ts`, `src/placement/PlacementStep.spec.ts`, `src/placement/PlacementStepPhone.spec.ts` (mock the suggestions request)
- Test: `src/wizard/signer-suggestions.spec.ts`, `src/wizard/SignersStep.spec.ts`

**Interfaces:**
- Consumes: `signerSuggestionsQueryOptions`, `isSuggestionQuery` (Task 6); `looksLikeEmail`, `SignerDraft.saveToContacts` (Task 7); `AvCombobox`, `AvCheckbox` (Task 8); `useDebounced` (`src/presentation/use-debounced.ts`); `isCancelled` (`src/api/api-error.ts`).
- Produces: `SUGGESTION_DEBOUNCE_MILLISECONDS = 250`; `SuggestionOption = SignerSuggestion & { id: string }`; `suggestionSourceLabel(source)`; `suggestionQuery(text)`; `offersSavingToContacts(email, found)`; `useSignerSuggestions(text: Ref<string>): { suggestions: ComputedRef<SuggestionOption[]> }`; `useContactLookup(email: Ref<string>): { offersSaving: ComputedRef<boolean> }`; `SignerFormRow` model `v-model:saveToContacts`.

- [ ] **Step 1: Write the failing specs**

Create `src/wizard/signer-suggestions.spec.ts`:

```ts
import type { SignerSuggestions } from '../api/types.ts'

import { describe, expect, it } from 'vitest'
import { usePortugueseEnvironment } from '../test-support/pt-br-environment.ts'
import { offersSavingToContacts, suggestionQuery, suggestionSourceLabel } from './signer-suggestions.ts'

usePortugueseEnvironment()

const ANA_IS_KNOWN: SignerSuggestions = { suggestions: [{ name: 'Ana Lima', email: 'ana@exemplo.com.br', source: 'contact' }], canSaveContacts: true }

describe('suggestionQuery', () => {
	it('drops the spaces around the text and lowers its case, so equal searches share an answer', () => {
		expect(suggestionQuery('  Ana LIMA ')).toBe('ana lima')
	})
})

describe('offersSavingToContacts', () => {
	it('offers an email nobody has yet', () => {
		expect(offersSavingToContacts('eva@exemplo.com.br', ANA_IS_KNOWN)).toBe(true)
	})

	it('does not offer an email found among the contacts or the users', () => {
		expect(offersSavingToContacts('ana@exemplo.com.br', ANA_IS_KNOWN)).toBe(false)
	})

	it('does not offer anything while the answer is unknown', () => {
		expect(offersSavingToContacts('eva@exemplo.com.br', undefined)).toBe(false)
	})

	it('does not offer anything when the user has no address book to save to', () => {
		expect(offersSavingToContacts('eva@exemplo.com.br', { ...ANA_IS_KNOWN, canSaveContacts: false })).toBe(false)
	})
})

describe('suggestionSourceLabel', () => {
	it('names where a suggestion comes from', () => {
		expect(suggestionSourceLabel('contact')).toBe('Contato')
		expect(suggestionSourceLabel('user')).toBe('Usuário')
	})
})
```

In `src/wizard/SignersStep.spec.ts`:

1. Add the imports:
```ts
import type { SignerSuggestion, SignerSuggestions } from '../api/types.ts'
import { searchSignerSuggestions } from '../api/signer-suggestions.ts'
import { SUGGESTION_DEBOUNCE_MILLISECONDS } from './signer-suggestions.ts'
```
2. After the `vi.mock(import('../api/envelopes.ts'), …)` block, add:
```ts
vi.mock('../api/signer-suggestions.ts', () => ({ searchSignerSuggestions: vi.fn() }))
```
3. After `const MILLISECONDS_PER_SECOND = 1000`, add:
```ts
const NOTHING_FOUND: SignerSuggestions = { suggestions: [], canSaveContacts: false }
const DIEGO_USER: SignerSuggestion = { name: 'Diego Ramos', email: 'diego.ramos@exemplo.com.br', source: 'user' }
const DIEGO_CONTACT: SignerSuggestion = { name: 'Diego Costa', email: 'diego.costa@exemplo.com.br', source: 'contact' }
```
4. In the top-level `beforeEach`, add:
```ts
	vi.mocked(searchSignerSuggestions).mockReset()
	vi.mocked(searchSignerSuggestions).mockResolvedValue(NOTHING_FOUND)
```
5. After the `mountStepFromDocuments()` helper, add:
```ts
async function typeAndPause(input: DOMWrapper<HTMLInputElement>, text: string) {
	await input.setValue(text)
	await vi.advanceTimersByTimeAsync(SUGGESTION_DEBOUNCE_MILLISECONDS)
	await settle()
}

function askedQueries(): string[] {
	return vi.mocked(searchSignerSuggestions).mock.calls.map(([query]) => query)
}

function suggestionOptions(wrapper: VueWrapper) {
	return wrapper.findAll('[role="option"]')
}

function contactBox(wrapper: VueWrapper, number: number): DOMWrapper<HTMLInputElement> | undefined {
	const label = wrapper.findAll('label').find((candidate) => candidate.text() === `Salvar nos contatos, Signatário ${number}`)
	return label === undefined ? undefined : wrapper.find<HTMLInputElement>(`#${label.attributes('for')}`)
}

async function addSigner(wrapper: VueWrapper, name: string, email: string) {
	await buttonNamed(wrapper, 'Adicionar signatário')?.trigger('click')
	await settle()
	await field(wrapper, 'Nome do signatário 5').setValue(name)
	await typeAndPause(field(wrapper, 'E-mail do signatário 5'), email)
}
```
6. At the end of the top-level `describe('the signers step', …)` block, add:
```ts
	describe('suggestions', () => {
		beforeEach(() => {
			vi.mocked(searchSignerSuggestions).mockResolvedValue({ suggestions: [DIEGO_USER, DIEGO_CONTACT], canSaveContacts: true })
		})

		it('asks for people from the second character typed', async () => {
			const { wrapper } = await mountStep()
			const name = field(wrapper, 'Nome do signatário 4')

			await typeAndPause(name, 'D')
			expect(askedQueries()).not.toContain('d')
			expect(suggestionOptions(wrapper)).toHaveLength(0)

			await typeAndPause(name, 'Di')
			expect(askedQueries()).toContain('di')
			expect(name.attributes('aria-expanded')).toBe('true')
		})

		it('asks only once typing pauses', async () => {
			const { wrapper } = await mountStep()
			const name = field(wrapper, 'Nome do signatário 4')

			await name.setValue('Di')
			await vi.advanceTimersByTimeAsync(SUGGESTION_DEBOUNCE_MILLISECONDS - 1)
			await typeAndPause(name, 'Die')

			expect(askedQueries()).toContain('die')
			expect(askedQueries()).not.toContain('di')
		})

		it('shows each person with their email and where they come from', async () => {
			const { wrapper } = await mountStep()

			await typeAndPause(field(wrapper, 'Nome do signatário 4'), 'Di')

			const [user, contact] = suggestionOptions(wrapper)
			expect(user?.text()).toContain('Diego Ramos')
			expect(user?.text()).toContain('diego.ramos@exemplo.com.br')
			expect(user?.text()).toContain('Usuário')
			expect(contact?.text()).toContain('Diego Costa')
			expect(contact?.text()).toContain('Contato')
		})

		it('announces how many people it suggests', async () => {
			const { wrapper } = await mountStep()

			await typeAndPause(field(wrapper, 'Nome do signatário 4'), 'Di')

			expect(wrapper.findAll('[aria-live="polite"]').map((region) => region.text())).toContain('2 sugestões')
		})

		it('fills the name and the email with the person picked by keyboard', async () => {
			const { wrapper } = await mountStep()
			const name = field(wrapper, 'Nome do signatário 4')
			await typeAndPause(name, 'Di')

			await name.trigger('keydown', { key: 'ArrowDown' })
			await name.trigger('keydown', { key: 'Enter' })
			await settle()

			expect(field(wrapper, 'Nome do signatário 4').element.value).toBe('Diego Ramos')
			expect(field(wrapper, 'E-mail do signatário 4').element.value).toBe('diego.ramos@exemplo.com.br')
		})

		it('fills both fields with the person picked from the email field', async () => {
			const { wrapper } = await mountStep()
			await typeAndPause(field(wrapper, 'E-mail do signatário 4'), 'diego')

			await suggestionOptions(wrapper)[1]?.trigger('click')
			await settle()

			expect(field(wrapper, 'Nome do signatário 4').element.value).toBe('Diego Costa')
			expect(field(wrapper, 'E-mail do signatário 4').element.value).toBe('diego.costa@exemplo.com.br')
		})

		it('still asks for a surname when the picked person has a one-word name', async () => {
			vi.mocked(searchSignerSuggestions).mockResolvedValue({ suggestions: [{ name: 'Diego', email: 'diego.solo@exemplo.com.br', source: 'contact' }], canSaveContacts: true })
			const { wrapper, router } = await mountStep()
			const name = field(wrapper, 'Nome do signatário 4')
			await typeAndPause(name, 'Di')
			await name.trigger('keydown', { key: 'ArrowDown' })
			await name.trigger('keydown', { key: 'Enter' })

			await continueToNextStep(wrapper)

			expect(currentStep(router)).toBe('signers')
			expect(errorOf(wrapper, 'Nome do signatário 4')).toBe('Informe nome e sobrenome.')
		})
	})

	describe('saving a new signer to contacts', () => {
		it('offers it, ticked, for an email in none of the address books', async () => {
			vi.mocked(searchSignerSuggestions).mockResolvedValue({ suggestions: [], canSaveContacts: true })
			const { wrapper } = await mountStep()

			await addSigner(wrapper, 'Eva Rocha', 'eva@exemplo.com.br')

			expect(contactBox(wrapper, 5)?.element.checked).toBe(true)
		})

		it('does not offer it for an email the user already has', async () => {
			vi.mocked(searchSignerSuggestions).mockResolvedValue({ suggestions: [{ name: 'Eva Rocha', email: 'eva@exemplo.com.br', source: 'contact' }], canSaveContacts: true })
			const { wrapper } = await mountStep()

			await addSigner(wrapper, 'Eva Rocha', 'eva@exemplo.com.br')

			expect(contactBox(wrapper, 5)).toBeUndefined()
		})

		it('does not offer it without an address book to save to', async () => {
			const { wrapper } = await mountStep()

			await addSigner(wrapper, 'Eva Rocha', 'eva@exemplo.com.br')

			expect(contactBox(wrapper, 5)).toBeUndefined()
		})

		it('does not offer it before the email is complete', async () => {
			vi.mocked(searchSignerSuggestions).mockResolvedValue({ suggestions: [], canSaveContacts: true })
			const { wrapper } = await mountStep()

			await addSigner(wrapper, 'Eva Rocha', 'eva@exemplo')

			expect(contactBox(wrapper, 5)).toBeUndefined()
		})

		it('saves the choice with the signer', async () => {
			vi.mocked(searchSignerSuggestions).mockResolvedValue({ suggestions: [], canSaveContacts: true })
			const { wrapper } = await mountStep()
			await addSigner(wrapper, 'Eva Rocha', 'eva@exemplo.com.br')

			await contactBox(wrapper, 5)?.setValue(false)
			await continueToNextStep(wrapper)

			expect(replaceSigners).toHaveBeenCalledWith(DRAFT_UUID, expect.arrayContaining([{ name: 'Eva Rocha', email: 'eva@exemplo.com.br', orderGroup: 2, saveToContacts: false }]))
		})

		it('saves a changed choice without asking about the placed boxes', async () => {
			vi.mocked(getEnvelope).mockResolvedValue(orderedEnvelope({ signers: ARTBOARD_SIGNERS.map((signer) => ({ ...signer, saveToContacts: true })), documents: DOCUMENTS_WITH_BOXES }))
			vi.mocked(searchSignerSuggestions).mockResolvedValue({ suggestions: [], canSaveContacts: true })
			const { wrapper, router } = await mountStep()
			await vi.advanceTimersByTimeAsync(SUGGESTION_DEBOUNCE_MILLISECONDS)
			await settle()

			await contactBox(wrapper, 1)?.setValue(false)
			await continueToNextStep(wrapper)

			expect(dialog(wrapper).exists()).toBe(false)
			expect(replaceSigners).toHaveBeenCalledWith(DRAFT_UUID, expect.arrayContaining([{ name: 'Ana Lima', email: 'ana.lima@exemplo.com.br', orderGroup: 1, saveToContacts: false }]))
			expect(currentStep(router)).toBe('placement')
		})
	})
```

In each of `src/wizard/DocumentsStep.spec.ts`, `src/wizard/WizardView.spec.ts`, `src/wizard/ReviewStep.spec.ts`, `src/placement/PlacementStep.spec.ts` and `src/placement/PlacementStepPhone.spec.ts`, after their `vi.mock(import('../api/envelopes.ts'), …)` block (or, if a file has none, after its last top-level `vi.mock(…)`), add:

```ts
/** The signers step looks each email up; these specs are not about that. */
vi.mock('../api/signer-suggestions.ts', () => ({ searchSignerSuggestions: vi.fn(async () => ({ suggestions: [], canSaveContacts: false })) }))
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/wizard/signer-suggestions.spec.ts src/wizard/SignersStep.spec.ts`
Expected: FAIL — `signer-suggestions.spec.ts` cannot resolve `./signer-suggestions.ts`; `SignersStep.spec.ts` fails to import `./signer-suggestions.ts` too (module not found), so its whole suite errors.

- [ ] **Step 3: Add the translations**

In `l10n/pt_BR.json`, add a comma after the last entry of `"translations"` and then these entries before the closing `}`:

```json
    "Save to contacts" : "Salvar nos contatos",
    "Contact" : "Contato",
    "User" : "Usuário",
    "Suggestions" : "Sugestões",
    "_%n suggestion_::_%n suggestions_" : ["%n sugestão","%n sugestões"]
```

Make the same change in `l10n/pt_BR.js` (inside the `OC.L10N.register("assinaturas", { … }, …)` object), with the same five lines.

- [ ] **Step 4: Implement the suggestion logic**

Create `src/wizard/signer-suggestions.ts`:

```ts
import type { ComputedRef, Ref } from 'vue'
import type { SignerSuggestion, SignerSuggestions, SignerSuggestionSource } from '../api/types.ts'

import { t } from '@nextcloud/l10n'
import { keepPreviousData, useQuery } from '@tanstack/vue-query'
import { computed, watch } from 'vue'
import { isCancelled } from '../api/api-error.ts'
import { isSuggestionQuery, signerSuggestionsQueryOptions } from '../api/signer-suggestions-query.ts'
import { APP_ID } from '../app-config.ts'
import { logger } from '../logger.ts'
import { useDebounced } from '../presentation/use-debounced.ts'
import { looksLikeEmail } from './signer-form.ts'

/** Typing pauses this long before people are asked for. */
export const SUGGESTION_DEBOUNCE_MILLISECONDS = 250

/** A suggestion as the combobox lists it; the server answers one entry per email. */
export type SuggestionOption = SignerSuggestion & { id: string }

const SOURCE_LABELS: Readonly<Record<SignerSuggestionSource, () => string>> = {
	contact: () => t(APP_ID, 'Contact'),
	user: () => t(APP_ID, 'User'),
}

export function suggestionSourceLabel(source: SignerSuggestionSource): string {
	return SOURCE_LABELS[source]()
}

/** What the server is asked for: the text without the spaces around it, in lower case, so equal searches share an answer. */
export function suggestionQuery(text: string): string {
	return text.trim().toLowerCase()
}

/** "Salvar nos contatos" shows once the server said the email is in none of the user's address books and no user has it. */
export function offersSavingToContacts(email: string, found: SignerSuggestions | undefined): boolean {
	if (found === undefined || !found.canSaveContacts) {
		return false
	}
	return !found.suggestions.some((suggestion) => suggestion.email === email)
}

/** A failed search shows no suggestions; it is logged without the query, which may hold a name or an email. */
function logFailure(error: Error | null) {
	if (error === null || isCancelled(error)) {
		return
	}
	logger.warn('Could not load signer suggestions', { error })
}

/** The people matching `text` once typing pauses; a request for text the user typed past is aborted. */
export function useSignerSuggestions(text: Ref<string>): { suggestions: ComputedRef<SuggestionOption[]> } {
	const query = useDebounced(computed(() => suggestionQuery(text.value)), SUGGESTION_DEBOUNCE_MILLISECONDS)
	const found = useQuery(() => ({ ...signerSuggestionsQueryOptions(query.value), placeholderData: keepPreviousData }))
	watch(found.error, logFailure)
	const suggestions = computed<SuggestionOption[]>(() => (isSuggestionQuery(query.value)
		? (found.data.value?.suggestions ?? []).map((suggestion) => ({ ...suggestion, id: suggestion.email }))
		: []))
	return { suggestions }
}

/** Whether to offer saving the typed email to the contacts; looked up once it reads as a whole address. */
export function useContactLookup(email: Ref<string>): { offersSaving: ComputedRef<boolean> } {
	const query = useDebounced(computed(() => (looksLikeEmail(email.value) ? suggestionQuery(email.value) : '')), SUGGESTION_DEBOUNCE_MILLISECONDS)
	const found = useQuery(() => signerSuggestionsQueryOptions(query.value))
	watch(found.error, logFailure)
	const offersSaving = computed(() => isSuggestionQuery(query.value) && offersSavingToContacts(query.value, found.data.value))
	return { offersSaving }
}
```

- [ ] **Step 5: Render one suggestion**

Create `src/wizard/SignerSuggestionOption.vue`:

```vue
<script lang="ts">
/** The kit's 32px avatar keeps the option row within the 44px touch target. */
const AVATAR_SIZE = 32
</script>

<script setup lang="ts">
import type { SuggestionOption } from './signer-suggestions.ts'

import AvAvatar from '../ui/AvAvatar.vue'
import { suggestionSourceLabel } from './signer-suggestions.ts'

defineProps<{
	suggestion: SuggestionOption
}>()
</script>

<template>
	<span class="signer-suggestion">
		<AvAvatar :name="suggestion.name" :size="AVATAR_SIZE" decorative />
		<span class="signer-suggestion__text">
			<span class="signer-suggestion__name">{{ suggestion.name }}</span>
			<span class="signer-suggestion__email">{{ suggestion.email }}</span>
		</span>
		<span class="signer-suggestion__source">{{ suggestionSourceLabel(suggestion.source) }}</span>
	</span>
</template>

<style scoped>
.signer-suggestion {
	display: flex;
	align-items: center;
	gap: 12px;
	width: 100%;
	min-width: 0;
}

.signer-suggestion__text {
	display: flex;
	flex: 1;
	flex-direction: column;
	min-width: 0;
}

.signer-suggestion__name,
.signer-suggestion__email {
	display: block;
	overflow: hidden;
	white-space: nowrap;
	text-overflow: ellipsis;
}

.signer-suggestion__name {
	color: var(--av-ink);
	font-size: var(--av-text-body);
}

.signer-suggestion__email {
	color: var(--av-muted);
	font-size: var(--av-text-meta);
}

.signer-suggestion__source {
	flex-shrink: 0;
	color: var(--av-muted);
	font-size: var(--av-text-caption);
}
</style>
```

- [ ] **Step 6: Turn the row's fields into comboboxes with the checkbox**

Replace the whole of `src/wizard/SignerFormRow.vue` with:

```vue
<script setup lang="ts">
import type { SuggestionOption } from './signer-suggestions.ts'

import { n, t } from '@nextcloud/l10n'
import { X } from 'lucide-vue-next'
import { computed, ref, useId } from 'vue'
import AvAvatar from '../ui/AvAvatar.vue'
import AvCheckbox from '../ui/AvCheckbox.vue'
import AvCombobox from '../ui/AvCombobox.vue'
import AvIconButton from '../ui/AvIconButton.vue'
import AvSelect from '../ui/AvSelect.vue'
import SignerSuggestionOption from './SignerSuggestionOption.vue'
import { APP_ID } from '../app-config.ts'
import { ICON_SIZE_INLINE, ICON_STROKE_EMPHASIS } from '../icon-sizes.ts'
import { PLAIN_TEXT } from '../presentation/plain-text.ts'
import { FIRST_GROUP, signerColumns } from './signer-form.ts'
import { useContactLookup, useSignerSuggestions } from './signer-suggestions.ts'

export type SignerField = 'name' | 'email'

const name = defineModel<string>('name', { required: true })
const email = defineModel<string>('email', { required: true })
/** Add the signer to the owner's contacts once the envelope is sent; offered only for an email nobody has yet. */
const saveToContacts = defineModel<boolean>('saveToContacts', { required: true })

const props = defineProps<{
	rowKey: string
	/** The row's position on screen, from 1. */
	number: number
	color: number
	orderGroup: number
	groupCount: number
	isOrdered: boolean
	isOnlyRow: boolean
	isPhone: boolean
	nameMaxLength: number
	nameError: string | null
	emailError: string | null
}>()

const emit = defineEmits<{
	'update:orderGroup': [orderGroup: number]
	leave: [field: SignerField]
	remove: []
}>()

/** The avatar's size in Wizard-Signers.dc.html (line 228: 36px, 14px initials). */
const AVATAR_SIZE = 36

const titleId = useId()
const columns = computed(() => signerColumns(props.isOrdered))

const signerTitle = computed(() => t(APP_ID, 'Signer {number}', { number: props.number }, undefined, PLAIN_TEXT))
const signerName = computed(() => (name.value.trim() === '' ? signerTitle.value : name.value.trim()))

const nameLabel = computed(() => (props.isPhone ? t(APP_ID, 'Name') : t(APP_ID, 'Name of signer {number}', { number: props.number }, undefined, PLAIN_TEXT)))
const emailLabel = computed(() => (props.isPhone ? t(APP_ID, 'Email') : t(APP_ID, 'Email of signer {number}', { number: props.number }, undefined, PLAIN_TEXT)))
const groupLabel = computed(() => (props.isPhone ? t(APP_ID, 'Group') : t(APP_ID, 'Group of {name}', { name: signerName.value }, undefined, PLAIN_TEXT)))

/** Every group there is, then "New group", which opens one after the last. */
const groupOptions = computed(() => [
	...Array.from({ length: props.groupCount }, (_, index) => ({ value: String(index + FIRST_GROUP), label: t(APP_ID, 'Group {group}', { group: index + FIRST_GROUP }) })),
	{ value: String(props.groupCount + FIRST_GROUP), label: t(APP_ID, 'New group') },
])

/** The field the user is typing in: what it holds is what the suggestions match. Null while neither is being typed in. */
const searchedField = ref<SignerField | null>(null)
const fieldTexts = { name, email }
const searchedText = computed(() => (searchedField.value === null ? '' : fieldTexts[searchedField.value].value))
const { suggestions } = useSignerSuggestions(searchedText)
const { offersSaving } = useContactLookup(email)
const nameSuggestions = computed(() => (searchedField.value === 'name' ? suggestions.value : []))
const emailSuggestions = computed(() => (searchedField.value === 'email' ? suggestions.value : []))
const suggestionsAnnouncement = computed(() => n(APP_ID, '%n suggestion', '%n suggestions', suggestions.value.length))

function onGroupChange(value: string) {
	emit('update:orderGroup', Number(value))
}

function onLeave(field: SignerField) {
	searchedField.value = null
	emit('leave', field)
}

/** A picked person fills both fields; the name rule still applies, so a one-word name asks for the surname. */
function onPick(suggestion: SuggestionOption) {
	searchedField.value = null
	name.value = suggestion.name
	email.value = suggestion.email
}
</script>

<template>
	<div
		class="signer-form-row"
		:class="{ 'signer-form-row--ordered': isOrdered, 'signer-form-row--phone': isPhone }"
		:role="isPhone ? 'group' : undefined"
		:aria-labelledby="isPhone ? titleId : undefined"
		:data-signer-row="rowKey">
		<span class="signer-form-row__avatar">
			<AvAvatar
				:name="name"
				:color="color"
				:size="AVATAR_SIZE"
				decorative />
		</span>
		<span v-if="isPhone" :id="titleId" class="signer-form-row__title">{{ signerTitle }}</span>
		<AvCombobox
			v-model="name"
			class="signer-form-row__name"
			:label="nameLabel"
			:labelHidden="!isPhone"
			:maxlength="nameMaxLength"
			:error="nameError"
			autocomplete="off"
			:options="nameSuggestions"
			:listLabel="t(APP_ID, 'Suggestions')"
			:announcement="suggestionsAnnouncement"
			@input="searchedField = 'name'"
			@focusout="onLeave('name')"
			@pick="onPick">
			<template #option="{ option }">
				<SignerSuggestionOption :suggestion="option" />
			</template>
		</AvCombobox>
		<div class="signer-form-row__email">
			<AvCombobox
				v-model="email"
				class="signer-form-row__email-field"
				type="email"
				:label="emailLabel"
				:labelHidden="!isPhone"
				:error="emailError"
				autocomplete="off"
				:options="emailSuggestions"
				:listLabel="t(APP_ID, 'Suggestions')"
				:announcement="suggestionsAnnouncement"
				@input="searchedField = 'email'"
				@focusout="onLeave('email')"
				@pick="onPick">
				<template #option="{ option }">
					<SignerSuggestionOption :suggestion="option" />
				</template>
			</AvCombobox>
			<AvCheckbox
				v-if="offersSaving"
				v-model="saveToContacts"
				class="signer-form-row__contact"
				:label="t(APP_ID, 'Save to contacts')"
				:context="signerTitle" />
		</div>
		<AvSelect
			v-if="isOrdered"
			class="signer-form-row__group"
			:modelValue="String(orderGroup)"
			:label="groupLabel"
			:labelHidden="!isPhone"
			:options="groupOptions"
			@update:modelValue="onGroupChange" />
		<AvIconButton
			class="signer-form-row__remove"
			:label="t(APP_ID, 'Remove {name}', { name: signerName }, undefined, PLAIN_TEXT)"
			data-remove
			:aria-disabled="isOnlyRow ? 'true' : undefined"
			:title="isOnlyRow ? t(APP_ID, 'An envelope needs at least one signer') : undefined"
			@click="emit('remove')">
			<X :size="ICON_SIZE_INLINE" :stroke-width="ICON_STROKE_EMPHASIS" aria-hidden="true" />
		</AvIconButton>
	</div>
</template>

<style scoped>
/*
 * Wizard-Signers.dc.html lines 73-157: avatar, name, email, group and remove in one 44px row. A problem sits under its
 * field, 6px below it (line 143), and the other cells keep to the 44px line above it.
 */
.signer-form-row {
	display: grid;
	grid-template-columns: v-bind(columns);
	grid-template-areas: 'avatar name email remove';
	align-items: start;
	gap: 12px;
}

.signer-form-row--ordered {
	grid-template-areas: 'avatar name email group remove';
}

.signer-form-row__avatar {
	display: flex;
	grid-area: avatar;
	align-items: center;
	height: var(--av-control-height);
}

.signer-form-row__name {
	grid-area: name;
}

/* The email field, with "Salvar nos contatos" under it when it is offered (no artboard draws it). */
.signer-form-row__email {
	display: flex;
	grid-area: email;
	flex-direction: column;
	gap: 4px;
	min-width: 0;
}

/* Inset like the text inside the field above it. */
.signer-form-row__contact {
	padding-left: 18px;
}

.signer-form-row__group {
	grid-area: group;
}

.signer-form-row__remove {
	grid-area: remove;
}

.signer-form-row:not(.signer-form-row--phone) .signer-form-row__name,
.signer-form-row:not(.signer-form-row--phone) .signer-form-row__email-field {
	gap: 6px;
}

/*
 * Phone: no artboard draws this step. Each signer is a card of stacked fields, as the signer cards of
 * Phone-Detail.dc.html (lines 56-103: 20px radius, 14px 18px padding), outlined because the wizard's phone page is white.
 */
.signer-form-row--phone,
.signer-form-row--phone.signer-form-row--ordered {
	grid-template-columns: 36px minmax(0, 1fr) 44px;
	grid-template-areas:
		'avatar title remove'
		'name name name'
		'email email email'
		'group group group';
	align-items: center;
	padding: 14px 18px;
	border: 1px solid var(--av-hairline);
	border-radius: var(--av-radius-card);
}

.signer-form-row__title {
	grid-area: title;
	overflow: hidden;
	font-size: var(--av-text-body);
	white-space: nowrap;
	text-overflow: ellipsis;
}
</style>
```

- [ ] **Step 7: Bind the choice in the step**

In `src/wizard/SignersStep.vue`, in the `<SignerFormRow …>` element, after `v-model:email="row.draft.email"`, add:

```html
					v-model:saveToContacts="row.draft.saveToContacts"
```

- [ ] **Step 8: Run the specs to see them pass**

Run: `npx vitest run src/wizard/signer-suggestions.spec.ts src/wizard/SignersStep.spec.ts`
Expected: both files pass.

- [ ] **Step 9: Run the gates**

```bash
npm run typecheck
npm run lint
npm test
npm run build
```
Expected: each exits 0; `npm test` includes `src/l10n.spec.ts` (every new string translated in both files, no "ZapSign" anywhere).

- [ ] **Step 10: Commit**

```bash
git add src/wizard/signer-suggestions.ts src/wizard/signer-suggestions.spec.ts src/wizard/SignerSuggestionOption.vue src/wizard/SignerFormRow.vue src/wizard/SignersStep.vue src/wizard/SignersStep.spec.ts src/wizard/DocumentsStep.spec.ts src/wizard/WizardView.spec.ts src/wizard/ReviewStep.spec.ts src/placement/PlacementStep.spec.ts src/placement/PlacementStepPhone.spec.ts l10n/pt_BR.json l10n/pt_BR.js js css
git commit -m "feat(wizard): suggest signers and offer to save new ones to contacts"
```

---

### Task 10: Release 0.5.0

**Files:**
- Modify: `appinfo/info.xml`

**Interfaces:**
- Consumes: everything above.
- Produces: app version `0.5.0` (Nextcloud's `?v=` cache-bust for the new JS; `occ upgrade` sees `Version000500Date20261007000000` as already executed in the test env and runs it on every other instance).

- [ ] **Step 1: Bump the version**

In `appinfo/info.xml`, change `<version>0.4.10</version>` to:

```xml
    <version>0.5.0</version>
```

- [ ] **Step 2: Apply it in the test env**

Check `SAME` (Task 1, Step 2), then:

```bash
tests/env/php.sh occ upgrade
tests/env/php.sh occ app:list | grep -E 'assinaturas|contacts:'
```
Expected: the upgrade ends with `Update successful` (use the stale-bundled-apps fallback of Task 1, Step 2 if it complains); the list shows `assinaturas: 0.5.0` and `contacts: …` under *Enabled*.

- [ ] **Step 3: Run every gate, each on its own**

```bash
npm run typecheck
npm run lint
npm test
npm run build
composer run lint
tests/env/phpunit.sh
```
Expected: each exits 0. PHPUnit ends with `OK (… tests, …)` and no warnings, deprecations or risky tests. `git status --short` after the build shows no change under `js/` or `css/` (they were committed with Task 9); if it does, add them to this commit.

- [ ] **Step 4: Check nothing is left running**

```bash
docker ps --format '{{.Names}}' | grep -c phpunit || true
pgrep -f vitest || true
```
Expected: `0` and no process id.

- [ ] **Step 5: Commit**

```bash
git add appinfo/info.xml
git commit -m "chore: release 0.5.0"
```

- [ ] **Step 6: Hand over for staging (the controller does this, not the implementer)**

The controller pins the app submodule in avuz-server, builds `:staging-2`, deploys to conecta-2 (sandbox) and checks by hand:

1. As a member of `assinaturas` (and as an admin): in Novo envelope → Signatários, typing 2+ characters of a name or an email lists people with an initials avatar, name, email and "Contato"/"Usuário"; 1 character lists nothing; a contact shared by another user and the system address book never appear.
2. Keyboard only: ↓/↑ move (wrapping), Enter fills name **and** email, Esc closes, Tab leaves; the active option has a visible ring. VoiceOver (Safari) reads the field as a combo box, "N sugestões" when the list opens, and the active option.
3. A new, unknown email shows "Salvar nos contatos", ticked; an email of an existing contact or of a user never shows it; picking a suggestion hides it; a user with the Contacts app disabled sees no box and only users in the list.
4. Placing boxes, coming back to Signatários and unticking a box does **not** ask "Alterar signatários?" and the boxes stay; changing a name still asks.
5. Send (sandbox): the ticked new signer appears in Contatos → "Contatos" with name and email; an unticked one does not; a signer already in any of the owner's address books is not duplicated; the envelope is `pending` in every case.
6. `nextcloud.log` after the send and after a deliberately failing save (e.g. owner without any address book is silent; a CardDAV failure shows only the envelope uuid): no signer name, email or search text in any log line. In the browser's network panel the only request carrying a name or email is `GET …/signer-suggestions?q=…`, sent once typing pauses (250 ms), with stale ones cancelled.
7. 1440×900 and 390×844: the list sits under the field and fits the phone width; the checkbox row is 44px tall and does not push the remove button out of line on desktop.
8. No screen, toast or option names ZapSign.

---

## Self-review (done while writing)

**Spec coverage**

| Spec requirement | Task |
|---|---|
| Name and email fields suggest from 2 characters | 6 (`enabled`, `MIN_SUGGESTION_QUERY_LENGTH`), 9 |
| Sources: own address books + instance users with email; no system/shared books | 3 (`OwnAddressBooks`), 4 (tests `testLeavesOutAddressBooksOthersShareWithTheUser`, users with email) |
| `GET /api/v1/signer-suggestions?q=`, 403 for non-users | 4 |
| Search on `FN` and `EMAIL` through the contacts API | 4 (`IAddressBook::search`, decision 1) |
| ≤10 results `{name, email, source}`, dedup by email (user wins), no-email dropped, `q` < 2 → empty without searching | 4 |
| Avatar, name, email, "Contato"/"Usuário" | 9 (`SignerSuggestionOption`) |
| Picking fills both; one-word name still shows "Informe nome e sobrenome." | 9 (specs) |
| ARIA combobox, arrows, Enter, Esc, polite count, `aria-activedescendant` | 8, 9 |
| Debounce 250 ms named constant, cancel stale, cache per query | 6, 9 |
| Checkbox for unknown email, checked by default; never for contacts/users/existing | 7 (default), 9 (visibility), 5 (server skip) |
| Choice stored with the draft signer (`save_to_contacts`) | 1, 2, 7 |
| Contact created on successful send in default writable book; existing → nothing | 5 |
| Save failure never blocks/undoes the send; warning with envelope id only | 5 |
| Contacts app off / no writable book → no checkbox, users only | 3, 4, 5, 9 |
| White label | Global constraints; `src/l10n.spec.ts` in Task 9 gates |
| PHP and Vitest test lists of the spec | 1–5, 6–9 |

**Placeholder scan:** no TBD/TODO; every code step carries its code; every command has an expected result.

**Type consistency:** `OwnAddressBooks::of()` / `defaultWritable()` (Task 3) are used with the same signatures in Tasks 4–5; `Signer::savesToContacts()` (Task 1) in Tasks 2 and 5; `SignerSuggestions::MAX_RESULTS` (Task 4) in its test; `searchSignerSuggestions(query, signal)` and `signerSuggestionsQueryOptions(query)` (Task 6) in Task 9; `looksLikeEmail` and `signerIdentitiesChanged(inputs, signers)` (Task 7) in Tasks 7 and 9; `AvCombobox`'s `options`/`listLabel`/`announcement`/`pick` and `AvCheckbox`'s `context` (Task 8) as used in `SignerFormRow.vue` (Task 9).
