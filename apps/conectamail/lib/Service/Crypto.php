<?php

namespace OCA\Roundcube\Service;

use OCP\IAppConfig;

/**
 * AES-256-CBC with the shared `credential_key` (env ROUNDCUBE_CREDENTIAL_KEY).
 *
 * Byte-for-byte compatible with CredentialService::encryptPassword so the
 * webmail can decrypt `enc_pass` with the same key. Kept separate from
 * CredentialService (which stays unchanged for the Roundcube flow); this adds
 * the decrypt half needed to read back the stored CardDAV app password.
 */
class Crypto
{
    private const APP_ID = 'conectamail';

    public function __construct(private IAppConfig $appConfig) {}

    public function encrypt(string $plain): string
    {
        $key = $this->key();
        $iv = random_bytes(openssl_cipher_iv_length('AES-256-CBC'));
        $encrypted = openssl_encrypt(base64_encode($plain), 'AES-256-CBC', $key, OPENSSL_RAW_DATA, $iv);

        return base64_encode(base64_encode($encrypted) . '|' . base64_encode($iv));
    }

    public function decrypt(string $blob): string
    {
        $decoded = base64_decode($blob, true);
        if ($decoded === false || !str_contains($decoded, '|')) {
            return '';
        }

        [$encryptedBase64, $ivBase64] = explode('|', $decoded, 2);
        $encrypted = base64_decode($encryptedBase64, true);
        $iv = base64_decode($ivBase64, true);
        if ($encrypted === false || $iv === false) {
            return '';
        }

        $plainBase64 = openssl_decrypt($encrypted, 'AES-256-CBC', $this->key(), OPENSSL_RAW_DATA, $iv);
        if ($plainBase64 === false) {
            return '';
        }

        $plain = base64_decode($plainBase64, true);

        return $plain === false ? '' : $plain;
    }

    private function key(): string
    {
        $raw = $this->appConfig->getValueString(self::APP_ID, 'credential_key', (string) getenv('ROUNDCUBE_CREDENTIAL_KEY'));
        return substr(hash('sha256', $raw, true), 0, 32);
    }
}
