# Runbook — mask secrets leaked into audit.log

Before this fix, the entrypoint set secrets with `occ config:*:set ... --value="$SECRET"`.
`admin_audit` logs the full argv of every occ command:

```
Console command executed: config:app:set conectamail sso_secret --sensitive --value=<secret>
```

So each config-version bump wrote these to `data/audit.log` in plaintext:

| Key | Env |
|---|---|
| `conectamail/sso_secret`, `conectamail/credential_key` | `ROUNDCUBE_SSO_SECRET`, `ROUNDCUBE_CREDENTIAL_KEY` |
| `integration_openai/api_key`, `integration_openai/stt_api_key` | `AI_API_KEY`, `AI_STT_API_KEY` |
| `system/mail_smtppassword` | `SMTP_PASSWORD` |
| `onlyoffice/jwt_secret` | `ONLYOFFICE_SECRET` |
| `spreed/recording_servers` (JSON holding the secret) | `TALK_RECORDING_SECRET` |

The image now writes them through `docker/set-app-config-from-env.php` by env var name,
so new boots log no value. Lines written before the fix stay in the log until masked.

occ also echoed the non-sensitive ones to the container's stdout
(`... is now set to '<value>'`), so the Docker log of a container booted on an old image
holds them too. That log dies with the container: the next redeploy clears it.

**Only tenants that ran a config bump while `loglevel` was 0 or 1 have leaked lines.**
admin_audit logs at INFO, and the default `loglevel` 2 drops INFO entries. A dry run
tells you which case a tenant is in.

## Tool

`scripts/audit-log/run.sh` bundles `lib.php` + `redact.php` and runs them in the container
as www-data through the Portainer exec proxy (same pattern as `scripts/previews/run.sh`).

```bash
scripts/audit-log/run.sh staging <container>             # dry run: report only
scripts/audit-log/run.sh staging <container> --execute   # mask, then re-scan
scripts/audit-log/run.sh prod    <container>             # prod: ask Patrick first, every run
```

- Reads the same log path admin_audit writes to (`logfile_audit`, else
  `admin_audit/logfile`, else `<datadirectory>/audit.log`), plus the rotated `.1`.
- Masks a line when its key is in the table above, or the command carried `--sensitive`.
  Everything after `--value=` up to the end of the message becomes `*`.
- Masks **in place, byte for byte**: the file keeps its size, owner and mode, and every
  line stays valid JSON. Nextcloud can keep appending meanwhile (its `O_APPEND` writes land
  past every offset the tool touches). A trailing line without `\n` is still being written
  and is skipped.
- Prints keys and counts, never a value. `--execute` ends with
  `verified: no unmasked secret left` or `FAIL <n> secret value(s) still unmasked`.
- Re-running is safe: masked lines count as `masked`.

Plain keys are listed too (`plain`, never touched). Scan them for anything that looks like
a credential someone set by hand, and add it to `SECRET_KEYS` in `lib.php` if so.

## Per tenant

1. Dry run. `0 lines` or no `secret` row → nothing leaked, stop.
2. `--execute`. Confirm the `verified` summary.
3. Decide on rotation with Patrick. Masking removes the live copy only. Any earlier
   copy of the file (Veeam backups of the data volume, a downloaded log) still holds
   the value. Rotate a secret when such a copy may have left the trusted circle.

Production: every run, dry or not, needs Patrick's explicit go, one tenant at a time.

## Done

| Date | Target | Result |
|---|---|---|
| 2026-10-02 | staging `avuz-conecta-app-1` | 5 masked (recording_servers, api_key, stt_api_key, mail_smtppassword, jwt_secret), verified |
| 2026-10-02 | staging `avuz-conecta-2-app-1`, `avuz-conecta-s3-app-1` | empty audit.log (loglevel 2), nothing to mask |
| 2026-10-02 | staging `avuz-conecta-app-1` on the fixed image, forced config run at loglevel 1 | 141 new occ entries, no secret key set on argv; all 7 values match the env; conectamail + integration_openai keys sensitive; jwt_secret kept mixed |
