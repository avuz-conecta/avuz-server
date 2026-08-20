# Runbook — "Files missing / folder empty / 0 KB" forensics

Diagnose a client report that files or a folder "disappeared", "went to 0 KB", or "isn't shared anymore".
The goal is to classify the situation **before** promising recovery, and to only claim data loss
when there is evidence for it.

> Golden rule: **prove content existed before you say it was lost.** An empty folder is not proof of
> deletion — it can be a folder created empty and never used. Separate *proven fact* from *inference*
> in anything you send a client.

---

## 0. Access — pick the right path per instance

Two shapes of instance in the fleet:

| Instance shape | How to run SQL / shell |
|---|---|
| Bare-metal / client's own box (SSH) | User runs `occ`, `mysql`/`psql`, `ls`, `find` directly on the host. Provide commands. |
| Avuz-managed container (Portainer) | `scripts/portainer-exec-prod.sh -u www-data <container> <cmd>` (prod is gated — read-only SELECTs are fine, any write waits for explicit go). |

Find the DB flavor and prefix first:
```bash
sudo -u www-data php<ver> <webroot>/occ config:system:get dbtype        # mysql | pgsql
sudo -u www-data php<ver> <webroot>/occ config:system:get dbtableprefix  # usually oc_
sudo -u www-data php<ver> <webroot>/occ config:system:get datadirectory
```
`<ver>` may be `php8.3` etc.; `<webroot>` e.g. `/var/www/html/<name>`.

### Container has no mysql/psql client? Run SQL through PHP (base64-eval)

Some app images ship **no** DB client and, on Postgres instances, **no** `pdo_mysql`/`mysqli` — only
`pdo_pgsql`. Run read-only SQL via the container's own PHP + config creds. base64 avoids all
nested-quote/accent hell and keeps the password inside the container:

```bash
B64=$(base64 <<'PHP'
$CONFIG=[];require "/var/www/html/config/config.php";$c=$CONFIG;$p=$c["dbtableprefix"];
$dsn=($c["dbtype"]==="pgsql"?"pgsql":"mysql").":host=".$c["dbhost"].";dbname=".$c["dbname"];
if(!empty($c["dbport"]))$dsn.=";port=".$c["dbport"];
$pdo=new PDO($dsn,$c["dbuser"],$c["dbpassword"]);$pdo->setAttribute(PDO::ATTR_ERRMODE,PDO::ERRMODE_EXCEPTION);
foreach($pdo->query("SELECT ... ") as $r){echo implode("\t",$r)."\n";}
PHP
)
./scripts/portainer-exec-prod.sh -u www-data <container> php -r "eval(base64_decode('$B64'));"
```

---

## 1. Performance rules (do not skip — these tables/dirs are huge)

- **`oc_filecache`**: query by the indexed `(storage, path_hash)` — `path_hash = MD5('files/rel/path')`.
  A `path LIKE 'files/x/%'` is a **full table scan** (minutes / hang). To walk a tree, follow the
  indexed `parent` column (recursive CTE), not `path LIKE`.
- **`oc_activity`**: indexed on `object_id` and on `(affecteduser, timestamp)`. `file LIKE '%name%'`
  is a **full scan → hang**. Also note **`admin` receives an activity row for every action on shared
  content**, so `affecteduser='admin'` is the biggest slice in the table — narrowing to admin does
  *not* save you. Prefer `object_id = <fileid>`, or a **tight** `(non-admin user, timestamp window)`.
- **`find /data`** over all users is huge. Scope to the relevant subtree
  (`/data/<owner>/files/<Dept>`), not the whole data dir.
- Postgres: `oc_files_trash.timestamp` is stored as **varchar** → cast `timestamp::bigint`
  (`to_timestamp(timestamp::bigint)`). Use `ILIKE` for case-insensitive.
- MySQL client mangles accents unless `mysql --default-character-set=utf8mb4` → wrong bytes → wrong
  path/URL. Filenames may be **NFC** (`É`=`%C3%89`) or **NFD** (`E`+`%CC%81`, from macOS clients) —
  a mismatch makes exact `path_hash`/WebDAV lookups miss.

---

## 2. Locate the folder + classify (decision tree)

### 2a. Ownership (often shared from `admin`)
```sql
SELECT id, uid_owner, share_with, file_target FROM oc_share
WHERE file_target ILIKE '%<name>%';
```
`file_target` is the **recipient mount name**, which can differ from the owner's real source path.

