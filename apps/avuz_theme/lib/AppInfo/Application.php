<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\AppInfo;

use OCA\AvuzTheme\Listener\AppointmentEmbedCspListener;
use OCA\AvuzTheme\Listener\AppointmentEmbedStateListener;
use OCA\AvuzTheme\Listener\AppointmentEmbedStyleListener;
use OCA\AvuzTheme\Listener\BeforeTemplateRenderedListener;
use OCA\AvuzTheme\Listener\IpAccessLoginListener;
use OCA\AvuzTheme\Listener\LoginFlowTemplateRenderedListener;
use OCA\AvuzTheme\Listener\UserCreatedListener;
use OCA\AvuzTheme\Middleware\IpAccessMiddleware;
use OCP\AppFramework\App;
use OCP\AppFramework\Bootstrap\IBootContext;
use OCP\AppFramework\Bootstrap\IBootstrap;
use OCP\AppFramework\Bootstrap\IRegistrationContext;
use OCP\AppFramework\Http\Events\BeforeLoginTemplateRenderedEvent;
use OCP\AppFramework\Http\Events\BeforeTemplateRenderedEvent;
use OCP\Security\CSP\AddContentSecurityPolicyEvent;
use OCP\User\Events\PostLoginEvent;
use OCP\User\Events\UserCreatedEvent;
use OCP\Util;

class Application extends App implements IBootstrap {
	public const APP_ID = 'avuz_theme';

	public function __construct() {
		parent::__construct(self::APP_ID);
	}

	public function register(IRegistrationContext $context): void {
		// Restrição de acesso por IP: non-admin accounts only from allowlisted
		// IPs (login of any kind + every app request); admins from anywhere
		$context->registerEventListener(PostLoginEvent::class, IpAccessLoginListener::class);
		$context->registerMiddleware(IpAccessMiddleware::class, true);

		$context->registerEventListener(
			BeforeLoginTemplateRenderedEvent::class,
			BeforeTemplateRenderedListener::class
		);

		// Style the device grant / login-flow page (served as guest, not via LoginController)
		$context->registerEventListener(
			BeforeTemplateRenderedEvent::class,
			LoginFlowTemplateRenderedListener::class
		);

		// Create custom Avuz welcome board for new users instead of default Nextcloud board
		$context->registerEventListener(
			UserCreatedEvent::class,
			UserCreatedListener::class
		);

		// Let allowlisted sites frame the public appointment booking page
		$context->registerEventListener(
			AddContentSecurityPolicyEvent::class,
			AppointmentEmbedCspListener::class
		);
		$context->registerEventListener(
			BeforeTemplateRenderedEvent::class,
			AppointmentEmbedStateListener::class
		);
		// Render the booking page as a clean widget when embedded with ?embed=1
		$context->registerEventListener(
			BeforeTemplateRenderedEvent::class,
			AppointmentEmbedStyleListener::class
		);
	}

	public function boot(IBootContext $context): void {
		// Inject header CSS on all pages
		Util::addStyle(self::APP_ID, 'header');

		// Left rail layout from 1024px up (js/left-rail.js renders it)
		Util::addStyle(self::APP_ID, 'left-rail');

		// Inject theme CSS for cards and backgrounds
		Util::addStyle(self::APP_ID, 'theme');

		// Inject icon CSS (header app menu colors, dashboard widget icons)
		Util::addStyle(self::APP_ID, 'icons');

		// Inject settings page CSS fixes
		Util::addStyle(self::APP_ID, 'settings');

		// Inject floating help + support widget CSS
		Util::addStyle(self::APP_ID, 'help-widget');

		// Page and panel markers the stylesheets scope by, instead of slow :has() rules
		Util::addScript(self::APP_ID, 'app-scope');

		// Material Symbols glyphs (window.AvuzIcons) for the left rail and the favicon; load before both
		Util::addScript(self::APP_ID, 'material-icons');

		// Browser tab icon follows the current app
		Util::addScript(self::APP_ID, 'favicon');

		// Inject header centering JS
		Util::addScript(self::APP_ID, 'center-header');

		// Left rail app menu (from 1024px up, see css/left-rail.css); the model first
		Util::addScript(self::APP_ID, 'left-rail-model');
		Util::addScript(self::APP_ID, 'left-rail');

		// Add hover tooltip to read-only Deck stack titles
		Util::addScript(self::APP_ID, 'deck-stack-title');

		// Deck board details as a centered modal (closes on outside click)
		Util::addStyle(self::APP_ID, 'deck-board-details');
		Util::addScript(self::APP_ID, 'deck-board-details');

		// Talk: modern chat layout ("Reunião" button, bubbles, composer)
		Util::addStyle(self::APP_ID, 'talk');
		Util::addScript(self::APP_ID, 'talk');

		// Deck: "Novo cartão" dialog (title, list, description, labels, people, dates)
		Util::addStyle(self::APP_ID, 'deck-new-card');
		Util::addScript(self::APP_ID, 'deck-new-card');

		// Deck: "Novo painel" dialog (colour, folder, lists, labels, sharing)
		Util::addStyle(self::APP_ID, 'deck-new-board');
		Util::addScript(self::APP_ID, 'deck-new-board');

		// Deck: board header icons + "Nova lista" dialog (name + colour)
		Util::addStyle(self::APP_ID, 'deck-board-actions');
		Util::addScript(self::APP_ID, 'deck-new-stack');

		// Deck: modern board layout (lists as panels, cards, counters)
		Util::addStyle(self::APP_ID, 'deck-board');
		Util::addScript(self::APP_ID, 'deck-board');

		// Calendar: modern layout (same language as Tarefas)
		Util::addStyle(self::APP_ID, 'calendar');
		Util::addScript(self::APP_ID, 'calendar');

		// Dashboard: modern layout (greeting + date, widget cards)
		Util::addStyle(self::APP_ID, 'dashboard');
		Util::addScript(self::APP_ID, 'dashboard');

		// Deck: card description toolbar in the webmail editor style
		Util::addStyle(self::APP_ID, 'deck-editor-toolbar');
		Util::addScript(self::APP_ID, 'deck-editor-toolbar');

		// Deck: paste, show and resize images in card descriptions
		Util::addStyle(self::APP_ID, 'deck-description-images');
		Util::addScript(self::APP_ID, 'deck-description-images');

		// Gray out unbookable days on the appointment booking page
		Util::addScript(self::APP_ID, 'booking-availability');

		// Make appointment booking work inside an iframe and tell the embedding
		// site when a booking is requested. Added at boot so it loads before the
		// calendar booking bundle sends its first request.
		Util::addScript(self::APP_ID, 'appointment-embed');

		// Inject floating help + support widget
		Util::addScript(self::APP_ID, 'help-widget');
	}
}
