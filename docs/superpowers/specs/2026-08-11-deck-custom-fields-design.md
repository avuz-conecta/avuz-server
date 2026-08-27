# Deck Custom Fields Engine — Design (Phase 1)

**Date:** 2026-08-11
**Status:** Approved, ready for implementation plan
**Fork:** `avuz-conecta/deck` (branch `avuz`) at `apps/deck` — target version bump **1.17.1 → 1.17.2**

## Context

Deck is being evolved into a ClickUp-depth product (see memory `deck-product-evolution`).
Driver: client **Raíven** handed a spec replicating their ClickUp — spaces/lists, multi-status
flows, **custom fields**, time tracking, subtasks/templates, grouped views, Excel reports, and
migration. The agreed phase roadmap is keystone-first:

**P1 custom fields → P2 Excel export + indicators → P4 subtasks/templated checklists + templates
→ P3 time tracking → P5 views → P8 ClickUp migration → P7 auto-fill.**

This document specs **P1 only**. Custom fields are the keystone: required fields, Excel reports,
and indicators all depend on them.

Deck natively has stacks, cards, labels, assignees, `duedate`, comments, attachments (plus the
Avuz board-tags feature). It has **no custom fields**. This adds them.

## Goals

- Per-board **custom field definitions** of 7 types, managed in board settings.
- Per-card **values** for those fields, edited in the card detail sidebar.
- **Soft-required** flag: required-but-empty fields show a visual warning; nothing is blocked.
- **Board clone carries field definitions** (and card clone carries values), so a standard field
  set is built once and cloned across unit boards (PEB/PBA/PBL/OMT).
- End-to-end type-safety at the PHP and JS boundaries; full test coverage mirroring the Labels
  feature.

## Non-goals (explicitly deferred to later phases)

- Filtering/grouping cards by field value — **P5 (views)**.
- Showing field values on card mini-tiles — **P5**.
- Hard-required enforcement (block stage-move on empty required) — **P2 companion**.
- Reusable/global field library shared across boards — not planned; clone + templates (P4) cover
  the repetition.
- Auto-fill fields from Raíven's unit database — **P7**.
- Excel export of field values — **P2**.

## Field types (v1 — all seven)

| type | stored `value` | widget | notes |
|---|---|---|---|
| `text` | raw string | text input | single-line |
| `number` | numeric string | number input | optional `decimals` setting |
| `money` | numeric string | number input, R$ prefix | `decimals=2`, currency `BRL`/R$ |
| `dropdown` | option `id` | single-select (NcSelect) | options in `options` json |
| `multi` | JSON array of option `id`s | multi-select (NcSelect) | options in `options` json |
| `date` | ISO 8601 string | date picker | |
| `checkbox` | `"0"` / `"1"` | checkbox | |

`dropdown` and `multi` share the same `options` blob — type decides single vs array.

**Type is immutable after create.** Changing a field's type once values exist would corrupt them,
so `updateField` never changes `type` — only title, options, required. To change a type, delete and
recreate the field.

**`required` semantics per type:** ignored for `checkbox` (a checkbox always has a value, 0 or 1).
`date` is **date-only** (ISO `YYYY-MM-DD`, no time component).

**Option ids** for `dropdown`/`multi` are **server-generated and stable** (minted on create/update,
never reused). Removing an option from a field's list does **not** delete card values that reference
it — those values are kept and rendered as `"(removida)"` in the UI. Never silently drop a filled
value.

**"Status" is not a custom field.** Raíven's card "Status" chip maps to the Deck **stack** (kanban
column) the card sits in — do not build a Status field; it would duplicate the stack.

## Data model

Two new tables. **No foreign-key constraints** (Deck convention — cascade is manual in mappers,
mirroring `deck_assigned_labels`).

### `deck_custom_fields` — definitions (board-scoped)