### 2b. Resolve a share to its real source folder
```sql
SELECT DISTINCT s.file_source, st.id AS storage, fc.path, fc.size
FROM oc_share s
LEFT JOIN oc_filecache fc ON fc.fileid = s.file_source
LEFT JOIN oc_storages st ON st.numeric_id = fc.storage
WHERE s.file_target = '/<Name>';
```
- `storage` = `home::<uid>` (local/disk home) **or** `object::user:<uid>` (**S3/object primary store** —
  `home::<uid>` will match nothing; that surprise is your signal it's object storage).
- `path` NULL → dangling share (source gone).

### 2c. Is it really empty? size + child count
```sql
-- fileid F found above; get its size and children
SELECT fileid, size, mtime FROM oc_filecache WHERE fileid = F;
SELECT count(*) FROM oc_filecache WHERE parent = F;
```

| Observation | Likely cause | Next |
|---|---|---|
| `size > 0` but `children = 0` (local disk) | filecache desync | `occ files:scan` (§4) |
| `size = 0`, `children = 0`, **mtime frozen** at some past instant | created empty then never touched **or** contents removed at that instant | check activity at that mtime + trash (§3) |
| Content sits under a **different parent** (same or new fileid) | **moved / reorg** | §2d |
| Only a `.nextcloudsync.log` left | a **desktop client** emptied it (local delete pushed up) | trace client, trash (§3) |

> **mtime is decisive**: a folder's mtime only changes when a direct child is added/removed. Frozen at
> creation ⇒ nothing ever entered/left it. Confirm on **disk** too (`ls -la` the physical dir) —
> disk-empty rules out a pure index desync.

### 2d. Moved vs deleted — the fileid test
A **move keeps the same fileid**; a **copy makes a new one**.
Find the folder's current home anywhere (search by name across storages, tolerable one-off):
```sql
SELECT s.id AS storage, fc.fileid, fc.size, fc.path
FROM oc_filecache fc JOIN oc_storages s ON s.numeric_id = fc.storage
WHERE fc.name IN ('<distinct subfolder name>');
```
If the **same fileid** that used to be under `/A` is now under `/B` (and `/A` no longer lists it) →
proven **move**, not loss. (`files_versions/...` rows in the count are version-history mirrors, not
live duplicates.)

---

## 3. Trash hunt + activity evidence

### Trash (per-user; shared-folder deletes land in owner's trash too)
```sql
SELECT "user", id, type, location, to_timestamp(timestamp::bigint) AS del, deleted_by  -- pg
FROM oc_files_trash
WHERE location = '<Folder>' OR location ILIKE '<Folder>/%'
ORDER BY timestamp::bigint DESC;
```
- `location` = original **parent** path (relative to files root, no leading/trailing slash).
- Deleting a **folder** = **one** trash row (type dir); its children ride inside, not as separate rows.
- **Noise filter**: `.dwl` / `.dwl2` (AutoCAD lock files), `.bak`, numbered `.NNNN.rvt` (Revit
  auto-backups), `Thumbs.db`, `~$*` are **auto-created/auto-deleted temp files** — normal CAD/Office
  churn, not content loss. Classify by extension before alarming anyone.
- Default retention ~30 days; deletions older than that are gone from trash (confirm on disk under
  `/data/<user>/files_trashbin/files/`).

### Activity — WITHOUT hanging
```sql
-- events on a specific folder (indexed, instant)
SELECT to_timestamp(timestamp::bigint) ts, affecteduser, type, subject, subjectparams
FROM oc_activity WHERE object_id = <fileid> ORDER BY timestamp::bigint DESC;

-- what got deleted in a tight window (indexed by user+time; use a NARROW window)
SELECT ... FROM oc_activity
WHERE affecteduser='<a recipient>' 
  AND timestamp BETWEEN <start> AND <end> AND type='file_deleted';
```
`subject` like `moved_by` / `renamed_by` carries the old→new path in `subjectparams`; the actor is the
**account** (e.g. `admin`) — a shared login does **not** identify the human.

### Proving prior content (before claiming loss)
An empty folder needs corroboration that it *held* files. Sources, best-first:
1. Activity file_created/changed **inside** the folder dated **before** the incident (if the table is
   small enough to query by object_id/narrow window).
2. A surviving copy on disk or in trash (see §4) — proves existence *and* recovers.
3. Desktop-client copy on a user's PC — proves *and* recovers.
If none exist, the honest statement is *"empty since <date>; no copy on the server"* — **not**
*"files were lost by a problem"*.

---

## 4. Recovery paths (in order of preference)

1. **Web UI restore as the affected user** (shared-folder deletes): restores to original path. Prefer
   over `occ trashbin:restore`, which for a share-recipient's trash can **flatten** files into the
   recipient's home root with `(restaurado N)` suffixes (see the memory note on that failure mode).
2. **`occ files:scan <user> --path=...`** — only helps a **local-disk** desync where files exist on
   disk but not in the DB. **Useless on object/S3 storage** (objects are `urn:oid:<fileid>`; the
   filecache *is* the structure — lost rows = lost mapping).
3. **Orphaned files on disk** from a botched move (local disk): `find` the **scoped** subtree for the
   folder names with content; if found, `files:scan` re-imports.
4. **Desktop-client copies** on user PCs — usually the highest-yield real recovery.
5. **Backup from before the incident** — the reliable path when trash expired; verify retention
   before it rotates.
6. **Re-obtain from source** (HR/scanner/email) for document folders.

---

## 5. Share vanished for one user

Recipient no longer sees a shared folder, no `unshared` activity, others still have it:
- Almost always the recipient (or their desktop client) **deleted/left the received mount**, which
  silently drops only their `oc_share` row. NC keeps no removed-share history.
- If the content has since moved (e.g. into `Pbl/PCP`), the old share is a **dead leftover** — repoint
  the user to the live location instead of re-sharing an empty folder.
- **Prevent recurrence**: use **Team/Group Folders** (users can't leave/unshare) or a **group share**
  instead of many individual user-shares for a company tree.

---

## 6. Audit / trace gaps that block "who did it"

- **Activity app disabled** ⇒ no per-file who/when recorded → gaps.
- **admin_audit** logs to `nextcloud.log` (or a dedicated `audit.log`) **with source IP**, independent
  of the Activity app — but only if enabled, capturing writes, and retained (rotation may drop the
  window). Check `oc_appconfig` (`appid='admin_audit'`).
- Shared `admin` login ⇒ even a good audit log names the account, not the person; correlate with
  `oc_authtoken` (client user-agent / token name) + IP.

---

## Related memory notes
- `nc-share-trash-restore-flattens-home` — occ restore flattening into home root.
- `grupo-vidalar-pgsql-s3-diagnostics` — pgsql + S3 access recipe, the PCP case.
- `custom-apps-shadowing`, `s3-*` notes — object-storage specifics.
