<?php
namespace OCA\Roundcube\Tests\Unit\Service;
use OCA\Roundcube\Service\MailboxAddress;
use OCP\IConfig;
use OCP\IUser;
use OCP\IUserManager;
use PHPUnit\Framework\TestCase;

class MailboxAddressTest extends TestCase {
    protected function setUp(): void {
        if (!interface_exists('OCP\\IConfig')) {
            $this->markTestSkipped('requires Avuz Conecta environment');
        }
    }

    private function mailboxAddress(string $customEmail, ?string $accountEmail): MailboxAddress {
        $config = $this->createMock(IConfig::class);
        $config->method('getUserValue')->willReturnCallback(
            fn (string $userId, string $app, string $key, $default = '') => $key === 'email' ? $customEmail : $default
        );

        $user = $this->createMock(IUser::class);
        $user->method('getEMailAddress')->willReturn($accountEmail);
        $userManager = $this->createMock(IUserManager::class);
        $userManager->method('get')->willReturn($user);

        return new MailboxAddress($config, $userManager);
    }

    public function testPrefersTheCustomConectaMailAddress(): void {
        $mailboxAddress = $this->mailboxAddress('ana@mail.example', 'ana@account.example');

        $this->assertSame('ana@mail.example', $mailboxAddress->resolve('ana'));
        $this->assertTrue($mailboxAddress->exists('ana'));
    }

    public function testFallsBackToTheAccountAddress(): void {
        $mailboxAddress = $this->mailboxAddress('', 'ana@account.example');

        $this->assertSame('ana@account.example', $mailboxAddress->resolve('ana'));
        $this->assertTrue($mailboxAddress->exists('ana'));
    }

    public function testReportsNoMailboxWithoutAnyAddress(): void {
        $this->assertFalse($this->mailboxAddress('', null)->exists('ana'));
    }

    public function testReportsNoMailboxForAnAddressWithoutAt(): void {
        $this->assertFalse($this->mailboxAddress('ana', 'ana@account.example')->exists('ana'));
    }
}
