<?php
declare(strict_types=1);
namespace OCA\Roundcube\Service;

class SignatureException extends \RuntimeException {}

class SignatureVerifier {
    private const MAX_AGE = 300;

    public function __construct(private string $secret) {}

    /** @return array{email:string,iat:int,ics_sha256:string} */
    public function verify(string $envelope, string $body): array {
        if ($this->secret === '') {
            throw new SignatureException('missing secret');
        }
        $dot = strrpos($envelope, '.');
        if ($dot === false) {
            throw new SignatureException('malformed envelope');
        }
        $encoded = substr($envelope, 0, $dot);
        $sig = substr($envelope, $dot + 1);
        $expected = hash_hmac('sha256', $encoded, $this->secret);
        if (!hash_equals($expected, $sig)) {
            throw new SignatureException('bad signature');
        }
        $json = base64_decode(strtr($encoded, '-_', '+/'), true);
        $payload = $json === false ? null : json_decode($json, true);
        if (!is_array($payload) || !isset($payload['email'], $payload['iat'], $payload['ics_sha256'])) {
            throw new SignatureException('bad payload');
        }
        if (abs(time() - (int) $payload['iat']) > self::MAX_AGE) {
            throw new SignatureException('expired');
        }
        if (!hash_equals((string) $payload['ics_sha256'], hash('sha256', $body))) {
            throw new SignatureException('body mismatch');
        }
        return ['email'=>(string)$payload['email'],'iat'=>(int)$payload['iat'],'ics_sha256'=>(string)$payload['ics_sha256']];
    }
}
