<?php

declare(strict_types=1);

namespace OCA\Roundcube\Migration;

use Closure;
use OCP\DB\ISchemaWrapper;
use OCP\IDBConnection;
use OCP\Migration\IOutput;
use OCP\Migration\SimpleMigrationStep;

/**
 * The app id changed from `roundcube` to `conectamail`. Per-user credentials
 * (enc_password, email_enc_password, email) were stored in oc_preferences under
 * the old app id. Move them to the new id so users keep their stored mail
 * passwords across the rename. Runs once when the conectamail app is first
 * enabled; idempotent (no-op once no `roundcube` rows remain).
 *
 * App-level config (sso_secret, credential_key, roundcube_url) is intentionally
 * NOT migrated — entrypoint.sh re-sets it from env on every deploy, and the
 * roundcube appconfig rows include Nextcloud-managed keys (enabled,
 * installed_version) that must not collide with conectamail's own rows.
 */
class Version1100Date20260527000000 extends SimpleMigrationStep
{
    public function __construct(private IDBConnection $connection)
    {
    }

    public function postSchemaChange(IOutput $output, Closure $schemaClosure, array $options): void
    {
        $qb = $this->connection->getQueryBuilder();
        $qb->update('preferences')
            ->set('appid', $qb->createNamedParameter('conectamail'))
            ->where($qb->expr()->eq('appid', $qb->createNamedParameter('roundcube')));

        $moved = $qb->executeStatement();
        $output->info("conectamail: migrated {$moved} preference row(s) from app id 'roundcube'");
    }
}
