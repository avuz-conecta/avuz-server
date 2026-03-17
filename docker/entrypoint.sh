#!/bin/bash
set -e

# Version stamp — bump this to force re-configuration on next restart
AVUZ_CONFIG_VERSION="33.0.0-1"
CONFIG_STAMP_FILE="/var/www/html/data/.avuz_configured"
UPGRADE_STATE_FILE="/var/www/html/data/.upgrade_pre_enabled_apps"

# App lists (used for install, upgrade disable/re-enable, and bundled-app enforcement)
BUNDLED_APPS=(
    "avuz_theme"
    "avuz_pdf_converter"
    "admin_audit"
    "comments"
    "contactsinteraction"
    "dashboard"
    "federatedfilesharing"
    "files_reminders"
    "files_sharing"
    "sharebymail"
    "systemtags"
    "twofactor_backupcodes"
    "updatenotification"
    "user_status"
    "files_versions"
    "weather_status"
    "files_trashbin"
    "theming"
)

APPSTORE_APPS=(
    "calendar"
    "contacts"
    "deck"
    "external"
    "forms"
    "spreed"
    "viewer"
    "bruteforcesettings"
    "files_downloadlimit"
    "quota_warning"
    "files_retention"
    "onlyoffice"
)

GIT_APPS_BRANCH="${GIT_APPS_BRANCH:-stable33}"
GIT_APPS=(
    "notifications:nextcloud/notifications"
    "text:nextcloud/text"
    "activity:nextcloud/activity"
    "twofactor_totp:nextcloud/twofactor_totp"
    "suspicious_login:nextcloud/suspicious_login"
    "logreader:nextcloud/logreader"
    "password_policy:nextcloud/password_policy"
)

