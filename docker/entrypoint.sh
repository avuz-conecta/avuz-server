#!/bin/bash
set -e

# Wait for database to be ready
echo "Waiting for database..."
until PGPASSWORD=$POSTGRES_PASSWORD psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c '\q' 2>/dev/null; do
    sleep 2
done

# Install Nextcloud if not already installed
if [ ! -f /var/www/html/config/config.php ]; then
    echo "Installing Nextcloud..."
    php occ maintenance:install \
        --database=pgsql \
        --database-name="$POSTGRES_DB" \
        --database-host="$POSTGRES_HOST" \
        --database-user="$POSTGRES_USER" \
        --database-pass="$POSTGRES_PASSWORD" \
        --admin-user="$NEXTCLOUD_ADMIN_USER" \
        --admin-pass="$NEXTCLOUD_ADMIN_PASSWORD" \
        --data-dir="/var/www/html/data"

    echo "Configuring trusted domains..."
    php occ config:system:set trusted_domains 0 --value="$NEXTCLOUD_TRUSTED_DOMAINS"

    echo "Configuring Redis cache..."
    php occ config:system:set redis host --value="$REDIS_HOST"
    php occ config:system:set redis port --value=6379
    php occ config:system:set memcache.locking --value='\OC\Memcache\Redis'
fi

# Enable avuz_theme app
echo "Enabling avuz_theme app..."
php occ app:enable avuz_theme || true

# Configure Nextcloud logo
echo "Configuring Nextcloud logo..."
if [ -f /var/www/html/apps/avuz_theme/img/logo.png ]; then
    php occ theming:config logo /var/www/html/apps/avuz_theme/img/logo.png || echo "Logo configuration skipped (might need manual upload)"
fi

# Execute the original command
exec "$@"
