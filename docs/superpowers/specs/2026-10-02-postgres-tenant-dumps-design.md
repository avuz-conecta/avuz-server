# Daily per-tenant Postgres dumps — design

**Date:** 2026-10-02
**Status:** design. Nothing is implemented yet. Needs answers to the open questions (§9) first.

## Recommendation

Run one small **`avuz-db-backup` stack on each app host** (ep6 `avuz-conecta-app1`, ep8 `avuz-conecta-app2`). Once a night it does this for each tenant:

1. Reads the DB credentials from the tenant's own `config.php`. The config volume is mounted read-only.
2. Runs `pg_dump -Fc` and checks the archive with `pg_restore --list`.
3. Encrypts the dump and a copy of `config.php` with `age`, to an offline public key.
4. Keeps 7 days on the host disk. The Veeam VM job picks those files up.
5. Pushes a copy to an **off-Ceph** S3 bucket in Brazil, with versioning and object lock.

A dead-man switch, a freshness and size check, and a nightly restore test of one tenant (round-robin) make failures loud.

Why this option:
- It works whether production runs one central Postgres or one Postgres per stack (§2).
- It needs no image change and no edit to the 12 tenant stacks.
- It restores one tenant without touching the others.
- It does not depend on Veeam supporting Postgres inside Docker, which it does not (§3).

Keep the Veeam VM and bucket jobs, but reorder them: the dumps run first, then the VM job, then the bucket job, chained "After this job" (§7). The dumps land on the VM disk, so Veeam also gives them long-term history. If the central DB turns out to be a native Postgres on a VBR 13 server, add Veeam AAP and log backup on top (§4).

**RPO:** 24 h for DB content, down from "crash-consistent VM image only". **RTO for one tenant:** about 15–60 min, depending on DB size. Measure it in the first restore drill.

## 1. Goal and constraints

**Goal:** be able to restore **one** tenant's Postgres database, plus the `config.php` secrets that make it usable, to a known point in time. Do it without rolling back any other tenant and without restoring a whole VM.

Constraints:
- **The DB is the index of the bucket.** On S3 tenants, objects are `urn:oid:<fileid>`. Names, folders, owners and shares exist only in `oc_filecache` and related tables. Deck, Calendar, Contacts, Talk chat and shares exist only in Postgres.
- **`config.php` is required.** `secret` decrypts 2FA secrets, app passwords and conectamail credentials. `instanceid` names `appdata_<instanceid>`. `passwordsalt` is also needed. These values do not change after install.
- **DB ≤ bucket in time** (runbook `docs/runbooks/s3-restauracao-ceph.md` §6). A DB older than the bucket leaves harmless orphan objects. A DB newer than the bucket lists files that will not open.
- **LGPD.** Dumps contain PII (names, e-mails, chat, calendar). They must be encrypted at rest and in transit, access-controlled, kept no longer than needed, and preferably stored in Brazil.
- **The off-site copy must not live on our Ceph.** A Ceph failure must not take out the files and the DB backups together. Ceph is currently a single-OSD-node cluster.
- **Portainer CE.** It has no stack webhooks. Production changes are gated per action.
- **Lock interaction.** `pg_dump` holds `ACCESS SHARE` on every table for the whole dump. This blocks `TRUNCATE` and `ALTER`. Two things are affected:
  - Entrypoint migrations during a fleet rollout queue behind the dump, and every later query on that table queues behind them. That is an outage during deploys.
  - The preview purge's `TRUNCATE` hits its 5 s lock wait and fails with "retry later".

  So the dump window must not overlap rollouts (22:00–23:00 BRT) or preview purges.

## 2. Topology: what we know and what changes per case

Evidence from earlier sessions:
- comprev's `dbhost` is **10.50.99.40** and its `dbname` is `ac_bpmi8q`.
- OnlyOffice notes call 10.50.99.40 the "central Postgres".
- The staging DB is `ac_8mbqwz`.
- The `ac_<random>` naming points to **one Postgres server holding one database per tenant**.

This is not confirmed for every tenant. It is also not confirmed whether 10.50.99.40 is a VM, bare metal or a container.