| column | type | constraints |
|---|---|---|
| `id` | integer | PK, autoincrement |
| `board_id` | bigint(8) | notnull, index `deck_custom_fields_board_idx` |
| `title` | string(255) | notnull |
| `type` | string(20) | notnull; one of the 7 type keys |
| `options` | text | nullable; JSON. For dropdown/multi: `[{"id":"...","label":"...","color":"RRGGBB"}]`. Also holds per-type settings (e.g. `{"decimals":2,"currency":"BRL"}`) |
| `required` | boolean | notnull, default false |
| `order` | integer | notnull, default 0 — display order |
| `last_modified` | integer | nullable |

### `deck_card_custom_field_values` — values (per card+field)

| column | type | constraints |
|---|---|---|
| `id` | integer | PK, autoincrement |
| `card_id` | integer | notnull, index `deck_cfv_card_idx` |
| `field_id` | integer | notnull, index `deck_cfv_field_idx` |
| `value` | text | nullable; string encoding per field type (see table above) |
| *unique* | (`card_id`, `field_id`) | unique index `deck_cfv_card_field_uidx` — one value row per pair |

**Migration:** `lib/Migration/Version11702Date2026MMDDHHMMSS.php`, class matching filename, extends
`SimpleMigrationStep`, guard each `createTable` with `if (!$schema->hasTable(...))`. Use
`OCP\DB\Types`. Next version integer after `Version11701Date20260727120000`.

### Value encoding / type-safety strategy

Store every value as a **string** in one `value` column; never a column-per-type sprawl.
Type-safety lives at two boundaries:

- **PHP:** a `FieldType` map (parse/format/validate per type key) used by the service on write and
  by the value mapper on read. `CustomFieldServiceValidator` rejects malformed input (e.g. a
  `dropdown` value not present in the field's option ids, a non-numeric `number`).
- **JS:** the sidebar input component keys off `field.type` into a widget hash-map that
  parses/formats consistently with the PHP side.

## Backend architecture (mirrors LabelService end to end)

### Db layer
- `lib/Db/CustomField.php` — `RelationalEntity`; props `boardId, title, type, options, required,
  order, lastModified`; `addType('boardId','integer')`, `addType('required','boolean')`,
  `addType('order','integer')`; `options` JSON-encoded/decoded via accessor.
- `lib/Db/CustomFieldValue.php` — `RelationalEntity`; props `cardId, fieldId, value`.
- `lib/Db/CustomFieldMapper.php` — `extends DeckMapper<CustomField> implements IPermissionMapper`,
  table `deck_custom_fields`:
  - `findAll(int $boardId): CustomField[]` — board-scoped, ordered by `order`.
  - `find(int $id): CustomField`
  - `isOwner(string $userId, int $id): bool`, `findBoardId(int $id): ?int` (IPermissionMapper).
  - `delete()` override or service-level cascade → purge values via
    `CustomFieldValueMapper::deleteForField`.
- `lib/Db/CustomFieldValueMapper.php` — table `deck_card_custom_field_values`:
  - `findForCard(int $cardId): CustomFieldValue[]` — the P1 read path (sidebar).
  - `findForCards(int[] $cardIds): CustomFieldValue[]` — batch (IN). **Not used in P1** (values are
    not shown on tiles yet); added for P5 tile display. Do not wire it into the board view now.
  - `setValue(int $cardId, int $fieldId, ?string $value): void` — **app-level** insert-or-update:
    `SELECT` the `(card_id, field_id)` row, then `INSERT` or `UPDATE`. **No DB-native upsert**
    (`ON CONFLICT`/`ON DUPLICATE KEY`) — Deck runs MySQL, Postgres, and SQLite. A null/empty value
    deletes the row.
  - `deleteForField(int $fieldId)`, `deleteForCard(int $cardId)` — manual cascade.

### Service layer
- `lib/Service/CustomFieldService.php`:
  - `create(int $boardId, string $title, string $type, ?array $options, bool $required): CustomField`
    — `permissionService->checkPermission(null, $boardId, Acl::PERMISSION_MANAGE)`, validate,
    archived-board guard, `changeHelper->boardChanged`, insert.
  - `update(int $id, string $title, ?array $options, bool $required): CustomField` — MANAGE.
  - `delete(int $id)` — MANAGE; cascade values.
  - `reorder(int $boardId, int[] $orderedIds)` — MANAGE.
  - `setValue(int $cardId, int $fieldId, ?string $value): CustomFieldValue` — resolve board from
    card, `checkPermission(cardMapper, $cardId, Acl::PERMISSION_EDIT)`, validate value against the
    field's type/options, then `customFieldValueMapper->setValue` (app-level insert/update).
  - `getValues(int $cardId): CustomFieldValue[]` — `PERMISSION_READ`; used by the sidebar-open read.
- `lib/Validators/CustomFieldServiceValidator.php` — `rules()`: `title` required non-empty and
  **unique per board** (case-insensitive, like labels — avoids colliding Excel columns in P2);
  `type` in the 7-key enum; `options` required non-empty when type ∈ {dropdown, multi}; on
  `setValue`, the value must be valid for the field's type (numeric for number/money, a known option
  id for dropdown, an array of known option ids for multi, ISO date for date, 0/1 for checkbox).

