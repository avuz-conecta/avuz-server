<?php
namespace OCA\Roundcube\Tests\Unit\Service;
use OCA\Roundcube\Service\AppPasswordService;
use OCA\Roundcube\Service\MailBackend;
use OCA\Roundcube\Service\MailboxAddress;
use OCA\Roundcube\Service\WebmailTokenService;
use OCP\IAppConfig;
use OCP\IConfig;
use OCP\IUserManager;
use PHPUnit\Framework\TestCase;

class MailBackendTest extends TestCase {
    private const CONFIGURED_WEBMAIL = [
        'webmail_avuz_url' => 'https://webmail.example',
        'webmail_avuz_sso_secret' => 'webmail-secret',
    ];

    protected function setUp(): void {
        if (!interface_exists('OCP\\IAppConfig')) {
            $this->markTestSkipped('requires Avuz Conecta environment');
        }
    }

    private function mailBackend(array $appValues): MailBackend {
        $appConfig = $this->createMock(IAppConfig::class);
        $appConfig->method('getValueString')->willReturnCallback(
            fn (string $app, string $key, string $default = '') => $appValues[$key] ?? $default
        );
        $config = $this->createMock(IConfig::class);
        $webmail = new WebmailTokenService(
            $config,
            $appConfig,
            new MailboxAddress($config, $this->createMock(IUserManager::class)),
            $this->createMock(AppPasswordService::class),
        );

        return new MailBackend($appConfig, $webmail);
    }

    public function testOpensRoundcubeWhenNoBackendIsSet(): void {
        $this->assertSame(MailBackend::ROUNDCUBE, $this->mailBackend(self::CONFIGURED_WEBMAIL)->effective());
    }

    public function testOpensTheWebmailWhenSetAndConfigured(): void {
        $appValues = self::CONFIGURED_WEBMAIL + ['mail_backend' => 'webmail'];

        $this->assertSame(MailBackend::WEBMAIL, $this->mailBackend($appValues)->effective());
    }

    public function testReadsTheBackendTrimmedAndCaseInsensitive(): void {
        $appValues = self::CONFIGURED_WEBMAIL + ['mail_backend' => '  WebMail '];

        $this->assertSame(MailBackend::WEBMAIL, $this->mailBackend($appValues)->effective());
    }

    public function testFallsBackToRoundcubeWhenTheWebmailHasNoUrl(): void {
        $appValues = ['mail_backend' => 'webmail', 'webmail_avuz_sso_secret' => 'webmail-secret'];

        $this->assertSame(MailBackend::ROUNDCUBE, $this->mailBackend($appValues)->effective());
    }

    public function testFallsBackToRoundcubeWhenTheWebmailHasNoSecret(): void {
        $appValues = ['mail_backend' => 'webmail', 'webmail_avuz_url' => 'https://webmail.example'];

        $this->assertSame(MailBackend::ROUNDCUBE, $this->mailBackend($appValues)->effective());
    }

    /**
     * @dataProvider unknownBackends
     */
    public function testFallsBackToRoundcubeForAnUnknownBackend(string $backend): void {
        $appValues = self::CONFIGURED_WEBMAIL + ['mail_backend' => $backend];

        $this->assertSame(MailBackend::ROUNDCUBE, $this->mailBackend($appValues)->effective());
    }

    public static function unknownBackends(): array {
        return [
            'zimbra' => ['zimbra'],
            'empty' => [''],
            'blank' => ['   '],
            'roundcube' => ['roundcube'],
        ];
    }
}
