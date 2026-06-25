<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\AppInfo;

use OCA\AvuzTheme\Listener\BeforeTemplateRenderedListener;
use OCA\AvuzTheme\Listener\UserCreatedListener;
use OCA\AvuzTheme\Listener\ZammadCspListener;
use OCA\AvuzTheme\Service\ZammadConfig;
use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IRegistrationContext;
use OCP\AppFramework\Http\Events\BeforeLoginTemplateRenderedEvent;
use OCP\AppFramework\Services\IInitialState;
use OCP\INavigationManager;
use OCP\IURLGenerator;
use OCP\Security\CSP\AddContentSecurityPolicyEvent;
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

		// Allow the Zammad chat host through the CSP when chat is enabled
		$context->registerEventListener(
			AddContentSecurityPolicyEvent::class,
			ZammadCspListener::class
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

		$this->bootZammad($context);
	}

	private function bootZammad(IBootContext $context): void {
		$container = $context->getAppContainer();
		$zammad = $container->get(ZammadConfig::class);

		if ($zammad->isChatEnabled()) {
			$initialState = $container->get(IInitialState::class);
			$initialState->provideInitialState('zammad', $zammad->initialState());
			Util::addScript(self::APP_ID, 'zammad-chat');
		}

		$portalUrl = $zammad->portalUrl();
		if ($portalUrl === '') {
			return;
		}

		$nav = $container->get(INavigationManager::class);
		$urlGenerator = $container->get(IURLGenerator::class);
		$nav->add(static fn (): array => [
			'id' => 'avuz_support',
			'order' => 80,
			'href' => $urlGenerator->linkToRoute('avuz_theme.support.redirect'),
			'icon' => $urlGenerator->imagePath('avuz_theme', 'support.svg'),
			'name' => 'Suporte',
		]);
	}
}
