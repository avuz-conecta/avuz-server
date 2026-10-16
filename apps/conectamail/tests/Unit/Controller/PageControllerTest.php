<?php
namespace OCA\Roundcube\Tests\Unit\Controller;
use OCA\Roundcube\Controller\PageController;
use OCA\Roundcube\Http\WebmailPage;
use OCA\Roundcube\Service\AppPasswordService;
use OCA\Roundcube\Service\CredentialService;
use OCA\Roundcube\Service\MailBackend;
use OCA\Roundcube\Service\MailboxAddress;
use OCA\Roundcube\Service\WebmailTokenService;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\IAppConfig;
use OCP\IConfig;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\IUser;
use OCP\IUserManager;
use PHPUnit\Framework\TestCase;

class PageControllerTest extends TestCase {
    private const ROUNDCUBE_IFRAME_URL = 'https://roundcube.example/?nc_token=roundcube-token';
    private const ROUNDCUBE_ORIGIN = 'https://roundcube.example';
    private const WEBMAIL_URL = 'https://webmail.example';
    private const DASHBOARD_URL = '/apps/dashboard/';
    private const CONFIGURED_WEBMAIL = [
        'webmail_avuz_url' => self::WEBMAIL_URL,
        'webmail_avuz_sso_secret' => 'webmail-secret',
    ];

    protected function setUp(): void {
        if (!interface_exists('OCP\\IAppConfig')) {
            $this->markTestSkipped('requires Avuz Conecta environment');
        }
    }

    private function menuPage(array $appValues, ?string $mailbox = 'ana@example.com'): TemplateResponse {
        $appConfig = $this->createMock(IAppConfig::class);
        $appConfig->method('getValueString')->willReturnCallback(
            fn (string $app, string $key, string $default = '') => $appValues[$key] ?? $default
        );
        $config = $this->createMock(IConfig::class);
        $config->method('getUserValue')->willReturnCallback(
            fn (string $userId, string $app, string $key, $default = '') => $default
        );
        $user = $this->createMock(IUser::class);
        $user->method('getEMailAddress')->willReturn($mailbox);
        $userManager = $this->createMock(IUserManager::class);
        $userManager->method('get')->willReturn($user);
        $mailboxAddress = new MailboxAddress($config, $userManager);

        $webmail = new WebmailTokenService($config, $appConfig, $mailboxAddress, $this->createMock(AppPasswordService::class));
        $urlGenerator = $this->createMock(IURLGenerator::class);
        $urlGenerator->method('linkToRoute')->willReturn(self::DASHBOARD_URL);

        $credentials = $this->createMock(CredentialService::class);
        $credentials->method('buildIframeUrl')->willReturn(self::ROUNDCUBE_IFRAME_URL);
        $credentials->method('getRoundcubeOrigin')->willReturn(self::ROUNDCUBE_ORIGIN);

        $controller = new PageController(
            $this->createMock(IRequest::class),
            $credentials,
            $mailboxAddress,
            $urlGenerator,
            new MailBackend($appConfig, $webmail),
            new WebmailPage($webmail, $mailboxAddress, $urlGenerator),
            'ana',
        );

        return $controller->index();
    }

    private static function frameSources(TemplateResponse $response): string {
        return $response->getContentSecurityPolicy()->buildPolicy();
    }

    public function testOpensRoundcubeByDefault(): void {
        $response = $this->menuPage(self::CONFIGURED_WEBMAIL);

        $this->assertSame('index', $response->getTemplateName());
        $this->assertSame(self::ROUNDCUBE_IFRAME_URL, $response->getParams()['iframe_url']);
        $this->assertStringContainsString(self::ROUNDCUBE_ORIGIN, self::frameSources($response));
    }

    public function testOpensTheWebmailInTheIframeWhenSelected(): void {
        $response = $this->menuPage(self::CONFIGURED_WEBMAIL + ['mail_backend' => 'webmail']);

        $this->assertSame('index', $response->getTemplateName());
        $this->assertSame(self::WEBMAIL_URL . '/', $response->getParams()['iframe_url']);
        $this->assertStringContainsString(self::WEBMAIL_URL, self::frameSources($response));
        $this->assertStringNotContainsString(self::ROUNDCUBE_ORIGIN, self::frameSources($response));
    }

    public function testOpensRoundcubeWhenTheWebmailIsSelectedButUnconfigured(): void {
        $response = $this->menuPage(['mail_backend' => 'webmail']);

        $this->assertSame(self::ROUNDCUBE_IFRAME_URL, $response->getParams()['iframe_url']);
    }

    public function testOpensRoundcubeForAnUnknownBackend(): void {
        $response = $this->menuPage(self::CONFIGURED_WEBMAIL + ['mail_backend' => 'zimbra']);

        $this->assertSame(self::ROUNDCUBE_IFRAME_URL, $response->getParams()['iframe_url']);
    }

    public function testShowsTheNoMailboxCardOnTheWebmailBackend(): void {
        $response = $this->menuPage(self::CONFIGURED_WEBMAIL + ['mail_backend' => 'webmail'], null);

        $this->assertSame('no-mailbox', $response->getTemplateName());
        $this->assertSame(['dashboard_url' => self::DASHBOARD_URL], $response->getParams());
    }
}
