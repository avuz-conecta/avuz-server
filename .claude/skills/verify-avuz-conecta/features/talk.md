# Talk

Talk is the chat and video app. The navigation link and the page title say "Talk" (not "Conversas"); inside the app the pt_BR copy says conversas. It uses a separate high-performance backend (`wss://meet04.avuz.app/standalone-signaling/spreed` on staging-1) for calls and a recording bot that uploads in chunks, so recordings above 100 MB survive the CDN body cap. Run on staging-1 as a regular user on 2026-10-14.

## Sub-features

- `talk-chat` create a conversation and post a message that persists.
- `talk-icon` the themed chat icon is served.
- `talk-chunked-upload-patch` the running app carries the chunked-upload patch marker.

## How to get to it (user POV)

- Top navigation, `Talk` (`/apps/spreed/`), button `Criar uma nova conversa`.

## Driving it with Playwright and curl

Preconditions:

- `scripts/doctor.sh` passes. Non-admin test user available. Conversation names use the prefix `[teste <user>] <run>`.
- Browser context with a plain Chrome `userAgent` (no `Headless`). Under `HeadlessChrome` Talk shows a red "browser not fully supported" banner and the composer stays "Entrando na conversa..." (verified).

- **staging-2 defect, 2026-10-14 (admin):** the create step below FAILS there. After the final button (`Criando conversa`) the dialog `Criar um novo grupo de conversa` stays on `Criando a conversa ...` with a spinner, the URL stays `/apps/spreed/`, and the POST to `/ocs/v2.php/apps/spreed/api/v4/room` returns 500. Reproduced twice (about 5 min apart); GET of the same endpoint returns 200 before and after; no room was left behind (only `Nota para si mesmo`). The recipe stopped there per the 5xx rule, so message, reload, icon-in-browser and cleanup are UNVERIFIED on staging-2. Screenshot: `61a-talk-after-create-click.png`. Do not retry in a loop; report and ask. Cause unknown (needs the container log).
- **Create.** Click `Criar uma nova conversa`. In the dialog fill `Digite um nome para esta conversa`; the three checkboxes (guest link, password, open to registered users) are unchecked by default, which makes it private. Click `Adicionar participantes`, then the final button (accessible name "Criando conversa"). It navigates to `/call/<token>` with the conversation open. Verified.
- **Message.** The composer is a `div.rich-contenteditable__input` with `contenteditable="plaintext-only"`, not a `textbox` role and not matched by `[contenteditable=true]`. Wait for `.rich-contenteditable__input`, wait about 3 s more, click it, `pressSequentially('verify message T-000')`, Enter. Typing before the join finishes is lost. Expect the text in the page. Reload and expect it again. Screenshot before and after. Verified.
- **Patch marker.** Run `scripts/portainer-exec.sh -u www-data <container> grep -rl AVUZ-CHUNKED-UPLOAD-V1 apps/spreed/lib`. Expect at least one file path (the `RecordingController.php`). Save output to the report folder. Unverified (no container access in the 2026-10-14 run).
- **Icon.** `GET /themes/avuz/apps/spreed/img/app.svg` and `app-dark.svg` return 200 `image/svg+xml` (verified). `spreed/dashboard` is a folder, not a file.
- **Cleanup.** Header button `Configurações de conversa` opens the sidebar settings; button `Excluir conversa` (scroll into view), dialog "Você realmente quer excluir ...?" with `Não` / `Sim`. Click `Sim`. Check `GET /ocs/v2.php/apps/spreed/api/v4/room` (headers `OCS-APIRequest: true`, `Accept: application/json`) lists no room with the test name. Verified. The header `Ações de conversa` menu (exact name) holds only "Criar salas temáticas", "Tela cheia (F)", "Configurações de conversa".

## Gotchas

- Never start a call against a live room or load-test a link without the user starting it. This map does not place calls; never click `Iniciar chamada`.
- Real recording, transcription and large-file upload paths are not covered here; they need a real call and the recording bot.
- The marker check proves the patch is in the image, not that a recording uploads.
- The unsupported-browser banner names the upstream product ("... Talk") in English-brand form; a white-label scan of Talk by product name will match it.
- `getByRole('button', { name: 'Ações de conversa' })` matches two buttons: use `exact: true`.
