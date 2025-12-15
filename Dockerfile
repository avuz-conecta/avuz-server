# ============================================
# App image - uses pre-built base image
# Fast builds - only rebuilds when code changes
# ============================================
ARG REGISTRY=10.50.100.103:8080
ARG ORG=admin
FROM ${REGISTRY}/${ORG}/avuzconecta-base:latest AS builder

WORKDIR /var/www/html

# Copy dependency files first for better caching
COPY composer.json composer.lock ./
COPY package.json package-lock.json ./

# Install dependencies
RUN composer install --no-dev --optimize-autoloader --no-scripts
RUN npm ci

# Copy source files
COPY . /var/www/html/

# Build frontend
RUN npm run build

# Clean up build artifacts
RUN rm -rf node_modules/ /root/.npm /root/.cache /root/.composer .git

# ============================================
# Final runtime image
# ============================================
FROM ${REGISTRY}/${ORG}/avuzconecta-base:latest AS runtime

WORKDIR /var/www/html

# Copy built application
COPY --from=builder --chown=www-data:www-data /var/www/html /var/www/html

# Create necessary directories with proper permissions
RUN mkdir -p /var/www/html/data \
  /var/www/html/config \
  /var/www/html/custom_apps \
  && chown -R www-data:www-data /var/www/html \
  && chmod -R 770 /var/www/html/data \
  && chmod -R 770 /var/www/html/config \
  && chmod -R 770 /var/www/html/custom_apps \
  && find /var/www/html/apps -type d -exec chmod 755 {} \; \
  && find /var/www/html/apps -type f -exec chmod 644 {} \;

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
