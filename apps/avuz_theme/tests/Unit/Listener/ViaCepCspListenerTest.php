<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\Tests\Unit\Listener;

use OC\Security\CSP\ContentSecurityPolicyManager;
use OCA\AvuzTheme\Listener\ViaCepCspListener;
use OCP\AppFramework\Http\ContentSecurityPolicy;
use OCP\EventDispatcher\IEventDispatcher;
use PHPUnit\Framework\TestCase;

class ViaCepCspListenerTest extends TestCase {
	/**
	 * The Content-Security-Policy header an app response gets, built the way
	 * core's CSPMiddleware builds it: the default policy (which dispatches
	 * AddContentSecurityPolicyEvent) merged with the response's own policy.
	 */
	private function responsePolicy(ContentSecurityPolicy $responsePolicy): string {
		$listener = new ViaCepCspListener();
		$dispatcher = $this->createStub(IEventDispatcher::class);
		$dispatcher->method('dispatchTyped')->willReturnCallback(static fn ($event) => $listener->handle($event));
		$policyManager = new ContentSecurityPolicyManager($dispatcher);

		return $policyManager->mergePolicies($policyManager->getDefaultPolicy(), $responsePolicy)->buildPolicy();
	}

	public function testPagesMayConnectToViaCep(): void {
		$this->assertStringContainsString(
			"connect-src 'self' https://viacep.com.br;",
			$this->responsePolicy(new ContentSecurityPolicy()),
		);
	}

	public function testPublicFormPagesWithTheirOwnPolicyMayConnectToViaCep(): void {
		$formsPolicy = new ContentSecurityPolicy();
		$formsPolicy->addAllowedFrameAncestorDomain('*');

		$this->assertStringContainsString(
			"connect-src 'self' https://viacep.com.br;",
			$this->responsePolicy($formsPolicy),
		);
	}

	public function testOtherDirectivesStayAsTheyWere(): void {
		$policy = $this->responsePolicy(new ContentSecurityPolicy());

		$this->assertStringContainsString("frame-ancestors 'self';", $policy);
		$this->assertStringNotContainsString('viacep', str_replace("connect-src 'self' https://viacep.com.br;", '', $policy));
	}
}
