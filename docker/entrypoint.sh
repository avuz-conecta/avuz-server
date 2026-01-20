#!/bin/bash
set -e

# Define app lists (used for both disabling during upgrade and enabling after)
BUNDLED_APPS=(
    "avuz_theme"
    "admin_audit"
    "activity"
    "calendar"
    "comments"
    "contacts"
    "contactsinteraction"
    "dashboard"
    "external"
    "federatedfilesharing"
    "files_reminders"
    "files_sharing"
    "sharebymail"
    "spreed"
    "systemtags"
    "twofactor_backupcodes"
    "twofactor_totp"
    "updatenotification"
    "user_status"
    "files_versions"
    "weather_status"
    "files_trashbin"
    "theming"
    "mail"
)

APPSTORE_APPS=(
    "deck"
    "forms"
    "suspicious_login"
    "logreader"
    "bruteforcesettings"
    "files_downloadlimit"
    "mindmaps"
    "password_policy"
    "quota_warning"
    "files_retention"
    "onlyoffice"
)

# Fix permissions for mounted volumes
echo "Fixing permissions..."
chown -R www-data:www-data /var/www/html/data /var/www/html/config /var/www/html/custom_apps 2>/dev/null || true
chmod -R 770 /var/www/html/data /var/www/html/config /var/www/html/custom_apps 2>/dev/null || true

# Determine if we should use internal or external Redis
if [ -z "$REDIS_HOST" ] || [ "$REDIS_HOST" = "localhost" ] || [ "$REDIS_HOST" = "127.0.0.1" ]; then
    REDIS_HOST="127.0.0.1"
    echo "Using internal Redis server..."
    # Start Redis in background as daemon
    redis-server --bind 127.0.0.1 --port 6379 --daemonize yes --protected-mode no
    # Wait for Redis to be ready
    echo "Waiting for Redis to start..."
    for i in $(seq 1 10); do
        if redis-cli -h 127.0.0.1 ping > /dev/null 2>&1; then
            echo "✓ Redis is ready"
            break
        fi
        sleep 1
    done
else
    echo "Using external Redis server at $REDIS_HOST..."
fi

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

    echo "Configuring background jobs to use cron..."
    php occ background:cron

    # Run mimetype migrations on fresh install
    echo "Running mimetype migrations..."
    php occ maintenance:repair --include-expensive

    # Fix permissions after installation
    echo "Fixing permissions after installation..."
    chown -R www-data:www-data /var/www/html/config
    chmod -R 770 /var/www/html/config
else
    # Ensure permissions are correct on existing installation
    echo "Fixing permissions on existing installation..."
    chown -R www-data:www-data /var/www/html/config
    chmod -R 770 /var/www/html/config

    # Check if upgrade is needed and run it
    echo "Checking if Nextcloud needs upgrade..."
    if php occ status | grep -q "needsDbUpgrade: true"; then
        echo "Upgrading Nextcloud database..."

        # Disable all managed apps before upgrade to avoid conflicts
        echo "Disabling apps for safe upgrade..."
        for app in "${BUNDLED_APPS[@]}" "${APPSTORE_APPS[@]}"; do
            php occ app:disable "$app" 2>/dev/null || true
        done

        # Run upgrade
        php occ upgrade --no-interaction

        # Disable maintenance mode
        php occ maintenance:mode --off

        # Run mimetype migrations after upgrade
        echo "Running mimetype migrations..."
        php occ maintenance:repair --include-expensive

        echo "✓ Nextcloud database upgraded successfully"
    else
        echo "✓ Nextcloud is up to date"
    fi
fi

# Configure trusted domains (always run, even for existing installations)
echo "Configuring trusted domains..."
php occ config:system:set trusted_domains 0 --value="$NEXTCLOUD_TRUSTED_DOMAINS"
php occ config:system:set overwrite.cli.url --value="https://$NEXTCLOUD_TRUSTED_DOMAIN"

