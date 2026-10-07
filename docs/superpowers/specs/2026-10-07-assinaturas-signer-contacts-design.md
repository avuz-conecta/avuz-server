# Assinaturas — signers from Nextcloud Contacts

Date: 2026-10-07 · Status: approved in brainstorm, awaiting spec review
Supersedes decision 6 of `2026-09-28-assinaturas-zapsign-design.md` §7 ("typed by hand; no contacts autocomplete in v1").

## Goal

In the signers step, a user finds people in their contacts or among Avuz Conecta users instead of typing name and email, and new signers can be saved to their contacts.

## Search

- The signer **name** and **email** fields suggest people as the user types, from 2 characters.
- Sources: the **current user's own address books** (Contacts app) and **users of the instance** that have an email address. System address books and address books shared by other users are not searched.
- Server endpoint `GET /api/v1/signer-suggestions?q=<text>`:
  - Allowed for users who can use the app (`AccessPolicy::canUseApp`); others get 403.
  - Searches through Nextcloud's contacts API (`OCP\Contacts\IManager::search`) on `FN` and `EMAIL`, restricted to the user's address books, plus the user manager for instance users.
  - Returns at most **10** results: `{ name, email, source: 'contact' | 'user' }`, deduplicated by email (a user wins over a contact with the same email). Entries without an email are dropped.
  - `q` shorter than 2 characters returns an empty list without searching.
- Each result shows avatar, name, email and a source label ("Contato" / "Usuário").
- Picking a result fills name and email. The signer name rule still applies: a one-word name shows "Informe nome e sobrenome." until completed.
- Accessibility: an ARIA combobox (listbox popup) — arrow keys move, Enter picks, Esc closes; the number of results is announced through a polite live region; the active option is exposed with `aria-activedescendant`.
- The frontend debounces requests (named constant, 250 ms) and cancels stale ones; results are cached per query with TanStack Query.

## Saving to contacts

- A signer whose email is **not in any of the user's address books** shows a **"Salvar nos contatos"** checkbox, **checked by default**. Signers picked from contacts, instance users and existing contacts never show it.
- The choice is stored with the draft signer (`save_to_contacts`, boolean).
- When the envelope is **sent successfully**, the app creates a contact (`FN` = name, `EMAIL` = email) in the user's **default writable address book** for each signer with the box checked. If a contact with that email exists by then, nothing is created or merged.
- A failure to save a contact never blocks or undoes the send; it is logged (warning, no personal data beyond the envelope id).
- If the Contacts app is disabled or the user has no writable address book, the checkbox is hidden and search returns only instance users.

## White label

No user-facing string names ZapSign (guard test in `src/`).

## Testing

- PHP: search across both sources, dedup by email, 10-result cap, short query, permission (403 for non-members), contact saving with and without an existing contact, no writable address book, save failure does not fail the send.
- Vitest: combobox keyboard behaviour and announcements, picking fills both fields, checkbox visibility rules, checkbox value persisted in the draft.