# ──────────────────────────────────────────────
# Avuz configuration — runs on fresh install, after upgrade, or when config version changes
# All settings here are persisted in config.php or the DB, so they only need to run once.
# ──────────────────────────────────────────────
run_avuz_configuration() {
    echo "═══ Running Avuz Conecta configuration ═══"

    # Trusted domains & protocol
    echo "Configuring trusted domains..."
    php occ config:system:set trusted_domains 0 --value="$NEXTCLOUD_TRUSTED_DOMAINS"
    php occ config:system:set overwrite.cli.url --value="https://$NEXTCLOUD_TRUSTED_DOMAIN"
    if [ -n "$OVERWRITEPROTOCOL" ]; then
        php occ config:system:set overwriteprotocol --value="$OVERWRITEPROTOCOL"
    fi

    # Redis cache
    echo "Configuring Redis cache..."
    php occ config:system:set redis host --value="$REDIS_HOST"
    php occ config:system:set redis port --value=6379 --type=integer
    php occ config:system:set redis timeout --value=0.0 --type=float
    php occ config:system:set memcache.local --value='\OC\Memcache\Redis'
    php occ config:system:set memcache.locking --value='\OC\Memcache\Redis'
    php occ config:system:set filelocking.enabled --value=true --type=boolean

    # Locale & language
    echo "Configuring locale..."
    php occ config:system:set default_phone_region --value='BR'
    php occ config:system:set default_language --value='pt_BR'
    php occ config:system:set default_locale --value='pt_BR'
    php occ config:system:set force_language --value='pt_BR'

    # UI preferences
    php occ config:system:set knowledgebaseenabled --type=boolean --value=false
    php occ config:system:set skeletondirectory --value=''
    php occ config:system:set customclient_desktop --value='https://app3.avuz.cloud/index.php/s/m3KWdzQ5iAFTYXe'
    php occ config:system:set maintenance_window_start --value=1 --type=integer
    php occ config:system:set enforce_theme --value='light'
    php occ config:system:set simpleSignUpLink.shown --type=boolean --value=false
    php occ config:system:set mail_template_class --value='OCA\AvuzTheme\Mail\EMailTemplate'

    # Theming (name, colors, logos, favicon)
    echo "Configuring theming..."
    php occ theming:config name "Avuz Conecta"
    php occ theming:config url "https://$NEXTCLOUD_TRUSTED_DOMAIN"
    php occ theming:config primary_color "#1c7fa0"
    php occ theming:config background_color "#d2e314"
    php occ config:app:set theming productName --value="Avuz Conecta"
    php occ config:system:set theme --value='avuz'

    if [ -f /var/www/html/apps/avuz_theme/img/favicon-32.png ]; then
        php occ theming:config favicon /var/www/html/apps/avuz_theme/img/favicon-32.png || true
    fi
    if [ -f /var/www/html/apps/avuz_theme/img/logo2.png ]; then
        php occ theming:config logo /var/www/html/apps/avuz_theme/img/logo2.png || true
    fi
    if [ -f /var/www/html/apps/avuz_theme/img/house-logo.svg ]; then
        php occ theming:config logoheader /var/www/html/apps/avuz_theme/img/house-logo.svg || true
    fi

    # Talk defaults
    php occ config:app:set spreed create_samples --value="false"
    php occ config:app:set spreed changelog --value="no"

    # Mail app optimizations
    php occ config:system:set app.mail.imap.timeout --value=20 --type=integer
    php occ config:system:set app.mail.smtp.timeout --value=20 --type=integer
    php occ config:system:set app.mail.sieve.timeout --value=5 --type=integer
    php occ config:system:set app.mail.background-sync-interval --value=600 --type=integer

    # Trusted proxies
    php occ config:system:set trusted_proxies 0 --value='127.0.0.1'
    php occ config:system:set trusted_proxies 1 --value='::1'
    php occ config:system:set trusted_proxies 2 --value='10.50.100.100'

    # SMTP (conditional on env vars)
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
        echo "✓ SMTP configured"
    fi

    # OnlyOffice (conditional on env vars)
    if [ -n "$ONLYOFFICE_URL" ] && [ -n "$ONLYOFFICE_SECRET" ]; then
        echo "Configuring OnlyOffice..."
        php occ config:app:set onlyoffice DocumentServerUrl --value="$ONLYOFFICE_URL"
        php occ config:app:set onlyoffice jwt_secret --value="$ONLYOFFICE_SECRET"
        php occ config:app:set onlyoffice jwt_header --value="Authorization"
        php occ config:app:set onlyoffice defFormats --value='{"csv":"true","doc":"true","docm":"true","docx":"true","docxf":"true","dot":"true","dotm":"true","dotx":"true","epub":"true","fb2":"true","fodp":"true","fods":"true","fodt":"true","htm":"true","html":"true","hwp":"true","hwpx":"true","key":"true","md":"true","mht":"true","mhtml":"true","numbers":"true","odg":"true","odp":"true","ods":"true","odt":"true","otp":"true","ots":"true","ott":"true","oxps":"true","pages":"true","pdf":"true","pot":"true","potm":"true","potx":"true","pps":"true","ppsm":"true","ppsx":"true","ppt":"true","pptm":"true","pptx":"true","rtf":"true","stw":"true","sxc":"true","sxi":"true","sxw":"true","txt":"true","vsdm":"true","vssm":"true","vssx":"true","vstm":"true","vstx":"true","wps":"true","xls":"true","xlsb":"true","xlsm":"true","xlsx":"true","xlt":"true","xltm":"true","xltx":"true","xml":"true","xps":"true","djvu":"true"}'
        php occ config:app:set onlyoffice editFormats --value='{"csv":"true","odp":"true","ods":"true","odt":"true","rtf":"true","txt":"true","doc":"true","docm":"true","docx":"true","docxf":"true","dotx":"true","epub":"true","fb2":"true","html":"true","otp":"true","ots":"true","ott":"true","potm":"true","potx":"true","ppsm":"true","ppsx":"true","ppt":"true","pptm":"true","pptx":"true","xls":"true","xlsm":"true","xlsx":"true","xltm":"true","xltx":"true","htm":"true","fodt":"true","fods":"true","fodp":"true"}'
        echo "✓ OnlyOffice configured"
    fi

    # PDF Converter
    PDF_CONVERTER_FRONTEND_URL="${PDF_CONVERTER_FRONTEND_URL:-http://pdf-to-excel-frontend:80}"
    PDF_CONVERTER_BACKEND_URL="${PDF_CONVERTER_BACKEND_URL:-http://pdf-to-excel-backend:8000}"
    php occ config:app:set avuz_pdf_converter frontend_url --value="$PDF_CONVERTER_FRONTEND_URL"
    php occ config:app:set avuz_pdf_converter backend_url --value="$PDF_CONVERTER_BACKEND_URL"

    # Clear imagePath cache after theme changes
    redis-cli -h "$REDIS_HOST" EVAL "local keys = redis.call('keys', '*imagePath*'); for i=1,#keys do redis.call('del', keys[i]) end; return #keys" 0 || true

    # Database maintenance
    echo "Running database maintenance..."
    php occ db:add-missing-indices --no-interaction 2>/dev/null || true
    php occ maintenance:repair --include-expensive 2>/dev/null || true

    # Write stamp so we skip this on plain restarts
    echo "$AVUZ_CONFIG_VERSION" > "$CONFIG_STAMP_FILE"
    echo "═══ Avuz configuration complete ═══"
}

