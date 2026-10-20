<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\Listener;

use OCA\AvuzTheme\AppInfo\Application;
use OCP\AppFramework\Http\Events\BeforeTemplateRenderedEvent;
use OCP\AppFramework\Services\IInitialState;
use OCP\Config\IUserConfig;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\IUserSession;

/**
 * Hands js/left-rail.js the user's saved rail state, so the first paint
 * already has the right width. Logged-in pages only; expanded by default.
 *
 * @template-implements IEventListener<BeforeTemplateRenderedEvent>
 */
class RailStateListener implements IEventListener {
	public const STATE_KEY = 'rail_collapsed';

	public function __construct(
		private IUserSession $userSession,
		private IUserConfig $userConfig,
		private IInitialState $initialState,
	) {
	}

	public function handle(Event $event): void {
		if (!($event instanceof BeforeTemplateRenderedEvent) || !$event->isLoggedIn()) {
			return;
		}

		$user = $this->userSession->getUser();
		if ($user === null) {
			return;
		}

		$collapsed = $this->userConfig->getValueBool($user->getUID(), Application::APP_ID, RailPreferenceValidator::CONFIG_KEY);
		$this->initialState->provideInitialState(self::STATE_KEY, $collapsed);
	}
}
