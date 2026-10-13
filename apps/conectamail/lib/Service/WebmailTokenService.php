<?php

namespace OCA\Roundcube\Service;

use OCP\IAppConfig;
use OCP\IConfig;
use OCP\IUserManager;

/**
 * SSO handover for the new webmail (webmail-avuz), kept fully separate from the
 * Roundcube flow: distinct URL (webmail_avuz_url), distinct HMAC secret
 * (webmail_avuz_sso_secret), distinct token format and audience.
 *
 * Token: base64url(payload).base64url(HMAC-SHA256(payload_segment, secret))
 *   payload = {v:1, jti, uid, email, enc_pass, app_password, iat, exp, aud:"webmail-avuz"}
 * enc_pass reuses the shared credential_key so the webmail decrypts it with
 * ROUNDCUBE_CREDENTIAL_KEY, exactly like Roundcube does. See
 * docs/card-532-webmail-sso.md for the validation contract.
 */
class WebmailTokenService
{
    private const APP_ID = 'conectamail';
    private const TOKEN_TTL = 60;
    private const AUDIENCE = 'webmail-avuz';

    public function __construct(
        private IConfig $config,
        private IAppConfig $appConfig,
        private IUserManager $userManager,
        private AppPasswordService $appPasswords,
    ) {}

    public function isConfigured(): bool
    {
        return $this->baseUrl() !== '' && $this->secret() !== '';
    }

    public function baseUrl(): string
    {
        return rtrim($this->appConfig->getValueString(self::APP_ID, 'webmail_avuz_url', (string) getenv('WEBMAIL_AVUZ_URL')), '/');
    }

    public function origin(): string
    {
        $parsed = parse_url($this->baseUrl());
        if (empty($parsed['host'])) {
            return '';
        }
        $origin = ($parsed['scheme'] ?? 'https') . '://' . $parsed['host'];
        if (!empty($parsed['port'])) {
            $origin .= ':' . $parsed['port'];
        }
        return $origin;
    }

    /**
     * Fresh SSO token for the user, or null when the feature is inert (URL or
     * secret unset) or the user has no stored mail password / email yet.
     */
    public function buildToken(string $userId): ?string
    {
        if (!$this->isConfigured()) {
            return null;
        }

        $encryptedPassword = $this->storedMailPassword($userId);
        if ($encryptedPassword === '') {
            return null;
        }

        $email = $this->resolveEmail($userId);
        if (!str_contains($email, '@')) {
            return null;
        }

        $appPassword = $this->appPasswords->getOrCreate($userId);
        if ($appPassword === null) {
            return null;
        }

        $now = time();
        $payload = [
            'v' => 1,
            'jti' => bin2hex(random_bytes(16)),
            'uid' => $userId,
            'email' => $email,
            'enc_pass' => $encryptedPassword,
            'app_password' => $appPassword,
            'iat' => $now,
            'exp' => $now + self::TOKEN_TTL,
            'aud' => self::AUDIENCE,
        ];

        $payloadSegment = $this->base64url((string) json_encode($payload));
        $signature = $this->base64url(hash_hmac('sha256', $payloadSegment, $this->secret(), true));

        return $payloadSegment . '.' . $signature;
    }

    /**
     * Embedded iframe URL. Falls back to the webmail root (its own login/prompt)
     * when no token can be minted, matching the Roundcube behaviour.
     */
    public function buildIframeUrl(string $userId): string
    {
        $baseUrl = $this->baseUrl();
        if ($baseUrl === '') {
            return '';
        }

        $token = $this->buildToken($userId);
        if ($token === null) {
            return $baseUrl . '/';
        }

        return $baseUrl . '/api/auth/sso?token=' . urlencode($token);
    }

    private function storedMailPassword(string $userId): string
    {
        $encrypted = $this->config->getUserValue($userId, self::APP_ID, 'email_enc_password', '');
        if ($encrypted !== '') {
            return $encrypted;
        }
        return $this->config->getUserValue($userId, self::APP_ID, 'enc_password', '');
    }

    private function resolveEmail(string $userId): string
    {
        $customEmail = $this->config->getUserValue($userId, self::APP_ID, 'email', '');
        if ($customEmail !== '') {
            return $customEmail;
        }

        return $this->userManager->get($userId)?->getEMailAddress() ?: '';
    }

    private function secret(): string
    {
        return $this->appConfig->getValueString(self::APP_ID, 'webmail_avuz_sso_secret', (string) getenv('WEBMAIL_AVUZ_SSO_SECRET'));
    }

    private function base64url(string $raw): string
    {
        return rtrim(strtr(base64_encode($raw), '+/', '-_'), '=');
    }
}
