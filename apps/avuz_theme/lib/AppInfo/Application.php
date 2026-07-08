<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\AppInfo;

use OCA\AvuzTheme\Listener\BeforeTemplateRenderedListener;
use OCA\AvuzTheme\Listener\UserCreatedListener;
use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IRegistrationContext;
use OCP\AppFramework\Http\Events\BeforeLoginTemplateRenderedEvent;
use OCP\User\Events\UserCreatedEvent;
use OCP\Util;

class Application extends App implements IBootstrap {
	public const APP_ID = 'avuz_theme';

	public function __construct() {
		parent::__construct(self::APP_ID);
	}

	public function register(IRegistrationContext $context): void {
		$context->registerEventListener(
			BeforeLoginTemplateRenderedEvent::class,
			BeforeTemplateRenderedListener::class
		);

		// Create custom Avuz welcome board for new users instead of default Nextcloud board
		$context->registerEventListener(
			UserCreatedEvent::class,
			UserCreatedListener::class
		);
	}

	public function boot(IBootContext $context): void {
		// Inject header CSS on all pages
		Util::addStyle(self::APP_ID, 'header');

		// Inject theme CSS for cards and backgrounds
		Util::addStyle(self::APP_ID, 'theme');

		// Inject icon CSS for Lucide integration
		Util::addStyle(self::APP_ID, 'icons');

		// Inject settings page CSS fixes
		Util::addStyle(self::APP_ID, 'settings');

		// Inject Lucide library
		Util::addScript(self::APP_ID, 'lucide');

		// Inject Lucide icons initialization
		Util::addScript(self::APP_ID, 'lucide-icons');

		// Inject header centering JS
		Util::addScript(self::APP_ID, 'center-header');

		// Add hover tooltip to read-only Deck stack titles
		Util::addScript(self::APP_ID, 'deck-stack-title');
	}
}
