<?php

namespace OCA\Roundcube\Service;

use OCP\IConfig;
use OCP\IUserManager;

class CredentialService
{
    private const APP_ID = 'roundcube';
    private const TOKEN_TTL = 60;

    public function __construct(
        private IConfig $config,
        private IUserManager $userManager,
    ) {}

    public function storeCredentials(string $userId, string $password): void
    {
        $encrypted = $this->encryptPassword($password);
        $this->config->setUserValue($userId, self::APP_ID, 'enc_password', $encrypted);
    }

    public function clearCredentials(string $userId): void
    {
        $this->config->deleteUserValue($userId, self::APP_ID, 'enc_password');
        $this->config->deleteUserValue($userId, self::APP_ID, 'email_enc_password');
    }

    public function storeEmailPassword(string $userId, string $password): void
    {
        $encrypted = $this->encryptPassword($password);
        $this->config->setUserValue($userId, self::APP_ID, 'email_enc_password', $encrypted);
    }

    public function getRoundcubeOrigin(): string
    {
        $baseUrl = rtrim($this->config->getAppValue(self::APP_ID, 'roundcube_url', ''), '/');
        $parsed = parse_url($baseUrl);
        $origin = ($parsed['scheme'] ?? 'https') . '://' . ($parsed['host'] ?? '');
        if (!empty($parsed['port'])) {
            $origin .= ':' . $parsed['port'];
        }
        return $origin;
    }

    public function buildIframeUrl(string $userId): string
    {
        $baseUrl = rtrim($this->config->getAppValue(self::APP_ID, 'roundcube_url', ''), '/');
        if (empty($baseUrl)) {
            return '';
        }

        $encryptedPassword = $this->config->getUserValue($userId, self::APP_ID, 'email_enc_password', '');
        if (empty($encryptedPassword)) {
            $encryptedPassword = $this->config->getUserValue($userId, self::APP_ID, 'enc_password', '');
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
        $value = $this->config->getAppValue(self::APP_ID, 'provider', (string) getenv('ROUNDCUBE_PROVIDER'));
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
        return $this->config->getAppValue(self::APP_ID, 'sso_secret', (string) getenv('ROUNDCUBE_SSO_SECRET'));
    }

    private function getCredentialKey(): string
    {
        $raw = $this->config->getAppValue(self::APP_ID, 'credential_key', (string) getenv('ROUNDCUBE_CREDENTIAL_KEY'));
        return substr(hash('sha256', $raw, true), 0, 32);
    }
}