| | Case A: central server, one DB per tenant | Case B: one Postgres container per stack |
|---|---|---|
| Network reach from the backup stack | Direct to `dbhost:5432`. | The tenant's DB is on a stack-private network. The backup container must join each stack network (`external` networks in its compose), or run as a sidecar in each stack. |
| Credentials | The tenant's own role, from `config.php`. Optionally one read-only `avuz_backup` role with `pg_read_all_data` (PG ≥14). | The tenant's own role, from `config.php`. |
| `pg_dump` major version | Must be ≥ the server's major. Pin the backup image to the server major. | Same, per container. All are `postgres:16-alpine` today, if the template is followed. |
| Globals (roles) | Add a nightly `pg_dumpall --globals-only` (needs superuser). | Not needed. The role is recreated by `POSTGRES_USER`. |
| Where Veeam sees the DB files | On the DB host's VM. Back up that VM too, ordered before the bucket job. | Inside the app VM. Already covered. |
| Restore target | A new DB on the same server, then a rename (§7). | A new DB in the same container, then a rename. |

The design below is written for Case A. For Case B, the only changes are network attachment and dropping the globals dump.

## 3. Veeam findings

Sources: the Veeam help center (VBR 13.1 current pages, 12.3 archive) and Veeam staff on the forums, read on 2026-10-02.

