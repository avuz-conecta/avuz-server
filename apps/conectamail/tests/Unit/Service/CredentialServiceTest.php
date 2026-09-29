<?php
namespace OCA\Roundcube\Tests\Unit\Service;
use OCA\Roundcube\Service\CredentialService;
use OCP\IAppConfig;
use OCP\IConfig;
use OCP\IUser;
use OCP\IUserManager;
use PHPUnit\Framework\TestCase;

class CredentialServiceTest extends TestCase {
    private const SSO_SECRET = 'plain-sso-secret';
    private const CREDENTIAL_KEY = 'plain-credential-key';
    private const ROUNDCUBE_URL = 'https://webmail.example';

    protected function setUp(): void {
        if (!interface_exists('OCP\\IAppConfig')) {
            $this->markTestSkipped('requires Nextcloud environment');
        }
    }

    /**
     * Mirrors Nextcloud with the secrets stored `--sensitive`: IAppConfig
     * decrypts, the legacy IConfig::getAppValue returns the raw ciphertext.
     */
    private function service(array $userValues = []): CredentialService {
        $appValues = [
            'roundcube_url' => self::ROUNDCUBE_URL,
            'sso_secret' => self::SSO_SECRET,
            'credential_key' => self::CREDENTIAL_KEY,
        ];
        $appConfig = $this->createMock(IAppConfig::class);
        $appConfig->method('getValueString')->willReturnCallback(
            fn (string $app, string $key, string $default = '') => $appValues[$key] ?? $default
        );

        $config = $this->createMock(IConfig::class);
        $config->method('getAppValue')->willReturnCallback(
            fn (string $app, string $key, $default = '') => '$AppConfigEncryption$ciphertext-of-' . $key
        );
        $config->method('getUserValue')->willReturnCallback(
            fn (string $userId, string $app, string $key, $default = '') => $userValues[$key] ?? $default
        );

        $user = $this->createMock(IUser::class);
        $user->method('getEMailAddress')->willReturn('ana@example.com');
        $userManager = $this->createMock(IUserManager::class);
        $userManager->method('get')->willReturn($user);

        return new CredentialService($config, $appConfig, $userManager);
    }

    private static function decrypt(string $blob): string {
        $key = substr(hash('sha256', self::CREDENTIAL_KEY, true), 0, 32);
        [$cipherText, $iv] = array_map('base64_decode', explode('|', base64_decode($blob), 2));
        return (string) base64_decode((string) openssl_decrypt($cipherText, 'AES-256-CBC', $key, OPENSSL_RAW_DATA, $iv));
    }

    public function testSignsSsoTokenWithDecryptedSecret(): void {
        $url = $this->service(['enc_password' => 'stored-blob'])->buildIframeUrl('ana');

        parse_str((string) parse_url($url, PHP_URL_QUERY), $query);
        [$payload, $signature] = explode('.', $query['nc_token'], 2);
        $this->assertStringStartsWith(self::ROUNDCUBE_URL . '/?nc_token=', $url);
        $this->assertSame(hash_hmac('sha256', $payload, self::SSO_SECRET), $signature);
    }

    public function testEncryptsStoredPasswordWithDecryptedCredentialKey(): void {
        $stored = null;
        $config = $this->createMock(IConfig::class);
        $config->method('setUserValue')->willReturnCallback(
            function (string $userId, string $app, string $key, $value) use (&$stored) { $stored = $value; }
        );
        $appConfig = $this->createMock(IAppConfig::class);
        $appConfig->method('getValueString')->willReturnCallback(
            fn (string $app, string $key, string $default = '') => $key === 'credential_key' ? self::CREDENTIAL_KEY : $default
        );

        (new CredentialService($config, $appConfig, $this->createMock(IUserManager::class)))
            ->storeCredentials('ana', 's3cret-pass');

        $this->assertSame('s3cret-pass', self::decrypt((string) $stored));
    }
}
