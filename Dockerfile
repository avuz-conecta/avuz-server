# ============================================
# App image - uses pre-built base image
# Fast builds - only rebuilds when code changes
# ============================================
ARG BASE_IMAGE=avuzconecta-base:latest
FROM ${BASE_IMAGE} AS builder

WORKDIR /var/www/html

# Copy dependency files and build scripts for better caching
COPY composer.json composer.lock ./
COPY package.json package-lock.json ./
COPY build/ build/

# Install dependencies
RUN composer install --no-dev --optimize-autoloader --no-scripts
RUN npm ci

# Copy source files
COPY . /var/www/html/

# NB: integration_openai is a version-pinned fork shipped as a git submodule at
# apps/integration_openai (NOT an App Store app, NOT an overlay). It arrives via
# the COPY above; the version pin in its appinfo/info.xml keeps
# `occ app:update --all` from replacing it. Submodules must be initialized in the
# working tree before build (see CLAUDE.md).

# Apply Avuz spreed overlay (chunked recording upload patches).
# Each file under docker/overlays/spreed/ is a full replacement for the same
# relative path under apps/spreed/. Net-new files are added by the same cp -R.
RUN cp -R /var/www/html/docker/overlays/spreed/. /var/www/html/apps/spreed/

# Apply Avuz files_downloadlimit overlay (restores templates/admin.php that
# upstream 2.0.0 tarball drops — GH issue nextcloud/files_downloadlimit#421).
# Without it the Sharing admin page returns 500 with TemplateNotFoundException.
RUN cp -R /var/www/html/docker/overlays/files_downloadlimit/. /var/www/html/apps/files_downloadlimit/

# Clean old compiled bundles and rebuild frontend
RUN npm run build

# Clean up build artifacts
RUN rm -rf node_modules/ /root/.npm /root/.cache /root/.composer .git

# Override maintenance template (must happen before permissions are set)
RUN cp -f apps/avuz_theme/templates/update.user.php core/templates/update.user.php

# Merge bundled app translations with Avuz theme overrides (apps/ and core/)
# App Store apps (custom_apps/) are merged at runtime in entrypoint.sh after installation
RUN chmod +x scripts/merge-l10n.sh && scripts/merge-l10n.sh /var/www/html /var/www/html/themes/avuz

# Set correct permissions on all app files in builder stage
# This avoids a duplicate ~1.8GB layer in the runtime stage from re-chowning/chmoding
RUN find /var/www/html/apps -type d -exec chmod 755 {} \; \
  && find /var/www/html/apps -type f -exec chmod 644 {} \; \
  && find /var/www/html/themes -type d -exec chmod 755 {} \; \
  && find /var/www/html/themes -type f -exec chmod 644 {} \;

# ============================================
# Final runtime image
# ============================================
ARG BASE_IMAGE
FROM ${BASE_IMAGE} AS runtime

WORKDIR /var/www/html

# Single COPY with correct ownership — no further RUN touches /var/www/html files
COPY --from=builder --chown=www-data:www-data /var/www/html /var/www/html

# Create runtime dirs (empty, tiny — no duplicate layer bloat)
RUN mkdir -p /var/www/html/data \
  /var/www/html/config \
  /var/www/html/custom_apps \
  && chmod 770 /var/www/html/data \
  && chmod 770 /var/www/html/config \
  && chmod 770 /var/www/html/custom_apps \
  && chown www-data:www-data /var/www/html/data \
  && chown www-data:www-data /var/www/html/config \
  && chown www-data:www-data /var/www/html/custom_apps

# Copy merge-l10n script for runtime use (custom_apps translations)
COPY scripts/merge-l10n.sh /usr/local/bin/merge-l10n.sh
RUN chmod +x /usr/local/bin/merge-l10n.sh

# Copy configs
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/supervisor.conf /etc/supervisor/conf.d/supervisor.conf
COPY docker/entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost/status.php || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisor.conf"]