**Postgres in Docker is not supported.** The help center says nothing about containers. Veeam staff state that application-aware processing (AAP) "will not detect" an instance in a container and that it is not implemented ([forum t90622](https://forums.veeam.com/applications-f66/can-vbr-12-use-application-aware-processing-to-backup-a-postgresql-database-in-a-container-t90622.html), 2023 and 2024). The product manager says to use scripts ([t72286](https://forums.veeam.com/veeam-backup-replication-f2/backup-for-postgresql-on-docker-image-t72286.html), [t68912](https://forums.veeam.com/servers-workstations-f49/backing-up-postgres-db-within-docker-volume-t68912.html)). The reasons:
- The guest helper finds instances only under `/etc/postgresql`, `/var/lib/postgresql` and `/var/lib/pgsql` on the host.
- Explorer needs native PG binaries of the same major version on the target.

If Postgres runs **natively** on a Linux VM, here is what Veeam can do:

| Capability | v12.3 | v13.1 | Source |
|---|---|---|---|
| AAP for PostgreSQL, Linux VM (agentless, SSH-deployed helper; needs a Linux account + PG superuser via password, `.pgpass` or peer) | PG 12–17 | PG 14–18 | [AAP](https://helpcenter.veeam.com/docs/vbr/userguide/application_aware_processing.html), [credentials](https://helpcenter.veeam.com/docs/vbr/userguide/replica_vss_postgresql_vm.html) |
| Consistency | Online backup mode around the snapshot when `wal_level` is replica or logical. Crash-consistent with `minimal`. Documented for the Linux agent; inferred for VMs. | same | [agent PG backup](https://helpcenter.veeam.com/docs/agentforlinux/userguide/postgresql_backup.html) |
| WAL log backup and point-in-time restore. A separate log job, default every 15 min. You set `archive_mode=on` with an **empty** `archive_command`. Per instance only, never per database. | Linux | Linux + Windows | [PG log backup](https://helpcenter.veeam.com/docs/vbr/userguide/postgresql_backup.html), [how it works](https://helpcenter.veeam.com/docs/vbr/userguide/postgresql_backup_hiw.html) |
| Explorer: restore, publish or instant-recover a **whole instance** | yes | yes | [v12 limits](https://helpcenter.veeam.com/docs/backup/explorers/vep_considerations.html?ver=120) |
| Explorer: restore **one database** | **no** (export to a dump file only) | **yes**, Linux targets only, into an existing instance, can rename, point in time | [v13 limits](https://helpcenter.veeam.com/docs/vbr/userguide/vep_considerations.html), [restore DBs](https://helpcenter.veeam.com/docs/vbr/userguide/vep_restoring_databases.html) |
| How a single-database restore works | — | Mounts the backup, starts a temporary instance, pipes `pg_dump \| pg_restore` into the target | [how restore works](https://helpcenter.veeam.com/docs/vbr/userguide/vep_how_restore_works.html) |
| Target requirements | Same PG major, same OS family, native PG utilities, SSH, `en_US.utf8` locale, no third-party PG variants | same | [system reqs](https://helpcenter.veeam.com/docs/vbr/userguide/vep_systemreqs.html) |

Other points that matter here:
- **Pre-freeze / post-thaw guest scripts.** These are `.sh` files run over SSH from `/tmp`. The timeout is 10 minutes, and any stderr output fails the job ([scripts](https://helpcenter.veeam.com/docs/vbr/userguide/pre_post_scripts.html)). A `docker exec … pg_dump` would technically work, but the 10-minute cap and the fail-on-stderr rule make it a poor home for dumps of growing DBs. We do not use it.
- **Guest file-level restore of a Linux VM works.** A helper appliance mounts the disks ([FLR](https://helpcenter.veeam.com/docs/vbr/userguide/performing_guest_restore.html)). Dump files on the VM disk can be pulled out of any VM restore point.
- **Object storage backup** restores a whole bucket, rolls back changed objects, or restores single objects or versions, at the job's restore points ([os recovery](https://helpcenter.veeam.com/docs/vbr/userguide/os_data_recovery.html)). Its schedule can be **"After this job"** of a different type, such as the VM job ([os schedule](https://helpcenter.veeam.com/docs/vbr/userguide/os_backup_job_schedule.html)). Chaining fires only when the first job ran on schedule.
- **Veeam Kasten** is Kubernetes-only and not relevant.

**Takeaway.** For Postgres in Docker, Veeam gives only a crash-consistent VM image plus file-level restore. That is exactly what we have today. If 10.50.99.40 turns out to be a **native** PG on a Linux VM, VBR **13.x** adds two things: per-database restore and a 15-minute log-backup RPO. That makes it a strong second layer (§4), but it still does not cover `config.php` or give an off-Ceph, off-Veeam copy. VBR 12.x cannot restore a single database in place.

## 4. Options

| | A. Veeam-native (AAP + Explorer for PostgreSQL) | B. Dump job baked into the app image | **C. One backup stack per app host (recommended)** |
|---|---|---|---|
| What | Turn on application-aware processing for Postgres in the VM job. Restore with Veeam Explorer for PostgreSQL. | Add a supervisor-run cron in `avuzconecta` that dumps its own DB. Each stack gets a new backup volume and env. | A separate stack per host. It reads each tenant's `config.php` read-only, then dumps, encrypts and uploads. |
| Works with Postgres in Docker | **No** (§3). Only for a native install on a Linux VM. | Yes | Yes |
| Effort | Low if the DB is native and VBR ≥ 13; otherwise impossible. Needs a Linux account plus a PG superuser in Veeam, and `archive_mode=on` for log backup. | Medium-high. Touches the image, 12 stack files and a fleet rollout. Off-site credentials are needed per stack. | Medium. One small image (`postgres:<major>-alpine` + `php-cli` + `age` + `rclone`), one compose file, two deployments. |
| RPO | 15 min with log backup, otherwise the VM job frequency | 24 h | 24 h. Can run twice a day if needed. |
| Restore one tenant | v13: Explorer per-database restore, point in time. v12: whole instance only, or export a dump. | `pg_restore`, 15–60 min | `pg_restore`, 15–60 min |
| Main risk | Ruled out for containers. Does not cover `config.php`. The only copy lives in Veeam, so a lost Veeam means a lost DB. | No dump when the app container crash-loops, which is exactly when you want one. Backup credentials are spread across 12 stacks. | A new tenant can be forgotten in the stack file. Mitigated by the inventory check (§6). |
| Blast radius of a bug | — | Every tenant's runtime image | Backups only. Tenants are untouched. |

**A is a complement, not an alternative.** If question §9.1 shows a native PG on a VBR 13 server, also turn on AAP and log backup for that VM. It costs almost nothing and gives a 15-minute RPO. C stays the base layer either way.

Not chosen now: **pgBackRest / WAL archiving** on the central server. It gives an RPO of minutes and point-in-time recovery, but restores are per cluster: you restore the cluster to a scratch host, then `pg_dump` the one DB. Revisit only if 24 h RPO is not enough for a client.

## 5. Design (option C)

### 5.1 Backup stack

- Image: `registry.avuz.app/admin/avuz-db-backup`, built from `postgres:<server major>-alpine` plus `php83-cli`, `age`, `rclone` and `curl`.
  - The client major must be ≥ the server major.
  - A `-Fc` archive restores only with `pg_restore` of the same or a newer major. Record `pg_dump --version` next to each dump.
  - Do not reuse the app image: its Alpine `postgresql-client` major floats with the base image.
- Cron: busybox `crond` in the container, 01:00 BRT. Tenants run sequentially; there is no parallel load on the DB server.
- Mounts:
  - Each tenant's config volume as `external`, read-only, at `/tenants/<tenant>/config`. Adding a tenant means adding two lines; this is part of the onboarding checklist.
  - Host dir `/srv/avuz-backups/db` at `/backups`, owned by root, mode 0700.
- Env:
  - `AGE_RECIPIENTS`: public keys only.
  - `RCLONE_CONFIG_OFFSITE_*`: write-only key.
  - `HEALTHCHECK_URL`.
  - `TENANTS`: the expected list, used for the inventory check.

### 5.2 Per tenant, per run

1. Read `dbhost`, `dbport`, `dbname`, `dbuser` and `dbpassword` from `config.php` with `php -r`. The password never touches argv; it goes through `PGPASSFILE`.
2. Dump with `pg_dump -Fc --lock-wait-timeout=60s -f /backups/.work/<tenant>.dump`.
3. Verify with `pg_restore --list` (the TOC must parse) and check that the size is greater than 0.
4. Encrypt with `age -R recipients`:
   - `<tenant>/<tenant>_<dbname>_<UTC timestamp>.dump.age`
   - `<tenant>/<tenant>_config_<UTC timestamp>.php.age`

   Then delete the plaintext.
5. Write a manifest `<tenant>/<timestamp>.json`: sha256, bytes, duration, `pg_dump --version`, server version, and row counts for `oc_users`, `oc_filecache` and `oc_deck_cards`.
6. Upload with `rclone copy` to `offsite:avuz-db-backups/<tenant>/`.
7. Prune the local copies to 7 days.

A failure in one tenant does not stop the others. The run's exit status is the worst status of all tenants.

### 5.3 Encryption and keys

- Use **age** with X25519 and two recipients:
  - An **offline DR key**. Its private half lives in the password vault and with a second custodian. It is never on a server.
  - An optional **restore-drill key**, only if drills decrypt off-site copies on a machine.
- The backup host holds only public keys. A stolen backup host or off-site bucket does not expose old dumps.
- Transport: TLS to Postgres where the server offers it (`sslmode=prefer`; see §9). HTTPS to the off-site bucket.

### 5.4 Destinations and retention

| Where | What | Retention | Why |
|---|---|---|---|
| Host disk `/srv/avuz-backups/db` | Encrypted dumps and config | 7 days | Fastest restore. Veeam VM job captures it. |
| Veeam VM backup | Same files, inside the VM image | Veeam's retention | Free history. Restore a single file with guest file-level restore. |
| Off-site S3, **not our Ceph**, Brazil region | Encrypted dumps and config | 35 daily + 12 monthly (lifecycle) | Survives losing the VM, Ceph and Veeam together. |

Off-site bucket rules:
- Versioning on, with object lock (compliance, 35 days) against ransomware.
- The backup key can put, but not delete or overwrite.
- A separate read key lives in the vault for restores.
- Candidates are EVEO or a paid Ceph (both already listed in the runbook as S3 alternatives), Magalu Cloud, or AWS sa-east-1.

LGPD retention: when a user is erased, their data remains in dumps until those dumps expire (≤ 12 months). State this in the client contract or privacy notice.

## 6. Observability

| Signal | How | Alert when |
|---|---|---|
| Job ran | Dead-man ping (Healthchecks, self-hosted or hosted) at start, success and fail | No success ping by 04:00, or a fail ping |
| Freshness | A separate daily check, not run by the job itself, lists the off-site bucket against `TENANTS` | Any tenant's newest dump is > 26 h old, or a tenant is missing |
| Size anomaly | The same check compares to the tenant's 7-day median | Shrinks > 20%, or grows > 50% |
| Content | Row counts from the manifest | `oc_users` or `oc_filecache` drops > 5% day over day |
| Restore works | Nightly round-robin drill, one tenant per night (each tenant every ~2 weeks). Before deleting the plaintext, restore it into an ephemeral `postgres:<major>` container in the backup stack. Check that `pg_restore` exits 0, that the `oc_appconfig` core `installedversion` exists, and that counts match the manifest. Then drop it. | Any failure. The drill duration also trends the RTO. |
| Decrypt path | **Quarterly DR drill** (manual). Pull an off-site dump, decrypt with the offline key, and restore into a throwaway staging stack (`nc-upgrade-rehearsal-method`). Boot it. | Drill fails. Record the real RTO. |

Drill hygiene: a throwaway stack that restores a prod DB must use staging S3 credentials. Before boot, truncate `oc_previews` and foreign `oc_preview_locations`, reset `theming.url`, and wipe the stack afterwards. Staging once pointed at a prod bucket this way.

The alert channel is an open question (§9).

## 7. Timing

Order the nightly chain so DB copies are never newer than the bucket copy:

```
22:00–23:00  fleet rollouts (when they happen)      — no dumps
01:00        avuz-db-backup: dumps (sequential)     — done by ~02:00, to be measured
after dumps  Veeam VM job(s): app VM and DB VM      — captures the night's dump files
after dumps  Veeam object-storage (bucket) job      — must START after the last dump ends
```

- The dump does not have to finish before the VM job, but then the VM image holds the previous night's dumps.
- The DB-before-bucket rule matters for the bucket job. Veeam cannot wait on our cron. So give the VM job a fixed start with a margin of at least 2× the measured dump duration, and set the bucket job to **"After this job"** = VM job (§3). Then the bucket copy is always newer than the dumps. The success ping timestamp proves the margin each night.
- Do not run the dumps from a Veeam pre-freeze script. The 10-minute timeout and fail-on-stderr rule make it fragile (§3).
- Window risk: a file overwritten or permanently deleted between the dump and the bucket snapshot gives a size mismatch or a missing object. Keep the gap short. The runbook §7 reconciliation handles the rest.
- Preview purges and manual maintenance must not run between 01:00 and the end of the dumps.

## 8. Restore one tenant (Case A)

Use the runbook (`docs/runbooks/s3-restauracao-ceph.md`) for containment, the bucket and reconciliation. This covers the DB.

1. **Pick the dump.** Take the newest dump with timestamp ≤ `CORTE_BUCKET`, or the newest overall if the bucket is live. Sources, in order:
   - the host's `/srv/avuz-backups/db/<tenant>/`
   - the off-site bucket
   - Veeam guest file-level restore of that dir
2. **Contain.** Turn maintenance on and disable the NPM proxy host (runbook §2.1).
3. **Decrypt** on a trusted machine: `age -d -i dr.key <file>.dump.age > tenant.dump`. Compare the sha256 with the manifest.
4. **Restore beside the live DB, never over it:**
   ```bash
   createdb -h <dbhost> -U <admin> -O <dbuser> <dbname>_r<YYYYMMDD>
   pg_restore -h <dbhost> -U <admin> -d <dbname>_r<YYYYMMDD> \
     --no-owner --role=<dbuser> --no-privileges -j 4 --exit-on-error tenant.dump
   ```
   Check the counts against the manifest.
5. **Swap.** Stop the tenant's app container; the rename needs zero connections. Then:
   ```sql
   ALTER DATABASE <dbname> RENAME TO <dbname>_broken_<YYYYMMDD>;
   ALTER DATABASE <dbname>_r<YYYYMMDD> RENAME TO <dbname>;
   ```
   Renaming keeps `config.php` and the stack env unchanged.
6. **`config.php`.** Keep the live one if the config volume survived; the secrets never change. If it is lost, decrypt `<tenant>_config_*.php.age` into the volume, owned by `www-data`, mode 0640. Never generate a new one.
7. **Before boot:**
   - If the bucket was also restored, truncate the preview tables (runbook §5.7).
   - Clear the tenant's Redis. Recreating the container clears its internal Redis; with an external Redis, use `FLUSHDB` on its DB.
8. **Boot.** If the dump's `installedversion` is older than the image, the entrypoint runs the forward upgrade. Never roll the image back to match the dump.
9. **Run `occ maintenance:data-fingerprint`.** It tells desktop clients the server was restored, so they re-sync instead of deleting local files.
10. **Validate, reconcile, release.** Follow runbook §8 and §7.
11. Drop `<dbname>_broken_*` after 14 days without complaints.

Case B: the same steps, run against the tenant's DB container (`docker exec` or the container's network).

## 9. Open questions

1. **Topology.** Is 10.50.99.40 the DB for all 12 tenants? Is it a VM, bare metal or a Postgres container? Which PG major (`SELECT version()`)? Does Veeam back up that machine, in which job, and when?
2. **DB sizes.** Get `pg_database_size` per tenant (read-only, needs your go on prod). This sizes the dump window, the off-site cost and the RTO.
3. **Veeam.** Which VBR version (12.x or 13.x)? What are the start times and durations of the VM job and the bucket job? Can the VM job start after ~02:00, with the bucket job chained "After this job"? Is there a Veeam backup copy job off-site?
4. **Off-site provider.** EVEO, paid Ceph, Magalu or AWS sa-east-1? Brazil residency required?
5. **Alert channel.** E-mail, WhatsApp/Telegram, or Healthchecks hosted vs self-hosted?
6. **Key custody.** Who holds the offline age key besides you?
7. **Retention.** Is 7 local / 35 daily / 12 monthly OK, given LGPD erasure requests?
8. **Network and TLS.** Does the DB server allow TLS? Can the app hosts reach it from a new container on the default bridge?
9. **Where the check runs.** A machine outside the app hosts for the freshness check, so it survives a host loss. The ops machine, or a small VM?