### Controller + routes
- `lib/Controller/CustomFieldController.php` — `extends Controller`, `#[NoAdminRequired]` on each
  method; thin pass-through to the service:
  - `createField(int $boardId, string $title, string $type, ?array $options, bool $required)`
  - `updateField(int $fieldId, string $title, ?array $options, bool $required)`
  - `deleteField(int $fieldId)`
  - `reorderFields(int $boardId, array $fieldIds)`
  - `getCardValues(int $cardId)` — returns the card's value rows (sidebar open)
  - `setCardValue(int $cardId, int $fieldId, ?string $value)`
- `appinfo/routes.php` — web routes:
  - `POST   /boards/{boardId}/custom-fields`            → `custom_field#createField`
  - `PUT    /custom-fields/{fieldId}`                   → `custom_field#updateField`
  - `DELETE /custom-fields/{fieldId}`                   → `custom_field#deleteField`
  - `PUT    /boards/{boardId}/custom-fields/reorder`    → `custom_field#reorderFields`
  - `GET    /cards/{cardId}/custom-fields`              → `custom_field#getCardValues` (sidebar open)
  - `PUT    /cards/{cardId}/custom-fields/{fieldId}`    → `custom_field#setCardValue`
  - (OCS API twin deferred; web routes suffice for the SPA in P1.)

  `reorderFields` and `setCardValue` must validate every referenced field/card belongs to the
  board/card in the URL before acting.

### Enrichment (P1 = definitions on board, values on single card only)
- **Board definitions:** `BoardService` (where it does `board->setLabels(labelMapper->findAll)`)
  also calls `customFieldMapper->findAll($boardId)` → `board->setCustomFields(...)`. This is how
  `currentBoard.customFields` reaches the SPA so the sidebar knows which fields exist. `Board`
  entity gets `addRelation('customFields')`.
- **Card values (single card only in P1):** the sidebar fetches a card's values when it opens, via
  the read endpoint `GET /cards/{cardId}/custom-fields` → `customFieldValueMapper->findForCard`. The
  store keeps them on the card as `customFieldValues` (`Card` entity `addRelation('customFieldValues')`
  for the write/read round-trip). **Do NOT batch-enrich values in `CardService::enrichCards`** — the
  board view does not render field values in P1, so enriching every card is wasted work. That batch
  path lands in P5 when values appear on tiles.

### Clone
- **Board clone:** the existing clone path copies field definitions to the new board (new ids);
  build an `oldFieldId → newFieldId` map.
- **Card clone:** copies each source value row, remapping `field_id` through that map. When a card
  is cloned within the same board, field ids are unchanged.
- Reuse / extend the existing `AVUZ-DECK-CLONE-ORDER-V1` clone code; keep the clone tested.

## Frontend architecture (mirrors labels UI)

### Vuex store
- `src/store/main.js` — `currentBoard.customFields` array; mutations
  `addCustomFieldToCurrentBoard / updateCustomFieldInCurrentBoard / removeCustomFieldFromCurrentBoard`
  and a reorder mutation; actions of the same names calling `apiClient` then committing.
- `src/store/card.js` — `loadCustomFieldValues({card})` action → `CustomFieldApi.getCardValues`
  then `commit('updateCardProperty', {property:'customFieldValues', card})` (called when the sidebar
  opens); `setCustomFieldValue({card, fieldId, value})` action → `CustomFieldApi.setCardValue` then
  the same commit.
