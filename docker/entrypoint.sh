#!/bin/bash
set -e

# Version stamp — bump this to force re-configuration on next restart
AVUZ_CONFIG_VERSION="33.0.0-9"
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

ENABLE_APPS=(
    "contacts"
    "viewer"
    "bruteforcesettings"
    "files_downloadlimit"
    "notifications"
    "text"
    "activity"
    "twofactor_totp"
    "suspicious_login"
    "logreader"
    "password_policy"
    "deck"
    "external"
    "spreed"
    "files_retention"
    "calendar"
    "forms"
    "quota_warning"
    "notify_push"
    "onlyoffice"
    "integration_openai"
)

# ──────────────────────────────────────────────
# Avuz configuration — runs on fresh install, after upgrade, or when config version changes
# All settings here are persisted in config.php or the DB, so they only need to run once.
# ──────────────────────────────────────────────
run_avuz_configuration() {
    echo "═══ Running Avuz Conecta configuration ═══"

    # Trusted domains & protocol
    # NEXTCLOUD_TRUSTED_DOMAINS accepts comma-separated list, each goes to its
    # own trusted_domains index. Required when serving NC under multiple host
    # names (e.g. public CF-proxied + DNS-only for Talk recording uploads).
    echo "Configuring trusted domains..."
    IFS=',' read -ra _avuz_trusted_domains <<< "$NEXTCLOUD_TRUSTED_DOMAINS"
    for _i in "${!_avuz_trusted_domains[@]}"; do
        _domain="${_avuz_trusted_domains[$_i]// /}"
        [ -z "$_domain" ] && continue
        php occ config:system:set trusted_domains "$_i" --value="$_domain"
    done
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

    # OIDC Identity Provider — install from App Store on first boot
    if ! php occ app:list --enabled 2>/dev/null | grep -q "oidc" && \
       ! [ -d /var/www/html/custom_apps/oidc ]; then
        echo "Installing OIDC Identity Provider from App Store..."
        php occ app:install oidc 2>/dev/null && echo "✓ OIDC app installed" || echo "✗ OIDC app install failed (no internet?)"
    else
        echo "✓ OIDC app already present"
    fi
    php occ app:enable oidc 2>/dev/null || true

    # Roundcube webmail integration
    if [ -n "$ROUNDCUBE_URL" ]; then
        echo "Configuring Roundcube integration..."
        php occ app:enable roundcube 2>/dev/null || true
        php occ config:app:set roundcube roundcube_url --value="$ROUNDCUBE_URL"
        php occ config:app:set roundcube sso_secret --value="$ROUNDCUBE_SSO_SECRET"
        php occ config:app:set roundcube credential_key --value="$ROUNDCUBE_CREDENTIAL_KEY"
        echo "✓ Roundcube configured"
    fi

    # Password policy — 8 char minimum, all complexity rules enabled
    php occ config:app:set password_policy minLength --value="8"
    php occ config:app:set password_policy enforceUpperLowerCase --value="1"
    php occ config:app:set password_policy enforceNumericCharacters --value="1"
    php occ config:app:set password_policy enforceSpecialCharacters --value="1"

    # Talk defaults
    php occ config:app:set spreed create_samples --value="false"
    php occ config:app:set spreed changelog --value="no"
    # Disable AI summary until M2 (LLM provider not deployed yet).
    # Transcription still runs if a Speech-to-Text provider is registered.
    php occ config:app:set spreed call_recording_summary --value="no"

    # ── Talk recording backend ──
    # Gated on TALK_RECORDING_URL + TALK_RECORDING_SECRET. Stored as
    # JSON in spreed:recording_servers (see Config::getRecordingServers()).
    if [ -n "$TALK_RECORDING_URL" ] && [ -n "$TALK_RECORDING_SECRET" ]; then
        echo "Configuring Talk recording backend..."
        TALK_RECORDING_VERIFY="${TALK_RECORDING_VERIFY:-true}"
        # Build JSON without jq (not present in image)
        php -r '
            $cfg = [
                "servers" => [[
                    "server" => $argv[1],
                    "verify" => filter_var($argv[2], FILTER_VALIDATE_BOOLEAN),
                ]],
                "secret" => $argv[3],
            ];
            echo json_encode($cfg);
        ' "$TALK_RECORDING_URL" "$TALK_RECORDING_VERIFY" "$TALK_RECORDING_SECRET" \
          | xargs -0 -I{} php occ config:app:set spreed recording_servers --value="{}"
        php occ config:app:set spreed call_recording --value="yes"
        echo "✓ Talk recording backend configured"
    else
        echo "→ TALK_RECORDING_URL/SECRET not set, skipping recording backend config"
    fi

    # ── AI providers via integration_openai (Groq / OpenAI / compatible) ──
    # integration_openai is a pure-PHP NC app (no Docker, no HaRP) that
    # implements core:audio2text (STT) and core:text2text:* (LLM) providers
    # against any OpenAI-compatible API. We point it at Groq for the pilot:
    # cheap (~$5/mo for 3h audio/day), high quality (whisper-large-v3 +
    # Llama 3.3 70B). Pivot-friendly: swap base URL + key to OpenAI / Azure /
    # OpenRouter without code changes.
    if [ -n "$AI_API_KEY" ]; then
        echo "Configuring AI provider (integration_openai)..."

        if ! php occ app:list --enabled 2>/dev/null | grep -q "  - integration_openai"; then
            echo "Installing integration_openai from App Store..."
            php occ app:install integration_openai 2>/dev/null && echo "✓ integration_openai installed" \
                || echo "✗ integration_openai install failed (no internet?)"
        else
            echo "✓ integration_openai already present"
        fi
        php occ app:enable --force integration_openai 2>/dev/null || true

        # Pilot defaults: LLM via OpenRouter (Anthropic Claude Haiku) + STT
        # via Fireworks AI (whisper-large-v3). Two providers via the split
        # AI_*/AI_STT_* env vars below. Override any of them to swap stacks.
        AI_BASE_URL="${AI_BASE_URL:-https://openrouter.ai/api/v1}"
        AI_LLM_MODEL="${AI_LLM_MODEL:-anthropic/claude-haiku-4-5}"
        AI_STT_BASE_URL="${AI_STT_BASE_URL:-https://api.fireworks.ai/inference/v1}"
        AI_STT_MODEL="${AI_STT_MODEL:-whisper-v3}"
        AI_STT_LANGUAGE="${AI_STT_LANGUAGE:-pt}"

        # Text/chat completions (used by core:text2text:summary etc.)
        php occ config:app:set integration_openai url --value="$AI_BASE_URL"
        php occ config:app:set integration_openai api_key --value="$AI_API_KEY"
        php occ config:app:set integration_openai default_completion_model_id --value="$AI_LLM_MODEL"
        php occ config:app:set integration_openai chat_endpoint_enabled --value="1"

        # Speech-to-text (used by core:audio2text). Independent provider:
        # AI_STT_BASE_URL + AI_STT_API_KEY required (Fireworks key, distinct
        # from the OpenRouter key used for AI_API_KEY above).
        php occ config:app:set integration_openai stt_url --value="$AI_STT_BASE_URL"
        php occ config:app:set integration_openai stt_api_key --value="${AI_STT_API_KEY:-$AI_API_KEY}"
        php occ config:app:set integration_openai default_stt_model_id --value="$AI_STT_MODEL"
        php occ config:app:set integration_openai stt_provider_enabled --value="1"
        php occ config:app:set integration_openai stt_language --value="$AI_STT_LANGUAGE"

        # Re-enable Talk AI summary now that LLM is wired up.
        php occ config:app:set spreed call_recording_summary --value="yes"

        echo "✓ AI provider configured (base=$AI_BASE_URL llm=$AI_LLM_MODEL stt=$AI_STT_MODEL)"
    else
        echo "→ AI_API_KEY not set, skipping AI provider config (Talk transcription disabled)"
    fi

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

    # Update App Store apps (custom_apps/) to latest compatible versions
    echo "Updating App Store apps..."
    php occ app:update --all 2>/dev/null || echo "✗ app:update --all failed (non-fatal)"

    # Ensure all managed apps are enabled — use --force for apps that
    # haven't declared support for this NC version yet (bruteforcesettings, notifications, text)
    echo "Ensuring managed apps are enabled..."
    for app in "${BUNDLED_APPS[@]}" "${ENABLE_APPS[@]}"; do
        php occ app:enable --force "$app" 2>/dev/null || echo "✗ Could not enable $app"
    done

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
        for app in "${BUNDLED_APPS[@]}" "${ENABLE_APPS[@]}"; do
            php occ app:disable "$app" 2>/dev/null || true
        done

        php occ upgrade --no-interaction
        php occ maintenance:mode --off

        # Update custom_apps (App Store apps) now that NC core is upgraded
        echo "Updating App Store apps..."
        php occ app:update --all 2>/dev/null || echo "✗ app:update --all failed (non-fatal)"

        # Re-enable apps that were enabled before the upgrade
        # --allow-unstable is required for apps that haven't declared NC33 support yet
        echo "Re-enabling apps..."
        while IFS= read -r app; do
            php occ app:enable --force "$app" 2>/dev/null || echo "✗ Could not re-enable $app"
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
# PHASE 4: Apps (fresh install only)
# ──────────────────────────────────────────────

# Only enable apps on fresh install — on restarts, respect whatever the admin set
if [ "$NC_INSTALLED" -eq 0 ]; then
    echo "Enabling apps..."
    for app in "${BUNDLED_APPS[@]}" "${ENABLE_APPS[@]}"; do
        php occ app:enable --force "$app" 2>/dev/null || echo "✗ Could not enable $app"
    done
fi

# notify_push binary permissions
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
