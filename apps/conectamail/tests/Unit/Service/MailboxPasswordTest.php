<?php
namespace OCA\Roundcube\Tests\Unit\Service;
use OCA\Roundcube\Service\AppPasswordService;
use OCA\Roundcube\Service\CredentialService;
use OCA\Roundcube\Service\WebmailTokenService;
use OCP\IAppConfig;
use OCP\IConfig;
use OCP\IUser;
use OCP\IUserManager;
use PHPUnit\Framework\TestCase;

class MailboxPasswordTest extends TestCase {
    private const CREDENTIAL_KEY = 'plain-credential-key';
    private const WEBMAIL_SECRET = 'plain-webmail-secret';

    /** @var array<string, string> */
    private array $userValues = [];
    private CredentialService $credentials;
    private WebmailTokenService $webmail;

    protected function setUp(): void {
        if (!interface_exists('OCP\\IAppConfig')) {
            $this->markTestSkipped('requires Nextcloud environment');
        }

        $this->userValues = [];
        $config = $this->createMock(IConfig::class);
        $config->method('getUserValue')->willReturnCallback(
            fn (string $userId, string $app, string $key, $default = '') => $this->userValues[$key] ?? $default
        );
        $config->method('setUserValue')->willReturnCallback(
            function (string $userId, string $app, string $key, $value) { $this->userValues[$key] = (string) $value; }
        );
        $config->method('deleteUserValue')->willReturnCallback(
            function (string $userId, string $app, string $key) { unset($this->userValues[$key]); }
        );

        $appValues = [
            'credential_key' => self::CREDENTIAL_KEY,
            'webmail_avuz_url' => 'https://webmail.example',
            'webmail_avuz_sso_secret' => self::WEBMAIL_SECRET,
        ];
        $appConfig = $this->createMock(IAppConfig::class);
        $appConfig->method('getValueString')->willReturnCallback(
            fn (string $app, string $key, string $default = '') => $appValues[$key] ?? $default
        );

        $user = $this->createMock(IUser::class);
        $user->method('getEMailAddress')->willReturn('ana@example.com');
        $userManager = $this->createMock(IUserManager::class);
        $userManager->method('get')->willReturn($user);

        $appPasswords = $this->createMock(AppPasswordService::class);
        $appPasswords->method('getOrCreate')->willReturn('app-password');

        $this->credentials = new CredentialService($config, $appConfig, $userManager);
        $this->webmail = new WebmailTokenService($config, $appConfig, $userManager, $appPasswords);
    }

    private static function decrypt(string $blob): string {
        $key = substr(hash('sha256', self::CREDENTIAL_KEY, true), 0, 32);
        [$cipherText, $iv] = array_map('base64_decode', explode('|', base64_decode($blob), 2));
        return (string) base64_decode((string) openssl_decrypt($cipherText, 'AES-256-CBC', $key, OPENSSL_RAW_DATA, $iv));
    }

    /** @return array<string, mixed> */
    private function tokenPayload(): array {
        [$payloadSegment] = explode('.', (string) $this->webmail->buildToken('ana'), 2);
        return json_decode(base64_decode(strtr($payloadSegment, '-_', '+/')), true);
    }

    public function testReportsNoPasswordSavedForNewUser(): void {
        $this->assertSame(['saved' => false, 'updated_at' => null], $this->credentials->emailPasswordStatus('ana'));
    }

    public function testReportsSavedPasswordWithUpdateTimeButNoValue(): void {
        $this->credentials->storeEmailPassword('ana', 'mailbox-secret');

        $status = $this->credentials->emailPasswordStatus('ana');

        $this->assertTrue($status['saved']);
        $this->assertEqualsWithDelta(time(), $status['updated_at'], 5);
        $this->assertSame(['saved', 'updated_at'], array_keys($status));
    }

    public function testReportsSavedPasswordStoredBeforeUpdateTimeWasTracked(): void {
        $this->userValues['email_enc_password'] = 'legacy-blob';

        $this->assertSame(['saved' => true, 'updated_at' => null], $this->credentials->emailPasswordStatus('ana'));
    }

    public function testReplacesSavedPassword(): void {
        $this->credentials->storeEmailPassword('ana', 'old-secret');
        $this->credentials->storeEmailPassword('ana', 'new-secret');

        $this->assertSame('new-secret', self::decrypt($this->tokenPayload()['enc_pass']));
    }

    public function testRemovalKeepsLoginPassword(): void {
        $this->credentials->storeCredentials('ana', 'login-secret');
        $this->credentials->storeEmailPassword('ana', 'mailbox-secret');

        $this->credentials->clearEmailPassword('ana');

        $this->assertSame(['saved' => false, 'updated_at' => null], $this->credentials->emailPasswordStatus('ana'));
        $this->assertSame('login-secret', self::decrypt($this->userValues['enc_password']));
    }

    public function testLogoutKeepsSavedMailboxPassword(): void {
        $this->credentials->storeCredentials('ana', 'login-secret');
        $this->credentials->storeEmailPassword('ana', 'mailbox-secret');

        $this->credentials->clearLoginPassword('ana');

        $this->assertArrayNotHasKey('enc_password', $this->userValues);
        $this->assertTrue($this->credentials->emailPasswordStatus('ana')['saved']);
    }

    public function testTokenCarriesSavedMailboxPassword(): void {
        $this->credentials->storeCredentials('ana', 'login-secret');
        $this->credentials->storeEmailPassword('ana', 'mailbox-secret');

        $payload = $this->tokenPayload();

        $this->assertSame('mailbox', $payload['pass_src']);
        $this->assertSame('mailbox-secret', self::decrypt($payload['enc_pass']));
    }

    public function testTokenFallsBackToLoginPasswordAfterRemoval(): void {
        $this->credentials->storeCredentials('ana', 'login-secret');
        $this->credentials->storeEmailPassword('ana', 'mailbox-secret');

        $this->credentials->clearEmailPassword('ana');
        $payload = $this->tokenPayload();

        $this->assertSame('login', $payload['pass_src']);
        $this->assertSame('login-secret', self::decrypt($payload['enc_pass']));
    }

    /** @return array<string, array{mixed, ?string}> */
    public static function passwords(): array {
        return [
            'empty' => ['', 'password_required'],
            'not a string' => [['secret'], 'password_required'],
            'too long' => [str_repeat('a', CredentialService::EMAIL_PASSWORD_MAX_LENGTH + 1), 'password_too_long'],
            'at the limit in multibyte characters' => [str_repeat('ç', CredentialService::EMAIL_PASSWORD_MAX_LENGTH), null],
            'with spaces' => [' secret with spaces ', null],
        ];
    }

    /** @dataProvider passwords */
    public function testValidatesMailboxPassword(mixed $password, ?string $error): void {
        $this->assertSame($error, $this->credentials->emailPasswordError($password));
    }
}