- Cache/enum strings: reuse the fork's existing convention (no new magic strings).

### API service (JS)
- `src/services/CustomFieldApi.js` — class with `url(u){ return generateUrl('/apps/deck'+u) }`,
  methods returning `axios.<verb>` (from `@nextcloud/axios`), mirroring `BoardApi`/`CardApi`:
  `createCustomField`, `updateCustomField`, `deleteCustomField`, `reorderCustomFields`,
  `getCardValues`, `setCardCustomFieldValue`.

### Board settings UI
- `src/components/board/CustomFieldsTabSidebar.vue` — manage a board's field definitions: list
  (drag-reorder), add form (title, **type picker**, **option editor** shown only for dropdown/multi,
  **required** toggle), edit inline, delete (with a confirm since it purges values). Added as a new
  tab in `src/components/board/BoardSidebar.vue`, beside the Tags tab.

### Card sidebar UI
- `src/components/card/CustomFieldsSection.vue` — placed in
  `src/components/card/CardSidebarTabDetails.vue` (after DueDateSelector, before Description).
  Renders a "Campos" section listing the board's fields; for each, a per-type widget bound to the
  card's value; **soft-required**: when `required && empty`, show a red "obrigatório" badge next to
  the field (ignored for checkbox). On mount/card-change, dispatch `loadCustomFieldValues` to fetch
  the card's values; on change, dispatch `setCustomFieldValue`. Works on the deep-cloned `copiedCard`
  like the other selectors.
- **Per-type widget hash-map** (one input component, `field.type` → widget): text input / number
  input / money input (R$ prefix, 2 decimals) / `NcSelect` single / `NcSelect` multi / date picker
  / checkbox. Icons from `vue-material-design-icons`.

## Permissions

- Field definition CRUD + reorder → board **`PERMISSION_MANAGE`**.
- Setting a card value → card's board **`PERMISSION_EDIT`**.
- Reading (board defs + card values) → **`PERMISSION_READ`** (implicit via board read).
- Enforced in `CustomFieldService` through `PermissionService::checkPermission`.

## Soft-required behavior

A field with `required=true` and an empty value renders a red "obrigatório" badge in the sidebar
section. Nothing is blocked — the card still saves and moves freely. (Hard enforcement is a P2
companion once we know which fields gate which report.)

## Testing

- **PHP (phpunit, `composer run test:unit`):** copy the Label test shapes —
  `tests/unit/Db/CustomFieldMapperTest`, `tests/unit/Db/CustomFieldValueMapperTest`,
  `tests/unit/Service/CustomFieldServiceTest` (permission gates, validation, cascade),
  `tests/unit/Validators/CustomFieldServiceValidatorTest`,
  `tests/unit/controller/CustomFieldControllerTest`. Behavior tests, not implementation.
- **JS (jest, `npm run test`):** `src/services/CustomFieldApi.spec.js` (URL/verb/payload shape);
  a component test for the per-type widget mapping and the soft-required badge.
- **Clone regression:** a test asserting board clone reproduces field defs and card clone remaps
  value field ids.

## Deployment notes (carried from the fork's known gotchas)

- Bump deck `appinfo/info.xml` version to **1.17.2**; the new migration runs on upgrade.
- After deploy, **verify** `occ config:app:get deck installed_version == 1.17.2` and that the two
  new tables exist; if the app was stale-but-disabled, `occ app:disable deck && occ app:enable
  --force deck` (the needsDbUpgrade-skip gotcha).
- Commit the fork's rebuilt `js/` and (if touched) `vendor/` — the Dockerfile can't rebuild them.
- After a JS-only-visible change, **purge Cloudflare** (the `?v=` global-core-hash caching gotcha).
- No new PHP sentinel required, but keep `AVUZ-BOARD-TAGS-V1` / `AVUZ-DECK-CLONE-ORDER-V1` intact;
  consider an `AVUZ-CUSTOM-FIELDS-V1` sentinel comment in `CustomFieldController.php` for
  `verify_avuz_patches` parity.
