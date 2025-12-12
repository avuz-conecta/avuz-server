# ============================================
# Stage 1: Builder - Install dependencies and build
# ============================================
FROM php:8.3-fpm-alpine AS builder

# Install build dependencies
RUN apk add --no-cache --virtual .build-deps \
  autoconf \
  g++ \
  make \
  pkgconfig \
  freetype-dev \
  libjpeg-turbo-dev \
  libpng-dev \
  libwebp-dev \
  libzip-dev \
  icu-dev \
  libxml2-dev \
  openldap-dev \
  imagemagick-dev \
  librsvg-dev \
  postgresql-dev \
  gmp-dev \
  bzip2-dev \
  oniguruma-dev \
  curl-dev \
  openssl-dev \
  libmemcached-dev \
  zlib-dev \
  git \
  nodejs \
  npm

# Install runtime dependencies
RUN apk add --no-cache \
  freetype \
  libjpeg-turbo \
  libpng \
  libwebp \
  libzip \
  icu-libs \
  libxml2 \
  openldap \
  imagemagick \
  imagemagick-svg \
  librsvg \
  postgresql-libs \
  gmp \
  bzip2 \
  libmemcached-libs \
  zlib \
  libgomp

# Configure and install PHP extensions
RUN docker-php-ext-configure gd --with-freetype --with-jpeg --with-webp \
  && docker-php-ext-install -j$(nproc) \
  gd zip intl pdo pdo_pgsql pgsql opcache bcmath \
  gmp bz2 exif pcntl ldap sysvsem \
  && pecl install apcu redis \
  && pecl channel-update pecl.php.net \
  && pecl install imagick \
  && docker-php-ext-enable apcu redis imagick

# Install Composer
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

WORKDIR /var/www/html

# Copy dependency files
COPY composer.json composer.lock ./
COPY package.json package-lock.json ./

# Install dependencies
RUN composer install --no-dev --optimize-autoloader --no-scripts
RUN npm ci

# Copy source files
COPY . /var/www/html/

# Build frontend
RUN npm run build

# Clean up builder artifacts
RUN rm -rf node_modules/ \
  /root/.npm \
  /root/.cache \
  /root/.composer \
  .git

# Remove build dependencies
RUN apk del .build-deps

# ============================================
# Stage 2: Runtime - Minimal production image with Nginx
# ============================================
FROM php:8.3-fpm-alpine AS runtime

# Install only essential runtime packages
RUN apk add --no-cache \
  nginx \
  supervisor \
  postgresql-client \
  redis \
  ffmpeg \
  curl \
  bash \
  git \
  freetype \
  libjpeg-turbo \
  libpng \
  libwebp \
  libzip \
  icu-libs \
  libxml2 \
  openldap \
  imagemagick \
  imagemagick-svg \
  librsvg \
  postgresql-libs \
  gmp \
  bzip2 \
  libmemcached-libs \
  zlib \
  libgomp

# Copy PHP extensions from builder
COPY --from=builder /usr/local/lib/php/extensions/ /usr/local/lib/php/extensions/
COPY --from=builder /usr/local/etc/php/conf.d/ /usr/local/etc/php/conf.d/

# Configure PHP-FPM for performance
RUN { \
  echo '[www]'; \
  echo 'user = www-data'; \
  echo 'group = www-data'; \
  echo 'listen = 127.0.0.1:9000'; \
  echo 'pm = dynamic'; \
  echo 'pm.max_children = 50'; \
  echo 'pm.start_servers = 10'; \
  echo 'pm.min_spare_servers = 5'; \
  echo 'pm.max_spare_servers = 15'; \
  echo 'pm.max_requests = 500'; \
  echo 'pm.process_idle_timeout = 10s'; \
  echo 'catch_workers_output = yes'; \
  echo 'clear_env = no'; \
  } > /usr/local/etc/php-fpm.d/www.conf

# Configure PHP for Nextcloud with enhanced performance
RUN { \
  echo 'opcache.enable=1'; \
  echo 'opcache.interned_strings_buffer=32'; \
  echo 'opcache.max_accelerated_files=10000'; \
  echo 'opcache.memory_consumption=256'; \
  echo 'opcache.save_comments=1'; \
  echo 'opcache.revalidate_freq=60'; \
  echo 'opcache.jit=1255'; \
  echo 'opcache.jit_buffer_size=128M'; \
  echo 'opcache.validate_timestamps=0'; \
  } > /usr/local/etc/php/conf.d/opcache-recommended.ini

RUN { \
  echo 'memory_limit=512M'; \
  echo 'upload_max_filesize=10G'; \
  echo 'post_max_size=10G'; \
  echo 'max_execution_time=3600'; \
  echo 'max_input_time=3600'; \
  echo 'date.timezone=UTC'; \
  echo 'apc.enable_cli=1'; \
  echo 'expose_php=Off'; \
  } > /usr/local/etc/php/conf.d/nextcloud.ini

WORKDIR /var/www/html

# Copy built application from builder
COPY --from=builder --chown=www-data:www-data /var/www/html /var/www/html

# Create necessary directories with proper permissions
RUN mkdir -p /var/www/html/data \
  /var/www/html/config \
  /var/www/html/custom_apps \
  /var/log/supervisor \
  /run/nginx \
  /var/cache/nginx \
  && chown -R www-data:www-data /var/www/html \
  && chown -R www-data:www-data /var/cache/nginx \
  && chmod -R 770 /var/www/html/data \
  && chmod -R 770 /var/www/html/config \
  && chmod -R 770 /var/www/html/custom_apps \
  && find /var/www/html/apps -type d -exec chmod 755 {} \; \
  && find /var/www/html/apps -type f -exec chmod 644 {} \;

# Copy nginx, supervisor and entrypoint configs
COPY docker/nginx.conf /etc/nginx/nginx.conf
COPY docker/supervisor.conf /etc/supervisor/conf.d/supervisor.conf
COPY docker/entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/entrypoint.sh

# Expose port
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost/status.php || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["/usr/bin/supervisord", "-c", "/etc/supervisor/conf.d/supervisor.conf"]
