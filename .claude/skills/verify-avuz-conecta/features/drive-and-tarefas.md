# Drive and Tarefas

Drive is the file manager (renamed Files). Tarefas is the kanban board app (renamed Deck, an Avuz fork with board folders, tags, custom fields, templates and time tracking). A user uploads a file and creates a card, and both persist. Run on staging-1 as a regular user on 2026-10-14 (Deck 1.18.100).

## Sub-features

- `drive-upload` upload a small file and see it listed.
- `drive-delete` delete it and see it in the trash.
- `tarefas-board` create a board with a list.
- `tarefas-card` create a card, assign a due date, reopen it after reload.
- `tarefas-time` Tempo tab: add a time entry, see total, delete it.
- `tarefas-hints` Novidade hint popovers are dismissable.

## How to get to it (user POV)

- Top navigation, `Drive` (`/apps/files/`), upload through the `Novo` menu, entry `Fazer upload de arquivos`.
- Top navigation, `Tarefas` (`/apps/deck/`), sidebar `Adicionar painel` (new board). The UI says painel / lista / cartão, never "placa".
- Card details open as a modal (`role=dialog`, "Detalhes do cartão") with tabs Detalhes, Subtarefas, Tempo, Anexos, Comentários, Atividade.

## Driving it with Playwright and curl

Preconditions:

- `scripts/doctor.sh` passes. Non-admin test user available. Test objects are named `[teste <user>] <run>` so cleanup finds them. Session setup: see `../SKILL.md` (Drive).

- **Upload.** Open `/apps/files/`. The `Novo` button (`getByRole('button', { name: /Novo/ })`) lists menuitems `Fazer upload de arquivos`, `Fazer upload de pastas`, `Nova pasta`, `Criar solicitação de arquivo`, `Novo arquivo de texto`. A hidden `input[type=file]` exists: call `setInputFiles` on `page.locator('input[type=file]').first()` with a small text file. Expect `getByRole('row', { name: /<name stem>/ })` (the row text splits the extension: `[teste Bri] T-000 .txt`). Verified: row appears within seconds, size `< 1 KB`.
- **Persist.** Reload, expect the row. Second view: `page.context().request.get('<base>/remote.php/dav/files/<user>/<urlencoded name>')` with the session cookie returns 200 and the byte length (no app password needed). Verified.
- **Delete.** Row button `Ações` (`getByRole('button', { name: /Ações/ })`), menuitem `Excluir arquivo`. No confirm dialog; the row vanishes at once. Sidebar link `Arquivos excluídos` (`/apps/files/trashbin`) shows the row. Its `Ações` menu has `Baixar` and `Excluir permanentemente` (no confirm dialog either). Afterwards the WebDAV GET returns 404. Verified.
- **Board.** Open `/apps/deck/`. Click `getByText('Adicionar painel', { exact: true })`, fill the `Nome do painel` field, press Enter. The board is created, but the URL stays on `/apps/deck/` ("Próximos cartões"); it does not navigate to the board. Click the board in the sidebar, or read its id from `GET /index.php/apps/deck/api/v1.0/boards` (header `OCS-APIRequest: true`) and open `/apps/deck/board/<id>`. Pressing Enter twice, or retrying after a timeout, creates duplicates: list the boards before retrying.
- **List.** On the empty board click `Adicionar lista`, fill `Nome da lista`, Enter. Then `Adicionar cartão` appears.
- **Card.** Click `Adicionar cartão` (button), fill the `Nome do cartão` input, Enter. Click the card title: the URL becomes `/apps/deck/board/<id>/card/<id>`. Reload on that URL re-opens the modal.
- **Due date.** Tab Detalhes. Click the `+` right of `Data de vencimento` (role-less; click by coordinates or the icon next to that label). A menu offers `Hoje mais tarde`, `Amanhã`, `Este fim de semana`, `Semana que vem` and `Escolha uma data`. Pick `Semana que vem` (`getByText(/^Semana que vem/)`). After reload the field shows a `datetime-local` value (`19/10/2026, 08:00`). Verified.
- **Tempo tab.** `getByRole('tab', { name: 'Tempo' })`. Panel `#tab-time`. Stable hooks: `data-cy` `time-toggle` (timer, do not click), `time-add`, `time-form`, `time-total`, `time-by-user`, `time-entry`, `time-stage`, `time-current-stage`, `time-since`. Empty state: "Nenhum tempo registrado.".
  - Click `[data-cy="time-add"]` (`+ Adicionar tempo`). Form `[data-cy="time-form"]`: `input[type=number]` Horas (default 0), `input[type=number]` Minutos (default 0), `input[type=date]` Data (today), a text Nota, buttons `Cancelar`, `Salvar`.
  - Horas 0 and Minutos 0, `Salvar`: message "A duração deve ser maior que zero", nothing saved. Verified.
  - Horas 1, Minutos 30, `Salvar`: `time-total` reads "Total no cartão 1h 30min", `time-entry` reads "14/10/2026 Bri Teste 455 manual 1h 30min". Survives reload. Verified.
  - Delete: the entry's first button opens a menu (`menuitem` `Editar`, `Excluir`); `Excluir` opens a confirm dialog (`Cancelar`, `Excluir`); click the `Excluir` in `getByRole('dialog').last()`. Panel returns to "Nenhum tempo registrado.". Verified.
  - Never click `time-toggle` (it starts a running timer).
  - Layout checks of the entry form (field widths, one row) are card 540 territory, not covered here.
- **Hints.** On an account that already dismissed them, none appear (verified 2026-10-14). On a fresh account, loop: while `.feature-hint` has a button `Entendi`, click it, wait 500 ms, and wait about 700 ms before concluding there are none (the next hint can arrive late). Hints defer while a modal is open, so dismiss them before opening a card. Unverified this run (needs a fresh account): the queue size and order.
- **Cleanup and proof.** Delete the card: modal `...` menu (top right of the modal), `getByText('Excluir cartão', { exact: true })`, no confirm dialog. Delete each board: sidebar entry `Ações`, `getByText('Excluir painel', { exact: true })`, then `Excluir` in the dialog. Confirm with the boards API: `deletedAt` is set (soft delete); the board disappears from the sidebar. Screenshot each state before cleanup.

## Gotchas

- Board and card menus (`Ações`) list items that are not `menuitem`s, use text. Board menu: Detalhes do painel, Editar painel, Clonar painel, Arquivar painel, Exportar painel, Desativar lembretes de vencimento, Mover para pasta…, Excluir painel.
- On staging-3 files live in S3. Upload and delete behave the same, but slow object storage can make the row appear late; wait on the row role, not a fixed sleep. Unverified here (staging-1 only).
- The Tarefas fork ships built JS. A UI change after deploy may not show in cached browsers until the app version bumps; use a fresh browser context.
- The card description editor has a button labelled "<upstream product name> Assistente" (an untranslated upstream string); a white-label scan of Tarefas pages by product name will match it. Same for Talk's unsupported-browser banner (see talk.md).
- Never use a real user's boards or files for the run. The sidebar board `Bem-vindo ao Tarefas!` is the account's seed board: leave it alone.
