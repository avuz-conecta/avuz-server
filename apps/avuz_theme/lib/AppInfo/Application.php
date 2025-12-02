<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\AppInfo;

use OCA\AvuzTheme\Listener\BeforeTemplateRenderedListener;
use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IRegistrationContext;
use OCP\AppFramework\Http\Events\BeforeLoginTemplateRenderedEvent;
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
	}

	public function boot(IBootContext $context): void {
		// Inject header CSS on all pages
		Util::addStyle(self::APP_ID, 'header');

		// Inject header centering JS
		Util::addScript(self::APP_ID, 'center-header');
	}
}