# Configure overwrite protocol (http or https)
if [ -n "$OVERWRITEPROTOCOL" ]; then
    echo "Setting overwrite protocol to $OVERWRITEPROTOCOL..."
    php occ config:system:set overwriteprotocol --value="$OVERWRITEPROTOCOL"
fi

# Configure Redis cache (always run, even for existing installations)
echo "Configuring Redis cache..."
php occ config:system:set redis host --value="$REDIS_HOST"
php occ config:system:set redis port --value=6379 --type=integer
php occ config:system:set redis timeout --value=0.0 --type=float
php occ config:system:set memcache.local --value='\OC\Memcache\Redis'
php occ config:system:set memcache.locking --value='\OC\Memcache\Redis'
php occ config:system:set filelocking.enabled --value=true --type=boolean

# Set default phone region (always run)
echo "Setting default phone region..."
php occ config:system:set default_phone_region --value='BR'

# Set default language to Brazilian Portuguese
echo "Setting default language to pt_BR..."
php occ config:system:set default_language --value='pt_BR'
php occ config:system:set default_locale --value='pt_BR'
# Force pt_BR for all users including guests (ignores browser Accept-Language header)
php occ config:system:set force_language --value='pt_BR'

# Disable skeleton files (welcome.txt) for new users
echo "Disabling skeleton files for new users..."
php occ config:system:set skeletondirectory --value=''

# Set maintenance window start time
echo "Setting maintenance window start time to 1 AM UTC..."
php occ config:system:set maintenance_window_start --value=1 --type=integer

# Force light mode as default theme
echo "Setting light mode as default theme..."
php occ config:system:set enforce_theme --value='light'

# Configure theming (name, colors, favicon, url)
echo "Setting default theming..."
php occ theming:config name "Avuz Conecta"
php occ theming:config url "https://$NEXTCLOUD_TRUSTED_DOMAIN"
php occ theming:config primary_color "#1c7fa0"
php occ theming:config background_color "#d2e314"
# Set productName for {productName} placeholders in translations
php occ config:app:set theming productName --value="Avuz Conecta"

# Configure favicon via theming (uses properly sized favicon)
if [ -f /var/www/html/apps/avuz_theme/img/favicon-32.png ]; then
    php occ theming:config favicon /var/www/html/apps/avuz_theme/img/favicon-32.png || echo "Favicon configuration skipped"
fi

# Set custom theme for translation overrides (Files -> Drive, Deck -> Tarefas)
echo "Setting custom theme for translation overrides..."
php occ config:system:set theme --value='avuz'

# Clear imagePath cache to ensure theme icons are resolved correctly
# This cache stores resolved icon paths and can return stale paths after theme changes
echo "Clearing image path cache..."
redis-cli -h "$REDIS_HOST" EVAL "local keys = redis.call('keys', '*imagePath*'); for i=1,#keys do redis.call('del', keys[i]) end; return #keys" 0 || true

# Hide "Get your own free account" signup link on public share pages
php occ config:system:set simpleSignUpLink.shown --type=boolean --value=false

# Use custom email template class for custom email logo support
php occ config:system:set mail_template_class --value='OCA\AvuzTheme\Mail\EMailTemplate'

# Disable Talk default conversations for new users
# - "Let's get started!" sample conversation
# - "Talk updates" changelog conversation
echo "Disabling Talk default conversations..."
php occ config:app:set spreed create_samples --value="false"
php occ config:app:set spreed changelog --value="no"

# Configure Mail app performance optimizations
echo "Configuring Mail app optimizations..."
# These settings go in config.php, not via occ config:app:set
# The Mail app reads them via getSystemValueInt()
php occ config:system:set app.mail.imap.timeout --value=20 --type=integer
php occ config:system:set app.mail.smtp.timeout --value=20 --type=integer
php occ config:system:set app.mail.sieve.timeout --value=5 --type=integer
# Sync mailboxes more frequently for active users (default: 3600, minimum: 300)
php occ config:system:set app.mail.background-sync-interval --value=600 --type=integer

