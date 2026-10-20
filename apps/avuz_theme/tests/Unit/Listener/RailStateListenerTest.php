<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\Tests\Unit\Listener;

use OCA\AvuzTheme\Listener\RailStateListener;
use OCP\AppFramework\Http\Events\BeforeTemplateRenderedEvent;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\AppFramework\Services\IInitialState;
use OCP\Config\IUserConfig;
use OCP\IUser;
use OCP\IUserSession;
use PHPUnit\Framework\TestCase;

class RailStateListenerTest extends TestCase {
	/**
	 * @param array<string, string> $storedPreferences user config values of avuz_theme, by key
	 * @return array<string, mixed> initial state the page receives, by key
	 */
	private function initialStateFor(bool $loggedIn, array $storedPreferences): array {
		$user = $this->createStub(IUser::class);
		$user->method('getUID')->willReturn('ana');
		$userSession = $this->createStub(IUserSession::class);
		$userSession->method('getUser')->willReturn($loggedIn ? $user : null);

		$userConfig = $this->createStub(IUserConfig::class);
		$userConfig->method('getValueBool')->willReturnCallback(
			static fn (string $userId, string $app, string $key, bool $default = false): bool => $userId === 'ana' && $app === 'avuz_theme' && array_key_exists($key, $storedPreferences)
				? $storedPreferences[$key] === '1'
				: $default,
		);

		$provided = [];
		$initialState = $this->createStub(IInitialState::class);
		$initialState->method('provideInitialState')->willReturnCallback(
			static function (string $key, mixed $value) use (&$provided): void {
				$provided[$key] = $value;
			},
		);

		$listener = new RailStateListener($userSession, $userConfig, $initialState);
		$listener->handle(new BeforeTemplateRenderedEvent($loggedIn, new TemplateResponse('files', 'index')));
		return $provided;
	}

	public function testUserWhoCollapsedTheRailGetsItCollapsed(): void {
		$this->assertSame(['rail_collapsed' => true], $this->initialStateFor(true, ['rail_collapsed' => '1']));
	}

	public function testUserWhoExpandedTheRailGetsItExpanded(): void {
		$this->assertSame(['rail_collapsed' => false], $this->initialStateFor(true, ['rail_collapsed' => '0']));
	}

	public function testUserWithoutAChoiceGetsTheRailExpanded(): void {
		$this->assertSame(['rail_collapsed' => false], $this->initialStateFor(true, []));
	}

	public function testGuestPagesReceiveNothing(): void {
		$this->assertSame([], $this->initialStateFor(false, ['rail_collapsed' => '1']));
	}
}
