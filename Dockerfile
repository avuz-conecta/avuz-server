# Dockerfile for Nextcloud Development with PostgreSQL
FROM php:8.2-apache

# Install system dependencies
RUN apt-get update && apt-get install -y \
    libfreetype6-dev \
    libjpeg62-turbo-dev \
    libpng-dev \
    libwebp-dev \
    libzip-dev \
    libicu-dev \
    libxml2-dev \
    libldap2-dev \
    libmagickwand-dev \
    libpq-dev \
    libgmp-dev \
    libbz2-dev \
    libonig-dev \
    libcurl4-openssl-dev \
    libssl-dev \
    libmemcached-dev \
    zlib1g-dev \
    wget \
    unzip \
    git \
    cron \
    supervisor \
    ffmpeg \
    curl \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Configure PHP extensions
RUN docker-php-ext-configure gd --with-freetype --with-jpeg --with-webp \
    && docker-php-ext-install -j$(nproc) \
    gd \
    zip \
    intl \
    pdo \
    pdo_pgsql \
    pgsql \
    opcache \
    bcmath \
    gmp \
    bz2 \
    exif \
    pcntl \
    ldap \
    sysvsem

# Install APCu, Redis, and Imagick from PECL
RUN pecl install apcu redis imagick \
    && docker-php-ext-enable apcu redis imagick

# Install Composer
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer

# Install Node.js and npm (v24)
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g npm@11

# Enable Apache modules
RUN a2enmod rewrite headers env dir mime ssl

# Configure PHP for optimal Nextcloud performance
RUN { \
    echo 'opcache.enable=1'; \
    echo 'opcache.interned_strings_buffer=32'; \
    echo 'opcache.max_accelerated_files=10000'; \
    echo 'opcache.memory_consumption=256'; \
    echo 'opcache.save_comments=1'; \
    echo 'opcache.revalidate_freq=60'; \
    echo 'opcache.jit=1255'; \
    echo 'opcache.jit_buffer_size=128M'; \
    } > /usr/local/etc/php/conf.d/opcache-recommended.ini

RUN { \
    echo 'memory_limit=512M'; \
    echo 'upload_max_filesize=10G'; \
    echo 'post_max_size=10G'; \
    echo 'max_execution_time=3600'; \
    echo 'max_input_time=3600'; \
    echo 'date.timezone=UTC'; \
    } > /usr/local/etc/php/conf.d/nextcloud.ini

# Set working directory
WORKDIR /var/www/html

# Copy application files
COPY --chown=www-data:www-data . /var/www/html/

# Install PHP dependencies
RUN composer install --no-dev --optimize-autoloader

# Install Node dependencies and build frontend
RUN npm ci && npm run build

# Create necessary directories
RUN mkdir -p /var/www/html/data \
    /var/www/html/custom_apps \
    && chown -R www-data:www-data /var/www/html

# Configure cron for background jobs
COPY docker/cron.conf /etc/supervisor/conf.d/cron.conf

# Add custom entrypoint
COPY docker/entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/entrypoint.sh

# Expose port
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD curl -f http://localhost/status.php || exit 1

# Set entrypoint and command
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["apache2-foreground"]
