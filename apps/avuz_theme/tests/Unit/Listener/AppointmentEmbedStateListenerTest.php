<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\Tests\Unit\Listener;

use OCA\AvuzTheme\Listener\AppointmentEmbedStateListener;
use OCA\AvuzTheme\Service\AppointmentEmbed;
use OCP\AppFramework\Http\Events\BeforeTemplateRenderedEvent;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\AppFramework\Services\IInitialState;
use OCP\IAppConfig;
use OCP\IRequest;
use PHPUnit\Framework\TestCase;

class AppointmentEmbedStateListenerTest extends TestCase {
	private const SITE_ORIGINS = 'https://www.avuzconecta.com.br,https://avuzconecta.com.br';

	/** @return array<string, mixed> initial state the page receives, by key */
	private function initialStateOn(?string $route, string $configuredOrigins): array {
		$request = $this->createStub(IRequest::class);
		$request->method('getParam')->willReturnCallback(
			static fn (string $key, mixed $default = null): mixed => $key === '_route' ? $route : $default,
		);
		$appConfig = $this->createStub(IAppConfig::class);
		$appConfig->method('getValueString')->willReturn($configuredOrigins);

		$provided = [];
		$initialState = $this->createStub(IInitialState::class);
		$initialState->method('provideInitialState')->willReturnCallback(
			static function (string $key, mixed $value) use (&$provided): void {
				$provided[$key] = $value;
			},
		);

		$listener = new AppointmentEmbedStateListener(new AppointmentEmbed($request, $appConfig), $initialState);
		$listener->handle(new BeforeTemplateRenderedEvent(false, new TemplateResponse('calendar', 'appointments/booking', [], TemplateResponse::RENDER_AS_PUBLIC)));
		return $provided;
	}

	public function testBookingPageReceivesTheAllowlist(): void {
		$this->assertSame(
			['embedAllowedOrigins' => ['https://www.avuzconecta.com.br', 'https://avuzconecta.com.br']],
			$this->initialStateOn('calendar.appointment.show', self::SITE_ORIGINS),
		);
	}

	public function testOtherRoutesReceiveNothing(): void {
		$this->assertSame([], $this->initialStateOn('files.view.index', self::SITE_ORIGINS));
	}

	public function testBookingPageReceivesNothingWhenNothingIsConfigured(): void {
		$this->assertSame([], $this->initialStateOn('calendar.appointment.show', ''));
	}
}
