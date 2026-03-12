#!/bin/bash
set -e

# Define app lists (used for both disabling during upgrade and enabling after)
BUNDLED_APPS=(
    "avuz_theme"
    "avuz_pdf_converter"
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
    "viewer"
    "bruteforcesettings"
    "files_downloadlimit"
    "twofactor_totp"
    "suspicious_login"
    "logreader"
    "password_policy"
)

APPSTORE_APPS=(
    "deck"
    "forms"
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

# Check if Nextcloud is installed
echo "Checking Nextcloud installation status..."
if [ -f /var/www/html/config/config.php ] && grep -q "'installed' => true" /var/www/html/config/config.php 2>/dev/null; then
    echo "✓ Nextcloud is already installed (config.php found)"
    NC_INSTALLED=1
elif php occ status 2>/dev/null | grep -q "installed: true"; then
    echo "✓ Nextcloud is already installed"
    NC_INSTALLED=1
else
    echo "Nextcloud is not installed yet"
    NC_INSTALLED=0
fi

if [ "$NC_INSTALLED" -eq 0 ]; then
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
    chown -R www-data:www-data /var/www/html/config /var/www/html/data
    chmod -R 770 /var/www/html/config /var/www/html/data
else
    # Ensure permissions are correct on existing installation
    echo "Fixing permissions on existing installation..."
    chown -R www-data:www-data /var/www/html/config
    chmod -R 770 /var/www/html/config

    # Force disable maintenance mode via config.php (before any occ commands)
    echo "Forcing maintenance mode off..."
    sed -i "s/'maintenance' => true/'maintenance' => false/g" /var/www/html/config/config.php 2>/dev/null || true

    # Fix potentially corrupted viewer app by downloading fresh copy
    echo "Checking viewer app integrity..."
    if [ ! -f /var/www/html/apps/viewer/appinfo/info.xml ]; then
        echo "Viewer app missing or corrupted, downloading fresh copy..."
        rm -rf /var/www/html/apps/viewer 2>/dev/null || true
        cd /var/www/html/apps
        curl -sL https://github.com/nextcloud/viewer/archive/refs/heads/stable32.tar.gz | tar xz
        mv viewer-stable32 viewer
        chown -R www-data:www-data /var/www/html/apps/viewer
        echo "✓ Viewer app restored"
    fi

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

# Verify Nextcloud is installed before continuing with configuration
if ! php occ status 2>/dev/null | grep -q "installed: true"; then
    echo "ERROR: Nextcloud is not installed. Cannot continue with configuration."
    echo "Check the database connection and installation logs above."
    exit 1
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

# Hide "Help & privacy" from user menu (knowledgebase)
echo "Hiding Help & privacy menu..."
php occ config:system:set knowledgebaseenabled --type=boolean --value=false

# Disable skeleton files (welcome.txt) for new users
echo "Disabling skeleton files for new users..."
php occ config:system:set skeletondirectory --value=''

# Custom client download URL for welcome email
echo "Setting custom client download URL..."
php occ config:system:set customclient_desktop --value='https://app3.avuz.cloud/index.php/s/m3KWdzQ5iAFTYXe'

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
    echo "→ Setting favicon..."
    php occ theming:config favicon /var/www/html/apps/avuz_theme/img/favicon-32.png && echo "✓ Favicon configured" || echo "✗ Favicon configuration failed"
else
    echo "✗ Favicon file not found: /var/www/html/apps/avuz_theme/img/favicon-32.png"
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

# Enable/install apps only on fresh install to respect admin's app preferences.
# On existing installations, apps stay in whatever state the admin set them to.
if [ "$NC_INSTALLED" -eq 0 ]; then
    echo "Enabling bundled apps..."
    for app in "${BUNDLED_APPS[@]}"; do
        echo "Enabling $app..."
        php occ app:enable "$app" || echo "Could not enable $app (might not be installed)"
    done

    echo "Installing apps from App Store..."
    for app in "${APPSTORE_APPS[@]}"; do
        if php occ app:list | grep -q "  - $app:"; then
            echo "✓ $app already installed"
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
else
    # On existing installs, get enabled and disabled app lists separately
    ENABLED_APPS=$(php occ app:list --enabled 2>/dev/null)
    ALL_APPS=$(php occ app:list 2>/dev/null)

    # Enable bundled apps if not already enabled (respects admin disabling App Store apps,
    # but bundled apps should always be enabled since they're part of our image)
    echo "Checking bundled apps..."
    for app in "${BUNDLED_APPS[@]}"; do
        if ! echo "$ENABLED_APPS" | grep -q "  - $app:"; then
            echo "→ Enabling bundled app $app..."
            php occ app:enable "$app" || echo "✗ Could not enable $app"
        fi
    done

    # Install missing App Store apps (don't re-enable disabled ones)
    echo "Checking for missing App Store apps..."
    for app in "${APPSTORE_APPS[@]}"; do
        if ! echo "$ALL_APPS" | grep -q "  - $app:"; then
            echo "→ Installing missing app $app from App Store..."
            php occ app:install "$app" 2>/dev/null || echo "✗ Could not install $app"
        fi
    done
fi

# Install apps from Git (not available in App Store)
# Format: "app_name:github_org/repo"
GIT_APPS_BRANCH="${GIT_APPS_BRANCH:-stable32}"
GIT_APPS=(
    "notifications:nextcloud/notifications"
    "text:nextcloud/text"
)

echo "Installing apps from Git (branch: $GIT_APPS_BRANCH)..."
for entry in "${GIT_APPS[@]}"; do
    app_name="${entry%%:*}"
    repo="${entry#*:}"

    if [ ! -d "/var/www/html/apps/$app_name" ]; then
        echo "→ Cloning $app_name..."
        if git clone --depth 1 --branch "$GIT_APPS_BRANCH" "https://github.com/$repo.git" "/var/www/html/apps/$app_name" 2>/dev/null; then
            chown -R www-data:www-data "/var/www/html/apps/$app_name"
            chmod -R 755 "/var/www/html/apps/$app_name"
            echo "✓ $app_name cloned successfully"
        else
            echo "✗ Could not clone $app_name (check branch $GIT_APPS_BRANCH)"
        fi
    else
        echo "✓ $app_name already exists"
    fi
    php occ app:enable "$app_name" 2>/dev/null || true
done

# Configure Nextcloud logos
echo "Configuring Nextcloud logos..."
# Main logo (login page, etc.)
if [ -f /var/www/html/apps/avuz_theme/img/logo2.png ]; then
    echo "→ Setting main logo..."
    php occ theming:config logo /var/www/html/apps/avuz_theme/img/logo2.png && echo "✓ Main logo configured" || echo "✗ Logo configuration failed"
else
    echo "✗ Logo file not found: /var/www/html/apps/avuz_theme/img/logo2.png"
fi
# Header logo (small icon in top bar)
if [ -f /var/www/html/apps/avuz_theme/img/house-logo.svg ]; then
    echo "→ Setting header logo..."
    php occ theming:config logoheader /var/www/html/apps/avuz_theme/img/house-logo.svg && echo "✓ Header logo configured" || echo "✗ Header logo configuration failed"
else
    echo "✗ Header logo file not found: /var/www/html/apps/avuz_theme/img/house-logo.svg"
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

# Configure PDF Converter app
PDF_CONVERTER_FRONTEND_URL="${PDF_CONVERTER_FRONTEND_URL:-http://pdf-to-excel-frontend:80}"
PDF_CONVERTER_BACKEND_URL="${PDF_CONVERTER_BACKEND_URL:-http://pdf-to-excel-backend:8000}"
echo "Configuring PDF Converter app..."
php occ config:app:set avuz_pdf_converter frontend_url --value="$PDF_CONVERTER_FRONTEND_URL"
php occ config:app:set avuz_pdf_converter backend_url --value="$PDF_CONVERTER_BACKEND_URL"
echo "✓ PDF Converter configured (frontend: $PDF_CONVERTER_FRONTEND_URL, backend: $PDF_CONVERTER_BACKEND_URL)"

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
    for account_id in $(php occ mail:account:export 2>/dev/null | sed -n 's/.*Account \([0-9]*\).*/\1/p' || true); do
        echo "Pre-syncing mail account $account_id..."
        php occ mail:account:sync "$account_id" 2>/dev/null || true
    done
    echo "✓ Background mail pre-sync completed"
) &

# Final permissions fix before starting services
echo "Final permissions check..."
chown -R www-data:www-data /var/www/html/data /var/www/html/config /var/www/html/custom_apps
chmod -R 770 /var/www/html/data /var/www/html/config /var/www/html/custom_apps
echo "✓ Permissions set"

# Execute the original command
exec "$@"