# Configure trusted proxies for push notifications
echo "Configuring trusted proxies..."
php occ config:system:set trusted_proxies 0 --value='127.0.0.1'
php occ config:system:set trusted_proxies 1 --value='::1'
php occ config:system:set trusted_proxies 2 --value='10.50.100.100'

# Configure SMTP if credentials are provided
if [ -n "$SMTP_HOST" ] && [ -n "$SMTP_NAME" ]; then
    echo "Configuring SMTP..."
    php occ config:system:set mail_smtpmode --value='smtp'
    php occ config:system:set mail_smtphost --value="$SMTP_HOST"
    php occ config:system:set mail_smtpport --value="$SMTP_PORT" --type=integer
    php occ config:system:set mail_smtpsecure --value="$SMTP_SECURE"
    php occ config:system:set mail_smtpauth --value=1 --type=integer
    php occ config:system:set mail_smtpauthtype --value="$SMTP_AUTHTYPE"
    php occ config:system:set mail_smtpname --value="$SMTP_NAME"
    php occ config:system:set mail_smtppassword --value="$SMTP_PASSWORD"
    php occ config:system:set mail_from_address --value="$SMTP_FROM"
    php occ config:system:set mail_domain --value="$SMTP_DOMAIN"
    echo "✓ SMTP configured successfully"
else
    echo "⊘ SMTP configuration skipped (credentials not provided)"
fi

# Enable bundled apps
echo "Enabling bundled apps..."
for app in "${BUNDLED_APPS[@]}"; do
    echo "Enabling $app..."
    php occ app:enable "$app" || echo "Could not enable $app (might not be installed)"
done

# Install apps from App Store (only if not already installed)
echo "Installing apps from App Store..."
for app in "${APPSTORE_APPS[@]}"; do
    # Check if app is already installed (appears in app:list output)
    if php occ app:list | grep -q "  - $app:"; then
        echo "✓ $app already installed"
        # Make sure it's enabled
        php occ app:enable "$app" 2>/dev/null || true
    else
        echo "→ Installing $app from App Store..."
        if php occ app:install "$app" 2>/dev/null; then
            echo "✓ $app installed successfully"
        else
            echo "✗ Could not install $app (might not be available in App Store)"
        fi
    fi
done

# Install notifications app from Git (if branch specified)
NOTIFICATIONS_BRANCH="${NOTIFICATIONS_BRANCH:-stable32}"
if [ -n "$NOTIFICATIONS_BRANCH" ]; then
    echo "Installing notifications app from Git (branch: $NOTIFICATIONS_BRANCH)..."
    if [ ! -d /var/www/html/apps/notifications ]; then
        echo "→ Cloning notifications app..."
        git clone --depth 1 --branch "$NOTIFICATIONS_BRANCH" https://github.com/nextcloud/notifications.git /var/www/html/apps/notifications
        chown -R www-data:www-data /var/www/html/apps/notifications
        chmod -R 755 /var/www/html/apps/notifications
        echo "✓ notifications app cloned successfully"
    else
        echo "✓ notifications app already exists"
    fi
    php occ app:enable notifications 2>/dev/null || true
fi

# Configure Nextcloud logos
echo "Configuring Nextcloud logos..."
# Main logo (login page, etc.)
if [ -f /var/www/html/apps/avuz_theme/img/logo2.png ]; then
    php occ theming:config logo /var/www/html/apps/avuz_theme/img/logo2.png || echo "Logo configuration skipped"
fi
# Header logo (small icon in top bar)
if [ -f /var/www/html/apps/avuz_theme/img/house-logo.svg ]; then
    php occ theming:config logoheader /var/www/html/apps/avuz_theme/img/house-logo.svg || echo "Header logo configuration skipped"
fi

