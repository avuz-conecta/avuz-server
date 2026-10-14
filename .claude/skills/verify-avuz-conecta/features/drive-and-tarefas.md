# Drive and Tarefas

Drive is the file manager (renamed Files). Tarefas is the kanban board app (renamed Deck, an Avuz fork with board folders, tags, custom fields, templates and time tracking). A user uploads a file and creates a card, and both persist.

## Sub-features

- `drive-upload` upload a small file and see it listed.
- `drive-delete` delete it and see it in the trash.
- `tarefas-board` create a board with a stack.
- `tarefas-card` create a card, assign a due date, reopen it after reload.

## How to get to it (user POV)

- Top navigation, `Drive`, upload through the `+ Novo` menu.
- Top navigation, `Tarefas`, `Nova placa` (new board).

## Driving it with Playwright and curl

Preconditions:

- `scripts/doctor.sh` passes. Non-admin test user available. Files created use the prefix `verify-` so cleanup finds them.

- **Upload.** Open Drive. Use `getByRole('button', { name: /Novo/ })`, then choose the upload entry with a file input via `setInputFiles` on a 1 KB text file named `verify-<run>.txt`. Expect a row with that name.
- **Persist.** Reload. Expect the row still listed. Second view: `curl` the file by WebDAV with the user's app password only if the credentials file supplies one; otherwise skip and report.
- **Delete.** Remove the file from its row menu. Open `Arquivos excluídos`. Expect the file there. Then permanently delete it to clean up.
- **Board.** Open Tarefas, create board `verify-<run>`, add stack `A fazer`. Expect both visible.
- **Card.** Add card `verify-card`, set a due date, reload. Expect the card and date still there.
- **Cleanup and proof.** Delete the board. Screenshot each state before cleanup; the report links them.

## Gotchas

- On staging-3 files live in S3. Upload and delete behave the same, but slow object storage can make the row appear late; wait on the row role, not a fixed sleep.
- The Tarefas fork ships built JS. A UI change after deploy may not show in cached browsers until the app version bumps; use a fresh browser context.
- Never use a real user's boards or files for the run.
