<?php

declare(strict_types=1);

/**
 * SPDX-FileCopyrightText: 2026 Avuz Conecta
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
namespace Test\AppFramework\Http;

use OCP\AppFramework\Http;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\AppFramework\Http\TooManyRequestsResponse;
use OCP\Template\ITemplate;
use OCP\Template\ITemplateManager;
use Test\TestCase;

class TooManyRequestsResponseTest extends TestCase {
	public function testRespondsWithStatus429(): void {
		$this->assertSame(Http::STATUS_TOO_MANY_REQUESTS, (new TooManyRequestsResponse())->getStatus());
	}

	public function testRendersThe429PageInsideTheGuestLayout(): void {
		$page = $this->createMock(ITemplate::class);
		$page->method('fetchPage')->willReturn('<html>Muitas tentativas</html>');
		$templateManager = $this->createMock(ITemplateManager::class);
		$templateManager->expects($this->once())
			->method('getTemplate')
			->with('core', '429', TemplateResponse::RENDER_AS_GUEST)
			->willReturn($page);
		$this->overwriteService(ITemplateManager::class, $templateManager);

		$this->assertSame('<html>Muitas tentativas</html>', (new TooManyRequestsResponse())->render());
	}

	protected function tearDown(): void {
		$this->restoreService(ITemplateManager::class);
		parent::tearDown();
	}
}