# ──────────────────────────────────────────────
# PHASE 1: Infrastructure (every restart)
# ──────────────────────────────────────────────

# Fix permissions for mounted volumes
echo "Fixing permissions..."
chown -R www-data:www-data /var/www/html/data /var/www/html/config /var/www/html/custom_apps 2>/dev/null || true
chmod -R 770 /var/www/html/data /var/www/html/config /var/www/html/custom_apps 2>/dev/null || true

# Redis
if [ -z "$REDIS_HOST" ] || [ "$REDIS_HOST" = "localhost" ] || [ "$REDIS_HOST" = "127.0.0.1" ]; then
    REDIS_HOST="127.0.0.1"
    echo "Using internal Redis server..."
    redis-server --bind 127.0.0.1 --port 6379 --daemonize yes --protected-mode no
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

# Wait for database
echo "Waiting for database..."
until PGPASSWORD=$POSTGRES_PASSWORD psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c '\q' 2>/dev/null; do
    sleep 2
done

# ──────────────────────────────────────────────
# PHASE 2: Install or upgrade
# ──────────────────────────────────────────────

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

NEEDS_CONFIGURATION=0

if [ "$NC_INSTALLED" -eq 0 ]; then
    # ── Fresh install ──
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

    php occ background:cron

    echo "Running mimetype migrations..."
    php occ maintenance:repair --include-expensive

    echo "Fixing permissions after installation..."
    chown -R www-data:www-data /var/www/html/config /var/www/html/data
    chmod -R 770 /var/www/html/config /var/www/html/data

    NEEDS_CONFIGURATION=1
else
    # ── Existing install ──
    echo "Fixing permissions on existing installation..."
    chown -R www-data:www-data /var/www/html/config
    chmod -R 770 /var/www/html/config

    # Force disable maintenance mode via config.php (before any occ commands)
    sed -i "s/'maintenance' => true/'maintenance' => false/g" /var/www/html/config/config.php 2>/dev/null || true

    # Fix potentially corrupted viewer app
    if [ ! -f /var/www/html/apps/viewer/appinfo/info.xml ]; then
        echo "Viewer app missing, downloading fresh copy..."
        rm -rf /var/www/html/apps/viewer 2>/dev/null || true
        curl -sL https://github.com/nextcloud/viewer/archive/refs/heads/stable33.tar.gz | tar xz -C /var/www/html/apps
        mv /var/www/html/apps/viewer-stable33 /var/www/html/apps/viewer
        chown -R www-data:www-data /var/www/html/apps/viewer
        echo "✓ Viewer app restored"
    fi

    # Recover from interrupted upgrade
    if [ -f "$UPGRADE_STATE_FILE" ]; then
        echo "Recovering from interrupted upgrade — re-enabling apps..."
        while IFS= read -r app; do
            php occ app:enable "$app" 2>/dev/null || echo "✗ Could not re-enable $app"
        done < "$UPGRADE_STATE_FILE"
        rm -f "$UPGRADE_STATE_FILE"
        echo "✓ Apps restored"
    fi

    # Check if upgrade is needed
    echo "Checking if Nextcloud needs upgrade..."
    if php occ status | grep -q "needsDbUpgrade: true"; then
        echo "Upgrading Nextcloud database..."

        # Persist enabled apps list to disk before disabling (survives crashes)
        php occ app:list --enabled 2>/dev/null | grep '  - ' | sed 's/  - \(.*\):.*/\1/' > "$UPGRADE_STATE_FILE"

        # Disable all managed apps before upgrade
        echo "Disabling apps for safe upgrade..."
        for app in "${BUNDLED_APPS[@]}" "${APPSTORE_APPS[@]}"; do
            php occ app:disable "$app" 2>/dev/null || true
        done

        php occ upgrade --no-interaction
        php occ maintenance:mode --off

        # Re-enable apps that were enabled before the upgrade
        echo "Re-enabling apps..."
        while IFS= read -r app; do
            php occ app:enable "$app" 2>/dev/null || echo "✗ Could not re-enable $app"
        done < "$UPGRADE_STATE_FILE"
        rm -f "$UPGRADE_STATE_FILE"

        echo "✓ Nextcloud database upgraded successfully"
        NEEDS_CONFIGURATION=1
    else
        echo "✓ Nextcloud is up to date"
    fi
fi

# Clean up snowflake temp dirs to avoid "not writable" errors (NC33 FileSequence bug)
rm -rf /tmp/sfi_file_sequence_* 2>/dev/null || true

