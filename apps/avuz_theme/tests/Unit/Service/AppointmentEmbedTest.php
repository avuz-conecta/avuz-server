<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\Tests\Unit\Service;

use OCA\AvuzTheme\Service\AppointmentEmbed;
use OCP\IAppConfig;
use OCP\IRequest;
use PHPUnit\Framework\TestCase;

class AppointmentEmbedTest extends TestCase {
	private const SITE_ORIGINS = 'https://www.avuzconecta.com.br,https://avuzconecta.com.br';

	private function embedOn(?string $route, string $configuredOrigins): AppointmentEmbed {
		$request = $this->createStub(IRequest::class);
		$request->method('getParam')->willReturnCallback(
			static fn (string $key, mixed $default = null): mixed => $key === '_route' ? $route : $default,
		);
		$appConfig = $this->createStub(IAppConfig::class);
		$appConfig->method('getValueString')->willReturnCallback(
			static fn (string $app, string $key, string $default = ''): string
				=> $app === 'avuz_theme' && $key === 'embed_allowed_origins' ? $configuredOrigins : $default,
		);
		return new AppointmentEmbed($request, $appConfig);
	}

	public function testAllowedOriginsReturnsTheConfiguredOriginsOnTheBookingPage(): void {
		$this->assertSame(
			['https://www.avuzconecta.com.br', 'https://avuzconecta.com.br'],
			$this->embedOn('calendar.appointment.show', self::SITE_ORIGINS)->allowedOrigins(),
		);
	}

	public function testAllowedOriginsIsEmptyOnEveryOtherRoute(): void {
		foreach (['calendar.appointment.confirm', 'calendar.booking.bookSlot', 'calendar.booking.getBookableSlots', 'files.view.index', 'core.login.showLoginForm', null] as $route) {
			$this->assertSame([], $this->embedOn($route, self::SITE_ORIGINS)->allowedOrigins(), "route $route");
		}
	}

	public function testAllowedOriginsIsEmptyWhenNothingIsConfigured(): void {
		$this->assertSame([], $this->embedOn('calendar.appointment.show', '')->allowedOrigins());
	}

	public function testParseOriginsTrimsLowercasesAndDeduplicates(): void {
		$this->assertSame(
			['https://www.avuzconecta.com.br', 'https://avuzconecta.com.br'],
			AppointmentEmbed::parseOrigins(' https://WWW.avuzconecta.com.br , https://avuzconecta.com.br,https://www.avuzconecta.com.br ,, '),
		);
	}

	public function testParseOriginsKeepsAnExplicitPortButDropsTheDefaultOne(): void {
		$this->assertSame(
			['https://staging.example.com:8443', 'https://example.com'],
			AppointmentEmbed::parseOrigins('https://staging.example.com:8443,https://example.com:443'),
		);
	}

	public function testParseOriginsDropsEverythingThatIsNotABareHttpsOrigin(): void {
		$invalid = [
			'http://avuzconecta.com.br',
			'https://avuzconecta.com.br/',
			'https://avuzconecta.com.br/agendar',
			'https://avuzconecta.com.br?x=1',
			'https://avuzconecta.com.br#top',
			'https://*.avuzconecta.com.br',
			'*',
			"'self'",
			'avuzconecta.com.br',
			'https://user@avuzconecta.com.br',
			'https://avuzconecta.com.br:0',
			'https://avuzconecta.com.br:65536',
			'https://-bad.example.com',
			'https://avuzconecta.com.br https://evil.example',
			'https://avuzconecta.com.br;script-src *',
			'javascript:alert(1)',
		];
		foreach ($invalid as $entry) {
			$this->assertSame([], AppointmentEmbed::parseOrigins($entry), "entry $entry");
		}
	}

	public function testParseOriginsKeepsTheValidEntriesOfAMixedList(): void {
		$this->assertSame(
			['https://avuzconecta.com.br'],
			AppointmentEmbed::parseOrigins('http://www.avuzconecta.com.br,https://avuzconecta.com.br,https://evil.example/path'),
		);
	}
}
