# Prod night runbook — chunked Whisper transcription (grupo-vidalar)

Deploy `AVUZ-AUDIO-CHUNK-V1` (fork 4.5.1.3) to prod and recover the two failed
recordings. Staging e2e already PASSED (avuz-conecta-2, no 413). Do this at the
low-traffic window. Prod NC container: **`grupo-vidalar-app-1`**.

Prereq: create `scripts/deploy.prod.env` (prod PORTAINER_URL + a separate prod
token + `PORTAINER_INSECURE=1` if self-signed). Verify with:
`PORTAINER_ENV_FILE=scripts/deploy.prod.env ./scripts/portainer-exec.sh --list`
— or just `./scripts/portainer-exec-prod.sh <container> ...` per step.

---

## 1. Build + push the prod image

The chunk code is committed + the submodule pins fork 4.5.1.3. Build fresh so
`:latest` on the registry definitely carries it (don't assume a prior build did):

```bash
./scripts/build-push.sh latest prod
```
Builds amd64 on base `avuzconecta-base:latest`, pushes `registry.avuz.app/.../:latest`.

## 2. Pre-deploy gate — CLI memory (OOM adjacency)

Chunking fixes the 413 but a big input still loads via ffmpeg; confirm the CLI
worker has 3072M (written every boot by entrypoint's `zz-avuz-upload.ini`):

```bash
./scripts/portainer-exec-prod.sh -u www-data grupo-vidalar-app-1 php -r 'echo ini_get("memory_limit"),"\n";'
```
Expect `3072M`. (If not — stop; the entrypoint should set it, investigate before deploy.)

## 3. Deploy

```bash
./scripts/deploy-prod.sh grupo-vidalar
```
Confirm prompt shows `[deploy.prod.env]`. It pulls `:latest` + recreates the stack.

## 4. Verify the new code is live

```bash
./scripts/portainer-exec-prod.sh -u www-data grupo-vidalar-app-1 grep -c AVUZ-AUDIO-CHUNK-V1 /var/www/html/apps/integration_openai/lib/Service/OpenAiAPIService.php
./scripts/portainer-exec-prod.sh -u www-data grupo-vidalar-app-1 grep '<version>' /var/www/html/apps/integration_openai/appinfo/info.xml
```
Expect `5` and `4.5.1.3`. Also confirm the persistent task worker is running
(long transcripts need it, not just cron):

```bash
./scripts/portainer-exec-prod.sh grupo-vidalar-app-1 sh -c 'ps aux | grep -i "background-job:worker" | grep -v grep'
```
Expect a `SynchronousBackgroundJob` worker process.

## 5. Recover the two failed recordings (tasks 11, 12)

They are STATUS_FAILED, not RUNNING-orphans — do NOT re-arm rows. Re-schedule a
fresh `AudioToText` task per recording; the fixed code transcribes it and the
normal spreed completion listener posts it to the Talk chat (same path as a live
recording). The recipe mirrors `RecordingService::store` exactly (task type
`core:audio2text`, input = recording fileId, appId `spreed`, owner = who
recorded, customId `call/transcription/<roomToken>`).

**5a. Read each failed task's input fileId + customId (token) + owner:**
```bash
./scripts/portainer-exec-prod.sh -u www-data grupo-vidalar-app-1 php /var/www/html/occ taskprocessing:task:get 11
./scripts/portainer-exec-prod.sh -u www-data grupo-vidalar-app-1 php /var/www/html/occ taskprocessing:task:get 12
```
Note, per task: `Input` (the fileId int), `Custom ID` (`call/transcription/<token>`
→ take `<token>`), and `User ID` (owner: task 11 = `luis@raiven.com.br`, task 12 =
`adm@grupovidalar.com.br`).

**5b. Re-schedule (run once per task, substituting FILEID / TOKEN / OWNER).**
Inline PHP replicating the exact scheduling call:
```bash
./scripts/portainer-exec-prod.sh -u www-data grupo-vidalar-app-1 php -r '
require_once "/var/www/html/lib/base.php";
$fileId = FILEID;                 // from 5a Input
$token  = "TOKEN";                // from 5a Custom ID (after call/transcription/)
$owner  = "OWNER";                // from 5a User ID
$mgr = \OC::$server->get(\OCP\TaskProcessing\IManager::class);
$task = new \OCP\TaskProcessing\Task(
  \OCP\TaskProcessing\TaskTypes\AudioToText::ID,
  ["input" => $fileId],
  "spreed",
  $owner,
  "call/transcription/" . $token,
);
$mgr->scheduleTask($task);
echo "scheduled task ".$task->getId()." for file $fileId owner $owner\n";
'
```

**5c. Watch it complete + deliver:**
```bash
./scripts/portainer-exec-prod.sh -u www-data grupo-vidalar-app-1 php /var/www/html/occ taskprocessing:task:list --type=core:audio2text
```
Expect the new task → `STATUS_SUCCESSFUL`; a transcript `.md` appears in the
owner's recording folder and a message posts to the Talk room. If it FAILS, grab
the reason:
```bash
./scripts/portainer-exec-prod.sh -u www-data grupo-vidalar-app-1 sh -c 'grep -iE "AVUZ-AUDIO-CHUNK|audio2text|413|segment" /var/www/html/data/nextcloud.log | tail -30'
```
A `413` here would mean the fix didn't land (recheck step 4). Anything else →
diagnose from the log line.

## 6. Route A — real long-recording confirm (optional, when convenient)

Record a >70 min Talk call on prod (or reuse the recovered 2.5-3h recording as
the proof). Task → `STATUS_SUCCESSFUL`, transcript in chat, no 413 in the log.
This is the full-chain confirmation (Talk→bot→NC→chunk→OpenAI→chat) beyond the
staging pipeline proof.

## 7. After success

- Update the `talk-ai-stt-chain` memory: prod deploy date + tasks 11/12 recovered.
- The staging temp (`/tmp/parts`, `/tmp/in.mp3` on avuz-conecta-2) — clean if not
  already: `./scripts/portainer-exec.sh -u www-data avuz-conecta-2-app-1 rm -rf /tmp/parts /tmp/in.mp3`.

## Rollback

If prod misbehaves after deploy: redeploy the previous image tag from Portainer,
or revert the submodule pin and rebuild. The change is additive (transcription
path only) — no schema/config migration, so rollback is a plain image swap.
