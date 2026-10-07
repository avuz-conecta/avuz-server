# Assinaturas — folders and the managers role

Date: 2026-10-07 · Status: approved in brainstorm, awaiting spec review
Changes the access model of `2026-09-28-assinaturas-zapsign-design.md` (today: an envelope is visible to its owner and to Nextcloud admins only).

## Goal

Users organize envelopes in nested folders and share folders with colleagues, the way Deck folders work in our fork. Each client gets company managers who see and act on every envelope without being Nextcloud admins (client users never are; only Avuz maintainers are).

## Roles

| Role | Who | Can |
|---|---|---|
| Member | Group `assinaturas` ("Avuz Assinaturas") | Use the app; own envelopes and folders |
| Manager | Group `assinaturas-admins` ("Avuz Assinaturas Admins") | Everything a member can, plus: see "Toda a empresa" (every envelope with its owner), act on any envelope, see and manage every folder, transfer folder ownership, read-only usage panel (envelopes sent/completed this month, credits) |
| Nextcloud admin | Avuz maintainers | Everything a manager can, plus the connection settings (stack env) and the contracts add-on switch |

- Managers can use the app even when not in `assinaturas`.
- Both groups are created by the app's repair step (like today's `EnsureSignersGroup`), which runs on every boot. Only Nextcloud admins manage their members. Deleting a group in the UI does not stick (it is recreated on the next boot), but its memberships are lost; the tenant runbook says so.

## Folders

- A folder has: title, optional parent folder, owner, sort order. Folders nest without a depth limit; moving a folder into itself or one of its descendants is refused (`folder_cycle`).
- An envelope belongs to **at most one** folder (`folder_id` on the envelope, nullable). No folder = "Sem pasta".
- Folders are shared with **users or groups** through an access list, like Deck's `FolderAcl`:

| Right | Grants |
|---|---|
| Ver | See the folder, its subfolders and their envelopes (status, signers, timeline), download originals and signed copies |
| Editar | Ver, plus act on any envelope in the folder (remind, correct email, extend deadline, cancel, copy signing link), file envelopes into or out of the folder, rename the folder, create subfolders |
| Compartilhar | Add and remove people on the folder's access list, up to their own rights |
| Gerenciar | Everything, including deleting the folder and moving it |

- The owner of a folder has every right on it.
- **Inheritance:** rights on a folder apply to all its descendants. When a person has rights on a folder through more than one path (own entry, a group, an ancestor), the **highest** applies.
- Share recipients only gain access if they can use the app; the share picker lists members of `assinaturas` and groups.
- **Deleting a folder** moves its subfolders and envelopes to its parent (or to "Sem pasta" at the top). Envelopes are never deleted with a folder.
- **Owner leaves:** folders stay; a manager can transfer a folder's ownership to another member ("Transferir pasta").
- **Drafts stay private** to their owner even inside a shared folder: others see an envelope from the moment it is sent. (A draft is unfinished work; sharing starts with the send.)

## Access rules (one function)

A single service decides every check; every endpoint goes through it:

- `canSee(user, envelope)`: owner; or Nextcloud admin; or manager; or (envelope sent and the user has Ver on its folder, inherited included).
- `canAct(user, envelope)`: owner who can use the app; or Nextcloud admin; or manager; or (envelope sent and the user has Editar on its folder).
- Draft editing (the wizard) stays owner-only.
- Folder checks: `folderRight(user, folder)` returns the highest right (none, Ver, Editar, Compartilhar, Gerenciar); managers and Nextcloud admins get Gerenciar on every folder.

When someone cancels an envelope they do not own, the confirmation names the owner ("Este envelope é de Maria Souza."). The timeline already records who did each action.

## Screens

- **Dashboard sidebar:** "Meus envelopes", "Compartilhados comigo" (envelopes the user sees through folders but does not own), "Toda a empresa" (managers and Nextcloud admins), then the folder tree (folders the user owns or has rights on; managers see all).
- A folder view lists its subfolders first, then its envelopes, with the dashboard's filters and search.
- Folder ⋮ menu: Nova subpasta, Renomear, Compartilhar (access list dialog like Deck's), Mover, Transferir (managers), Excluir — each shown only with the right to do it.
- Drag and drop envelopes and folders onto folders in the tree; a keyboard alternative "Mover para…" opens a folder picker.
- Wizard step 1 gets an optional **"Pasta"** field, defaulting to the folder being viewed when the draft was created.
- Envelope page shows the folder (breadcrumb) and a "Mover para…" action.
- Phone: the tree opens in a drawer.

## Data

- `assinaturas_folders`: `id`, `title`, `parent_id` (nullable), `owner_uid`, `sort_order`, `created_at`, `updated_at`.
- `assinaturas_folder_acl`: `id`, `folder_id`, `participant_type` (`user` | `group`), `participant_id`, `perm_edit`, `perm_share`, `perm_manage` (Ver is implied by the row).
- `assinaturas_envelopes.folder_id`: nullable, indexed.
- When a Nextcloud user or group is deleted, their access list rows are removed.

## White label

No user-facing string names ZapSign.

## Testing

- Access matrix for `canSee` / `canAct` / `folderRight`: owner, member with each right (direct, through a group, inherited from an ancestor, multiple paths), non-member, manager, Nextcloud admin; draft vs sent envelope.
- Folder moves: cycle refused; delete moves children up; ACL cleanup on user/group deletion.
- Every envelope endpoint uses the shared check (one test per endpoint that a non-entitled user gets 403/404).
- Vitest: sidebar scopes, tree drag and drop with keyboard alternative, share dialog, "Pasta" field in the wizard, cancel confirmation naming the owner.
