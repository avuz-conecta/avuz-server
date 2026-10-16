<?php

namespace OCA\Roundcube\Service;

use OCP\IAppConfig;
use OCP\IConfig;
use OCP\IUserManager;

class CredentialService
{
    private const APP_ID = 'conectamail';
    private const TOKEN_TTL = 60;
    private const LOGIN_PASSWORD_KEY = 'enc_password';
    private const EMAIL_PASSWORD_KEY = 'email_enc_password';
    private const EMAIL_PASSWORD_UPDATED_AT_KEY = 'email_password_updated_at';
    public const EMAIL_PASSWORD_MAX_LENGTH = 256;

    public function __construct(
        private IConfig $config,
        private IAppConfig $appConfig,
        private IUserManager $userManager,
    ) {}

    public function storeCredentials(string $userId, string $password): void
    {
        $encrypted = $this->encryptPassword($password);
        $this->config->setUserValue($userId, self::APP_ID, self::LOGIN_PASSWORD_KEY, $encrypted);
    }

    /**
     * Logout drops only the login password captured at login. The mailbox
     * password is saved on purpose (personal settings / webmail prompt) and
     * stays until the user removes it.
     */
    public function clearLoginPassword(string $userId): void
    {
        $this->config->deleteUserValue($userId, self::APP_ID, self::LOGIN_PASSWORD_KEY);
    }

    /**
     * Error code for an unacceptable mailbox password, null when it is valid.
     */
    public function emailPasswordError(mixed $password): ?string
    {
        if (!is_string($password) || $password === '') {
            return 'password_required';
        }
        if (mb_strlen($password) > self::EMAIL_PASSWORD_MAX_LENGTH) {
            return 'password_too_long';
        }

        return null;
    }

    public function storeEmailPassword(string $userId, string $password): void
    {
        $encrypted = $this->encryptPassword($password);
        $this->config->setUserValue($userId, self::APP_ID, self::EMAIL_PASSWORD_KEY, $encrypted);
        $this->config->setUserValue($userId, self::APP_ID, self::EMAIL_PASSWORD_UPDATED_AT_KEY, (string) time());
    }

    public function clearEmailPassword(string $userId): void
    {
        $this->config->deleteUserValue($userId, self::APP_ID, self::EMAIL_PASSWORD_KEY);
        $this->config->deleteUserValue($userId, self::APP_ID, self::EMAIL_PASSWORD_UPDATED_AT_KEY);
    }

    /**
     * Whether a mailbox password is saved and when, never the value itself.
     * updated_at is null for passwords saved before it was tracked.
     *
     * @return array{saved: bool, updated_at: ?int}
     */
    public function emailPasswordStatus(string $userId): array
    {
        $saved = $this->config->getUserValue($userId, self::APP_ID, self::EMAIL_PASSWORD_KEY, '') !== '';
        if (!$saved) {
            return ['saved' => false, 'updated_at' => null];
        }

        $updatedAt = $this->config->getUserValue($userId, self::APP_ID, self::EMAIL_PASSWORD_UPDATED_AT_KEY, '');

        return ['saved' => true, 'updated_at' => $updatedAt === '' ? null : (int) $updatedAt];
    }

    public function getRoundcubeOrigin(): string
    {
        $baseUrl = rtrim($this->appConfig->getValueString(self::APP_ID, 'roundcube_url', ''), '/');
        $parsed = parse_url($baseUrl);
        $origin = ($parsed['scheme'] ?? 'https') . '://' . ($parsed['host'] ?? '');
        if (!empty($parsed['port'])) {
            $origin .= ':' . $parsed['port'];
        }
        return $origin;
    }

    public function buildIframeUrl(string $userId): string
    {
        $baseUrl = rtrim($this->appConfig->getValueString(self::APP_ID, 'roundcube_url', ''), '/');
        if (empty($baseUrl)) {
            return '';
        }

        $encryptedPassword = $this->config->getUserValue($userId, self::APP_ID, self::EMAIL_PASSWORD_KEY, '');
        if (empty($encryptedPassword)) {
            $encryptedPassword = $this->config->getUserValue($userId, self::APP_ID, self::LOGIN_PASSWORD_KEY, '');
        }
        if (empty($encryptedPassword)) {
            return $baseUrl . '/';
        }

        $email = $this->resolveEmail($userId);
        if (!str_contains($email, '@')) {
            return $baseUrl . '/';
        }

        $token = $this->buildToken($email, $encryptedPassword, $this->resolveProvider());

        return $baseUrl . '/?nc_token=' . urlencode($token);
    }

    private function resolveEmail(string $userId): string
    {
        $customEmail = $this->config->getUserValue($userId, self::APP_ID, 'email', '');
        if ($customEmail) {
            return $customEmail;
        }

        $user = $this->userManager->get($userId);
        $email = $user?->getEMailAddress();

        return $email ?: '';
    }

    private function resolveProvider(): string
    {
        $value = $this->appConfig->getValueString(self::APP_ID, 'provider', (string) getenv('ROUNDCUBE_PROVIDER'));
        return $value !== '' ? $value : 'zoho';
    }

    private function buildToken(string $email, string $encryptedPassword, string $provider): string
    {
        $payload = base64_encode((string) json_encode([
            'email' => $email,
            'enc_pass' => $encryptedPassword,
            'exp' => time() + self::TOKEN_TTL,
            'provider' => $provider,
        ]));
        $secret = $this->getSsoSecret();
        $signature = hash_hmac('sha256', $payload, $secret);

        return $payload . '.' . $signature;
    }

    private function encryptPassword(string $password): string
    {
        $key = $this->getCredentialKey();
        $iv = random_bytes(openssl_cipher_iv_length('AES-256-CBC'));
        $encrypted = openssl_encrypt(base64_encode($password), 'AES-256-CBC', $key, OPENSSL_RAW_DATA, $iv);

        return base64_encode(base64_encode($encrypted) . '|' . base64_encode($iv));
    }

    private function getSsoSecret(): string
    {
        return $this->appConfig->getValueString(self::APP_ID, 'sso_secret', (string) getenv('ROUNDCUBE_SSO_SECRET'));
    }

    private function getCredentialKey(): string
    {
        $raw = $this->appConfig->getValueString(self::APP_ID, 'credential_key', (string) getenv('ROUNDCUBE_CREDENTIAL_KEY'));
        return substr(hash('sha256', $raw, true), 0, 32);
    }
}