# Configure OnlyOffice if credentials are provided
if [ -n "$ONLYOFFICE_URL" ] && [ -n "$ONLYOFFICE_SECRET" ]; then
    echo "Configuring OnlyOffice..."
    php occ config:app:set onlyoffice DocumentServerUrl --value="$ONLYOFFICE_URL"
    php occ config:app:set onlyoffice jwt_secret --value="$ONLYOFFICE_SECRET"
    php occ config:app:set onlyoffice jwt_header --value="Authorization"

    # Enable all document formats
    echo "Enabling OnlyOffice document formats..."
    php occ config:app:set onlyoffice defFormats --value='{"csv":"true","doc":"true","docm":"true","docx":"true","docxf":"true","dot":"true","dotm":"true","dotx":"true","epub":"true","fb2":"true","fodp":"true","fods":"true","fodt":"true","htm":"true","html":"true","hwp":"true","hwpx":"true","key":"true","md":"true","mht":"true","mhtml":"true","numbers":"true","odg":"true","odp":"true","ods":"true","odt":"true","otp":"true","ots":"true","ott":"true","oxps":"true","pages":"true","pdf":"true","pot":"true","potm":"true","potx":"true","pps":"true","ppsm":"true","ppsx":"true","ppt":"true","pptm":"true","pptx":"true","rtf":"true","stw":"true","sxc":"true","sxi":"true","sxw":"true","txt":"true","vsdm":"true","vssm":"true","vssx":"true","vstm":"true","vstx":"true","wps":"true","xls":"true","xlsb":"true","xlsm":"true","xlsx":"true","xlt":"true","xltm":"true","xltx":"true","xml":"true","xps":"true","djvu":"true"}'
    php occ config:app:set onlyoffice editFormats --value='{"csv":"true","odp":"true","ods":"true","odt":"true","rtf":"true","txt":"true","doc":"true","docm":"true","docx":"true","docxf":"true","dotx":"true","epub":"true","fb2":"true","html":"true","otp":"true","ots":"true","ott":"true","potm":"true","potx":"true","ppsm":"true","ppsx":"true","ppt":"true","pptm":"true","pptx":"true","xls":"true","xlsm":"true","xlsx":"true","xltm":"true","xltx":"true","htm":"true","fodt":"true","fods":"true","fodp":"true"}'

    echo "✓ OnlyOffice configured successfully"
else
    echo "⊘ OnlyOffice configuration skipped (credentials not provided)"
fi

# Install and configure notify_push for real-time notifications
echo "Installing notify_push app..."
if ! php occ app:list | grep -q "  - notify_push:"; then
    php occ app:install notify_push 2>/dev/null || echo "✗ Could not install notify_push"
fi
php occ app:enable notify_push 2>/dev/null || true

# Fix notify_push binary permissions
echo "Setting notify_push binary permissions..."
chmod +x /var/www/html/apps/notify_push/bin/x86_64/notify_push 2>/dev/null || true
chmod +x /var/www/html/custom_apps/notify_push/bin/x86_64/notify_push 2>/dev/null || true

# Run database maintenance (add missing indices and repair mimetypes)
echo "Running database maintenance..."
php occ db:add-missing-indices --no-interaction 2>/dev/null || true
php occ maintenance:repair --include-expensive 2>/dev/null || true
echo "✓ Database maintenance completed"

# Pre-sync all mail accounts in the background to warm up the cache
# This reduces first-load time when users access the Mail app
echo "Triggering background mail sync for all accounts..."
(
    sleep 30  # Wait for services to stabilize
    # Get all mail account IDs and sync them
    for account_id in $(php occ mail:account:export 2>/dev/null | grep -oP 'Account \K\d+' || true); do
        echo "Pre-syncing mail account $account_id..."
        php occ mail:account:sync "$account_id" 2>/dev/null || true
    done
    echo "✓ Background mail pre-sync completed"
) &

# Execute the original command
exec "$@"
