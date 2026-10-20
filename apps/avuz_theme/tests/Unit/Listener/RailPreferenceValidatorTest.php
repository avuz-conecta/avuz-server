<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\Tests\Unit\Listener;

use OCA\AvuzTheme\Listener\RailPreferenceValidator;
use OCP\Config\BeforePreferenceSetEvent;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class RailPreferenceValidatorTest extends TestCase {
	private function validated(string $appId, string $configKey, string $configValue, bool $alreadyValid = false): bool {
		$event = new BeforePreferenceSetEvent('ana', $appId, $configKey, $configValue);
		$event->setValid($alreadyValid);
		(new RailPreferenceValidator())->handle($event);
		return $event->isValid();
	}

	public function testAcceptsCollapsing(): void {
		$this->assertTrue($this->validated('avuz_theme', 'rail_collapsed', '1'));
	}

	public function testAcceptsExpanding(): void {
		$this->assertTrue($this->validated('avuz_theme', 'rail_collapsed', '0'));
	}

	/** @return array<string, array{string}> */
	public static function invalidValues(): array {
		return [
			'empty' => [''],
			'word' => ['true'],
			'other number' => ['2'],
			'markup' => ['<script>'],
		];
	}

	#[DataProvider('invalidValues')]
	public function testRejectsAnyOtherValue(string $value): void {
		$this->assertFalse($this->validated('avuz_theme', 'rail_collapsed', $value));
	}

	public function testRejectsOtherAvuzThemeKeys(): void {
		$this->assertFalse($this->validated('avuz_theme', 'embed_allowed_origins', '1'));
	}

	public function testLeavesOtherAppsPreferencesAlone(): void {
		$this->assertTrue($this->validated('dav', 'user_status_automation', 'yes', alreadyValid: true));
		$this->assertFalse($this->validated('dav', 'rail_collapsed', '1'));
	}
}
