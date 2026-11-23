<?php
namespace OCA\Roundcube\Tests\Unit\Controller;

use OCA\Roundcube\Controller\ComposeController;
use OCA\Roundcube\Service\AppPasswordService;
use OCA\Roundcube\Service\MailBackend;
use OCA\Roundcube\Service\MailboxAddress;
use OCA\Roundcube\Service\WebmailTokenService;
use OCP\IAppConfig;
use OCP\IConfig;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\IUser;
use OCP\IUserManager;
use PHPUnit\Framework\TestCase;

class ComposeControllerTest extends TestCase {
    private const WEBMAIL_URL = 'https://webmail.example';
    private const MAIL_PAGE_URL = '/apps/conectamail/';
    private const WEBMAIL_ON = [
        'mail_backend' => 'webmail',
        'webmail_avuz_url' => self::WEBMAIL_URL,
        'webmail_avuz_sso_secret' => 'webmail-secret',
    ];

    protected function setUp(): void {
        if (!interface_exists('OCP\\IAppConfig')) {
            $this->markTestSkipped('requires Avuz Conecta environment');
        }
    }

    private function controller(array $appValues, array $userValues = ['email_enc_password' => 'stored-blob'], ?string $mailbox = 'ana@example.com'): ComposeController {
        $appConfig = $this->createMock(IAppConfig::class);
        $appConfig->method('getValueString')->willReturnCallback(
            fn (string $app, string $key, string $default = '') => $appValues[$key] ?? $default
        );
        $config = $this->createMock(IConfig::class);
        $config->method('getUserValue')->willReturnCallback(
            fn (string $userId, string $app, string $key, $default = '') => $userValues[$key] ?? $default
        );
        $user = $this->createMock(IUser::class);
        $user->method('getEMailAddress')->willReturn($mailbox);
        $userManager = $this->createMock(IUserManager::class);
        $userManager->method('get')->willReturn($user);
        $mailboxAddress = new MailboxAddress($config, $userManager);
        $appPasswords = $this->createMock(AppPasswordService::class);
        $appPasswords->method('getOrCreate')->willReturn('app-password');
        $webmail = new WebmailTokenService($config, $appConfig, $mailboxAddress, $appPasswords);
        $urlGenerator = $this->createMock(IURLGenerator::class);
        $urlGenerator->method('linkToRoute')->willReturn(self::MAIL_PAGE_URL);

        return new ComposeController(
            $this->createMock(IRequest::class),
            new MailBackend($appConfig, $webmail),
            $webmail,
            $mailboxAddress,
            $urlGenerator,
            'ana',
        );
    }

    private static function returnPath(string $redirect): string {
        parse_str((string) parse_url($redirect, PHP_URL_QUERY), $query);
        return (string) ($query['return'] ?? '');
    }

    public function testSignsInToTheWebmailAndOpensANewMessageToTheAddress(): void {
        $redirect = $this->controller(self::WEBMAIL_ON)->compose('bia@cliente.com')->getRedirectURL();

        $this->assertStringStartsWith(self::WEBMAIL_URL . '/api/auth/sso?token=', $redirect);
        $this->assertSame('/?view=compose&mode=new&to=bia%40cliente.com', self::returnPath($redirect));
    }

    public function testOpensANewMessageToEveryValidAddress(): void {
        $redirect = $this->controller(self::WEBMAIL_ON)->compose('bia@cliente.com,não-é-email')->getRedirectURL();

        $this->assertSame('/?view=compose&mode=new&to=bia%40cliente.com', self::returnPath($redirect));
    }

    public function testOpensTheWebmailComposeWithoutSignInWhenNoMailPasswordIsStored(): void {
        $redirect = $this->controller(self::WEBMAIL_ON, [])->compose('bia@cliente.com')->getRedirectURL();

        $this->assertSame(self::WEBMAIL_URL . '/?view=compose&mode=new&to=bia%40cliente.com', $redirect);
    }

    public function testOpensTheMailPageWhenTheTenantUsesRoundcube(): void {
        $redirect = $this->controller(['webmail_avuz_url' => self::WEBMAIL_URL, 'webmail_avuz_sso_secret' => 'webmail-secret'])
            ->compose('bia@cliente.com')->getRedirectURL();

        $this->assertSame(self::MAIL_PAGE_URL, $redirect);
    }

    public function testOpensTheMailPageWhenTheUserHasNoMailbox(): void {
        $redirect = $this->controller(self::WEBMAIL_ON, ['email_enc_password' => 'stored-blob'], null)
            ->compose('bia@cliente.com')->getRedirectURL();

        $this->assertSame(self::MAIL_PAGE_URL, $redirect);
    }

    public function testOpensTheMailPageWhenNoAddressIsValid(): void {
        $redirect = $this->controller(self::WEBMAIL_ON)->compose('javascript:alert(1)')->getRedirectURL();

        $this->assertSame(self::MAIL_PAGE_URL, $redirect);
    }
}
