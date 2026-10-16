<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\Tests\Unit\Listener;

use OC\Security\CSP\ContentSecurityPolicyManager;
use OCA\AvuzTheme\Listener\AppointmentEmbedCspListener;
use OCA\AvuzTheme\Service\AppointmentEmbed;
use OCP\AppFramework\Http\ContentSecurityPolicy;
use OCP\EventDispatcher\IEventDispatcher;
use OCP\IAppConfig;
use OCP\IRequest;
use PHPUnit\Framework\TestCase;

class AppointmentEmbedCspListenerTest extends TestCase {
	private const SITE_ORIGINS = 'https://www.avuzconecta.com.br,https://avuzconecta.com.br';

	/**
	 * The Content-Security-Policy header an app response gets, built the way
	 * core's CSPMiddleware builds it: the default policy (which dispatches
	 * AddContentSecurityPolicyEvent) merged with the response's own policy.
	 */
	private function responsePolicyOn(?string $route, string $configuredOrigins): string {
		$request = $this->createStub(IRequest::class);
		$request->method('getParam')->willReturnCallback(
			static fn (string $key, mixed $default = null): mixed => $key === '_route' ? $route : $default,
		);
		$appConfig = $this->createStub(IAppConfig::class);
		$appConfig->method('getValueString')->willReturn($configuredOrigins);
		$listener = new AppointmentEmbedCspListener(new AppointmentEmbed($request, $appConfig));

		$dispatcher = $this->createStub(IEventDispatcher::class);
		$dispatcher->method('dispatchTyped')->willReturnCallback(static fn ($event) => $listener->handle($event));
		$policyManager = new ContentSecurityPolicyManager($dispatcher);

		return $policyManager->mergePolicies($policyManager->getDefaultPolicy(), new ContentSecurityPolicy())->buildPolicy();
	}

	public function testBookingPageMayBeFramedBySelfAndTheAllowlistedOrigins(): void {
		$this->assertStringContainsString(
			"frame-ancestors 'self' https://www.avuzconecta.com.br https://avuzconecta.com.br;",
			$this->responsePolicyOn('calendar.appointment.show', self::SITE_ORIGINS),
		);
	}

	public function testOtherRoutesKeepFrameAncestorsSelf(): void {
		foreach (['calendar.appointment.confirm', 'calendar.booking.bookSlot', 'files.view.index', null] as $route) {
			$this->assertStringContainsString("frame-ancestors 'self';", $this->responsePolicyOn($route, self::SITE_ORIGINS), "route $route");
		}
	}

	public function testBookingPageKeepsFrameAncestorsSelfWhenNothingIsConfigured(): void {
		foreach (['', 'http://avuzconecta.com.br,https://avuzconecta.com.br/agendar'] as $configuredOrigins) {
			$this->assertStringContainsString(
				"frame-ancestors 'self';",
				$this->responsePolicyOn('calendar.appointment.show', $configuredOrigins),
				"configured [$configuredOrigins]",
			);
		}
	}
}
