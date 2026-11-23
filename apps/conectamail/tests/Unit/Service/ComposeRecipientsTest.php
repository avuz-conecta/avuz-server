<?php
namespace OCA\Roundcube\Tests\Unit\Service;

use OCA\Roundcube\Service\ComposeRecipients;
use PHPUnit\Framework\TestCase;

class ComposeRecipientsTest extends TestCase {
    public function testKeepsOneAddress(): void {
        $this->assertSame('bia@cliente.com', ComposeRecipients::from('bia@cliente.com'));
    }

    public function testKeepsSeveralAddressesSeparatedByCommas(): void {
        $this->assertSame('bia@cliente.com,caio@empresa.com', ComposeRecipients::from(' bia@cliente.com , caio@empresa.com '));
    }

    public function testDropsWhatIsNotAnAddress(): void {
        $this->assertSame('bia@cliente.com', ComposeRecipients::from('bia@cliente.com,javascript:alert(1),sem-arroba'));
    }

    public function testDropsRepeatedAddresses(): void {
        $this->assertSame('bia@cliente.com', ComposeRecipients::from('bia@cliente.com,BIA@cliente.com'));
    }

    public function testKeepsAtMostTwentyAddresses(): void {
        $many = implode(',', array_map(fn (int $index) => "pessoa$index@cliente.com", range(1, 30)));

        $this->assertCount(20, explode(',', ComposeRecipients::from($many)));
    }

    public function testReturnsNothingForEmptyInput(): void {
        $this->assertSame('', ComposeRecipients::from(''));
    }
}