# Verify Nextcloud is installed (|| true: occ status can exit non-zero with PHP warnings)
OCC_STATUS=$(php occ status 2>&1) || true
if ! echo "$OCC_STATUS" | grep -q "installed: true"; then
    echo "ERROR: Nextcloud is not installed. Cannot continue with configuration."
    echo "occ output: $OCC_STATUS"
    exit 1
fi
echo "✓ Nextcloud verified"

# ──────────────────────────────────────────────
# PHASE 3: Avuz configuration (only when needed)
# ──────────────────────────────────────────────

# Check if configuration needs to run:
# - fresh install (NEEDS_CONFIGURATION=1)
# - after upgrade (NEEDS_CONFIGURATION=1)
# - config version changed (new image deployed)
CURRENT_STAMP=$(cat "$CONFIG_STAMP_FILE" 2>/dev/null || echo "")
if [ "$NEEDS_CONFIGURATION" -eq 1 ] || [ "$CURRENT_STAMP" != "$AVUZ_CONFIG_VERSION" ]; then
    run_avuz_configuration
else
    echo "✓ Avuz configuration up to date ($AVUZ_CONFIG_VERSION), skipping"
fi

# ──────────────────────────────────────────────
# PHASE 4: Apps (only when needed)
# ──────────────────────────────────────────────

if [ "$NC_INSTALLED" -eq 0 ]; then
    # Fresh install — enable bundled apps, install App Store apps
    echo "Enabling bundled apps..."
    for app in "${BUNDLED_APPS[@]}"; do
        php occ app:enable "$app" || echo "Could not enable $app (might not be installed)"
    done

    echo "Installing apps from App Store..."
    for app in "${APPSTORE_APPS[@]}"; do
        if php occ app:list | grep -q "  - $app:"; then
            php occ app:enable "$app" 2>/dev/null || true
        else
            echo "→ Installing $app from App Store..."
            php occ app:install "$app" 2>/dev/null || echo "✗ Could not install $app"
        fi
    done
else
    # Existing install — only ensure bundled apps are enabled and missing apps are installed
    ENABLED_APPS=$(php occ app:list --enabled 2>/dev/null)
    ALL_APPS=$(php occ app:list 2>/dev/null)

    echo "Checking bundled apps..."
    for app in "${BUNDLED_APPS[@]}"; do
        if ! echo "$ENABLED_APPS" | grep -q "  - $app:"; then
            echo "→ Enabling bundled app $app..."
            php occ app:enable "$app" || echo "✗ Could not enable $app"
        fi
    done

    echo "Checking for missing App Store apps..."
    for app in "${APPSTORE_APPS[@]}"; do
        if ! echo "$ALL_APPS" | grep -q "  - $app:"; then
            echo "→ Installing missing app $app from App Store..."
            php occ app:install "$app" 2>/dev/null || echo "✗ Could not install $app"
        fi
    done
fi

# Git apps — clone only if missing, enable always
echo "Checking Git apps (branch: $GIT_APPS_BRANCH)..."
for entry in "${GIT_APPS[@]}"; do
    app_name="${entry%%:*}"
    repo="${entry#*:}"

    if [ ! -d "/var/www/html/apps/$app_name" ]; then
        echo "→ Cloning $app_name..."
        if git clone --depth 1 --branch "$GIT_APPS_BRANCH" "https://github.com/$repo.git" "/var/www/html/apps/$app_name" 2>/dev/null; then
            chown -R www-data:www-data "/var/www/html/apps/$app_name"
            chmod -R 755 "/var/www/html/apps/$app_name"
            echo "✓ $app_name cloned"
        else
            echo "✗ Could not clone $app_name (check branch $GIT_APPS_BRANCH)"
        fi
    fi
    php occ app:enable "$app_name" 2>/dev/null || true
done

# notify_push — install if missing
if ! php occ app:list | grep -q "  - notify_push:"; then
    php occ app:install notify_push 2>/dev/null || echo "✗ Could not install notify_push"
fi
php occ app:enable notify_push 2>/dev/null || true
chmod +x /var/www/html/apps/notify_push/bin/x86_64/notify_push 2>/dev/null || true
chmod +x /var/www/html/custom_apps/notify_push/bin/x86_64/notify_push 2>/dev/null || true

# ──────────────────────────────────────────────
# PHASE 5: Final (every restart)
# ──────────────────────────────────────────────

echo "Final permissions check..."
chown -R www-data:www-data /var/www/html/data /var/www/html/config /var/www/html/custom_apps
chmod -R 770 /var/www/html/data /var/www/html/config /var/www/html/custom_apps
echo "✓ Permissions set"

exec "$@"
