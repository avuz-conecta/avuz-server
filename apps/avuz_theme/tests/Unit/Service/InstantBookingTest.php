<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\Tests\Unit\Service;

use OCA\AvuzTheme\Service\InstantBooking;
use OCP\IAppConfig;
use OCP\IRequest;
use PHPUnit\Framework\TestCase;

class InstantBookingTest extends TestCase {
	private const SITE_ORIGINS = 'https://www.avuzconecta.com.br';
	private const LISTED_TOKEN = 'MxXcZpTEzNcH';

	private function gate(string $allowedOrigins, string $listedTokens): InstantBooking {
		$appConfig = $this->createStub(IAppConfig::class);
		$appConfig->method('getValueString')->willReturnCallback(
			static fn (string $app, string $key, string $default = ''): string => match (true) {
				$app === 'avuz_theme' && $key === 'embed_allowed_origins' => $allowedOrigins,
				$app === 'avuz_theme' && $key === 'instant_booking_tokens' => $listedTokens,
				default => $default,
			},
		);
		return new InstantBooking($appConfig);
	}

	private function requestWithHeader(string $headerValue): IRequest {
		$request = $this->createStub(IRequest::class);
		$request->method('getHeader')->willReturnCallback(
			static fn (string $name): string => $name === 'X-Avuz-Embed-Booking' ? $headerValue : '',
		);
		return $request;
	}

	public function testAllowsTheListedPageFromTheEmbed(): void {
		$gate = $this->gate(self::SITE_ORIGINS, self::LISTED_TOKEN);
		$this->assertTrue($gate->isAllowed($this->requestWithHeader('1'), self::LISTED_TOKEN));
	}

	public function testRefusesWithoutTheHeader(): void {
		$gate = $this->gate(self::SITE_ORIGINS, self::LISTED_TOKEN);
		$this->assertFalse($gate->isAllowed($this->requestWithHeader(''), self::LISTED_TOKEN));
	}

	public function testRefusesAnotherHeaderValue(): void {
		$gate = $this->gate(self::SITE_ORIGINS, self::LISTED_TOKEN);
		$this->assertFalse($gate->isAllowed($this->requestWithHeader('true'), self::LISTED_TOKEN));
	}

	public function testRefusesWhenTheInstanceHasNoAllowlist(): void {
		$gate = $this->gate('', self::LISTED_TOKEN);
		$this->assertFalse($gate->isAllowed($this->requestWithHeader('1'), self::LISTED_TOKEN));
	}

	public function testRefusesWhenTheAllowlistHasOnlyInvalidOrigins(): void {
		$gate = $this->gate('http://x.com', self::LISTED_TOKEN);
		$this->assertFalse($gate->isAllowed($this->requestWithHeader('1'), self::LISTED_TOKEN));
	}

	public function testRefusesAPageThatIsNotListed(): void {
		$gate = $this->gate(self::SITE_ORIGINS, self::LISTED_TOKEN);
		$this->assertFalse($gate->isAllowed($this->requestWithHeader('1'), 'OtherToken1'));
	}

	public function testRefusesWhenNoPageIsListed(): void {
		$gate = $this->gate(self::SITE_ORIGINS, '');
		$this->assertFalse($gate->isAllowed($this->requestWithHeader('1'), self::LISTED_TOKEN));
	}

	public function testParsesTokensTrimmedUniqueAndAlphanumericOnly(): void {
		$this->assertSame(['abc', 'Def9'], InstantBooking::parseTokens(' abc, Def9 ,abc,bad-token,, '));
	}
}
