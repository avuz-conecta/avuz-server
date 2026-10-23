<?php
namespace OCA\Roundcube\Tests\Unit\Service;
use OCA\Roundcube\Listener\BeforeUserLoggedOutListener;
use OCA\Roundcube\Service\AppPasswordService;
use OCA\Roundcube\Service\MailboxAddress;
use OCA\Roundcube\Service\WebmailSessionRevoker;
use OCA\Roundcube\Service\WebmailTokenService;
use OCP\Http\Client\IClient;
use OCP\Http\Client\IClientService;
use OCP\Http\Client\IResponse;
use OCP\IAppConfig;
use OCP\IConfig;
use OCP\IUser;
use OCP\IUserManager;
use OCP\User\Events\BeforeUserLoggedOutEvent;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

class WebmailSessionRevokerTest extends TestCase {
    private const WEBMAIL_SECRET = 'plain-webmail-secret';
    private const WEBMAIL_URL = 'https://webmail.example';

    /** @var list<array{url: string, options: array<string, mixed>}> */
    private array $posts = [];
    private ?\Throwable $postFailure = null;
    /** @var array<string, string> */
    private array $appValues = [];
    /** @var list<string> */
    private array $warnings = [];

    protected function setUp(): void {
        if (!interface_exists('OCP\\IAppConfig')) {
            $this->markTestSkipped('requires Nextcloud environment');
        }
        $this->posts = [];
        $this->postFailure = null;
        $this->warnings = [];
        $this->appValues = [
            'webmail_avuz_url' => self::WEBMAIL_URL,
            'webmail_avuz_sso_secret' => self::WEBMAIL_SECRET,
        ];
    }

    private function revoker(): WebmailSessionRevoker {
        $appConfig = $this->createMock(IAppConfig::class);
        $appConfig->method('getValueString')->willReturnCallback(
            fn (string $app, string $key, string $default = '') => $this->appValues[$key] ?? ''
        );
        $tokens = new WebmailTokenService(
            $this->createMock(IConfig::class),
            $appConfig,
            new MailboxAddress($this->createMock(IConfig::class), $this->createMock(IUserManager::class)),
            $this->createMock(AppPasswordService::class),
        );

        $response = $this->createMock(IResponse::class);
        $response->method('getBody')->willReturn('{"revoked":1}');
        $client = $this->createMock(IClient::class);
        $client->method('post')->willReturnCallback(function (string $url, array $options) use ($response) {
            $this->posts[] = ['url' => $url, 'options' => $options];
            if ($this->postFailure !== null) {
                throw $this->postFailure;
            }
            return $response;
        });
        $clientService = $this->createMock(IClientService::class);
        $clientService->method('newClient')->willReturn($client);

        $logger = $this->createMock(LoggerInterface::class);
        $logger->method('warning')->willReturnCallback(function (string $message) { $this->warnings[] = $message; });

        return new WebmailSessionRevoker($tokens, $clientService, $logger);
    }

    /** Same checks as the webmail's verifyLogoutToken: HMAC over the payload segment, then the claims. */
    private static function claimsAcceptedByWebmail(string $token): array {
        [$payloadSegment, $signature] = explode('.', $token, 2);
        $expected = rtrim(strtr(base64_encode(hash_hmac('sha256', $payloadSegment, self::WEBMAIL_SECRET, true)), '+/', '-_'), '=');
        self::assertTrue(hash_equals($expected, $signature), 'signature the webmail accepts');
        return json_decode(base64_decode(strtr($payloadSegment, '-_', '+/')), true);
    }

    private function postedToken(): string {
        return $this->posts[0]['options']['json']['token'];
    }

    public function testPostsToTheWebmailLogoutEndpoint(): void {
        $this->revoker()->revoke('ana');

        $this->assertSame(self::WEBMAIL_URL . '/api/auth/conecta-logout', $this->posts[0]['url']);
    }

    public function testSendsTheWebmailCsrfHeader(): void {
        $this->revoker()->revoke('ana');

        $this->assertSame('1', $this->posts[0]['options']['headers']['x-webmail-request']);
    }

    public function testSignsALogoutTokenForTheUser(): void {
        $this->revoker()->revoke('ana');

        $claims = self::claimsAcceptedByWebmail($this->postedToken());
        $this->assertSame('ana', $claims['uid']);
        $this->assertSame('webmail-avuz-logout', $claims['aud']);
        $this->assertSame(1, $claims['v']);
        $this->assertMatchesRegularExpression('/^[0-9a-f]{32}$/', $claims['jti']);
    }

    public function testTokenLivesOneMinute(): void {
        $this->revoker()->revoke('ana');

        $claims = self::claimsAcceptedByWebmail($this->postedToken());
        $this->assertEqualsWithDelta(time(), $claims['iat'], 5);
        $this->assertSame(60, $claims['exp'] - $claims['iat']);
    }

    public function testTokenCarriesNoMailCredentials(): void {
        $this->revoker()->revoke('ana');

        $claims = self::claimsAcceptedByWebmail($this->postedToken());
        $this->assertSame(['v', 'jti', 'uid', 'iat', 'exp', 'aud'], array_keys($claims));
    }

    public function testEachLogoutGetsAFreshToken(): void {
        $revoker = $this->revoker();
        $revoker->revoke('ana');
        $revoker->revoke('ana');

        $this->assertNotSame($this->posts[0]['options']['json']['token'], $this->posts[1]['options']['json']['token']);
    }

    public function testGivesUpQuickly(): void {
        $this->revoker()->revoke('ana');

        $this->assertLessThanOrEqual(3, $this->posts[0]['options']['timeout']);
    }

    public function testLogsAndSwallowsWebmailFailures(): void {
        $this->postFailure = new \RuntimeException('connection refused');

        $this->revoker()->revoke('ana');

        $this->assertCount(1, $this->warnings);
        $this->assertStringContainsString('connection refused', $this->warnings[0]);
    }

    public function testDoesNothingWithoutWebmailUrl(): void {
        $this->appValues['webmail_avuz_url'] = '';

        $this->revoker()->revoke('ana');

        $this->assertSame([], $this->posts);
    }

    public function testDoesNothingWithoutSsoSecret(): void {
        $this->appValues['webmail_avuz_sso_secret'] = '';

        $this->revoker()->revoke('ana');

        $this->assertSame([], $this->posts);
    }

    public function testLogoutOfAUserEndsTheirWebmailSessions(): void {
        $user = $this->createMock(IUser::class);
        $user->method('getUID')->willReturn('ana');

        (new BeforeUserLoggedOutListener($this->revoker()))->handle(new BeforeUserLoggedOutEvent($user));

        $this->assertSame('ana', self::claimsAcceptedByWebmail($this->postedToken())['uid']);
    }

    public function testLogoutWithoutUserCallsNothing(): void {
        (new BeforeUserLoggedOutListener($this->revoker()))->handle(new BeforeUserLoggedOutEvent(null));

        $this->assertSame([], $this->posts);
    }
}
