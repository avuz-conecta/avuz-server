# Avuz Conecta — S3/MinIO deployment runbook

End-to-end steps for spinning up a new client instance backed by S3-compatible
object storage (MinIO in our case). Use this runbook for **fresh** deployments
only; converting an existing local-disk instance to S3 is a separate (and
painful) migration not covered here.

---

## 0. Prerequisites

- DB host running Postgres 14+ (we use `postgres:16-alpine`) reachable from the
  Docker host that will run the app container.
- MinIO instance reachable from the same Docker host. Admin credentials to
  create a bucket + service account.
- App image pushed: `registry.avuz.app/admin/avuzconecta:staging-s3` (or a
  promoted tag — see "Promoting builds" below).
- Portainer access on the target Docker host.

---

## 1. Provision the Postgres database

Pick a **dedicated DB + user per client instance** — never share with another
deployment. The DB name should encode the client (e.g. `nc_acme`).

SSH into the DB host, then become the `postgres` superuser:

```bash
sudo -iu postgres
```

Open `psql` and run (substitute values):

```sql
-- Pick the names for this client instance.
\set client_db      'nc_acme'
\set client_user    'nc_acme'
\set client_pass    'replace-with-strong-random-password'

CREATE USER :"client_user" WITH PASSWORD :'client_pass';
CREATE DATABASE :"client_db"
    OWNER :"client_user"
    ENCODING 'UTF8'
    LC_COLLATE 'en_US.UTF-8'
    LC_CTYPE   'en_US.UTF-8'
    TEMPLATE template0;

-- Lock down: only this user can connect.
REVOKE CONNECT ON DATABASE :"client_db" FROM PUBLIC;
GRANT  CONNECT ON DATABASE :"client_db" TO :"client_user";

-- Schema permissions (Postgres 15+ tightened default public schema acl).
\connect :"client_db"
GRANT ALL ON SCHEMA public TO :"client_user";
```

Verify from the **app host** (not the DB host) that connectivity works:

```bash
psql "host=<db-host> user=nc_acme dbname=nc_acme password=<pass>" -c '\conninfo'
```

If `\conninfo` succeeds, the app container will too. If it fails:

- **timeout** → DB host firewall blocks 5432 or `listen_addresses` in
  `postgresql.conf` is `localhost` only.
- **auth failed** → `pg_hba.conf` rejects the client subnet; add a
  `host nc_acme nc_acme <app-host-cidr> scram-sha-256` line and reload.

Pre-existing-user note: if the user already exists in the cluster, replace
`CREATE USER` with `ALTER USER :"client_user" WITH PASSWORD :'client_pass';`.

---

## 2. Prepare the MinIO bucket

```bash
# On any host with `mc` configured against the MinIO instance:
mc mb local/avuz-conecta-acme
mc admin user add local <access-key> <secret-key>
mc admin policy attach local readwrite --user=<access-key>
mc anonymous set none local/avuz-conecta-acme   # explicit private
```

Record `<access-key>` and `<secret-key>` — they go into the stack env.

If `OBJECTSTORE_S3_AUTOCREATE=true` (default in the stack), the bucket will be
created on first boot if missing. Pre-creating is still cleaner and lets you
set lifecycle / versioning policies before any data lands.

---

## 3. Deploy the Portainer stack

1. Portainer → Stacks → **Add stack** → Web editor.
2. Paste `portainer-stack-s3.yml` from this repo.
3. Fill the required envs in the editor:
   - `POSTGRES_HOST`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` from step 1.
   - `OBJECTSTORE_S3_BUCKET`, `OBJECTSTORE_S3_KEY`, `OBJECTSTORE_S3_SECRET`, `OBJECTSTORE_S3_HOSTNAME` from step 2.
   - `NEXTCLOUD_TRUSTED_DOMAIN` + `NEXTCLOUD_TRUSTED_DOMAINS` for this client.
   - Optional integrations (SMTP, OnlyOffice, Talk recording, AI) as needed.
4. Deploy. Watch container logs.

Healthy first boot shows:

```
Configuring S3 object store: bucket=avuz-conecta-acme host=<host>:9000
✓ S3 object store config written to /var/www/html/config/s3.config.php
Waiting for database...
Nextcloud is not installed yet
Installing Nextcloud...
... maintenance:install output ...
═══ Running Avuz Conecta configuration ═══
```

If the `Configuring S3 object store` line is missing the envs aren't reaching
the container — recheck the stack env block.

---

## 4. Smoke test

1. Open `https://<trusted-domain>/` → log in as admin.
2. Upload a small file via the Files app.
3. On MinIO: `mc ls local/avuz-conecta-acme/` — should show an object named
   `urn:oid:<n>` per uploaded file (plus appdata objects).
4. Create a Talk room, start a recording, stop it after ~10s. Verify:
   - Recording appears in the user's `Talk/Recording/` folder in Files.
   - A corresponding `urn:oid:<n>` object exists in the bucket.
5. (Optional) Big recording (>100MB) to exercise the chunked upload path:
   - During upload, `data/avuz-recording-chunks/<token>/<uploadId>/*.part` files
     should appear on the container's local volume.
   - On finalize they're gone and the recording lands in the bucket.

If any step fails, tail `/var/www/html/data/nextcloud.log` inside the container
for S3 errors (typically signature mismatch → key/secret wrong, or hostname
unreachable).

---

## 5. Operational follow-ups

- **Backups**:
  - Postgres: `pg_dump nc_acme | gzip > nc_acme-$(date +%F).sql.gz` daily.
  - MinIO bucket: replication to a second MinIO node OR lifecycle policy
    snapshotting to cold storage. Local `data/` snapshot still useful for
    appdata + sessions.
- **Disk on app host**: `data/` is no longer the dominant volume but still
  needs space for chunked recording staging (TTL 1h) + appdata + logs.
  Budget 50–100 GB SSD per instance.
- **TLS to MinIO**: if MinIO runs with a real cert, flip
  `OBJECTSTORE_S3_USE_SSL=true` and `OBJECTSTORE_S3_PORT=443`. For self-signed
  certs, mount the CA into the container at
  `/usr/local/share/ca-certificates/minio.crt` and rebuild the image with
  `update-ca-certificates` in the Dockerfile.
- **Rotating S3 credentials**: update envs in the stack, redeploy. Config file
  reads via `getenv()` so no on-disk secrets to rotate.

---

## Promoting builds

`:staging-s3` is the test tag pushed by:

```bash
./scripts/build-push.sh latest staging s3
```

For a stable production tag once the S3 integration is validated, promote by
re-tagging in the registry or building with the canonical mode and a versioned
suffix:

```bash
./scripts/build-push.sh latest prod s3        # -> :latest-s3
./scripts/build-push.sh 33.0.0 prod s3        # -> :33.0.0-s3 + :latest-s3
```

Pin the client stack to a versioned tag (`:33.0.0-s3`), not `:latest-s3`, to
avoid surprise upgrades.
