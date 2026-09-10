<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\Listener;

use OCP\AppFramework\Http\Events\BeforeTemplateRenderedEvent;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Util;

/**
 * The device grant / login-flow page is rendered by ClientFlowLoginController
 * (not LoginController), so it only fires BeforeTemplateRenderedEvent. Scope the
 * grant-page styling to that exact guest template to leave every other page untouched.
 *
 * @template-implements IEventListener<BeforeTemplateRenderedEvent>
 */
class LoginFlowTemplateRenderedListener implements IEventListener {
	private const LOGIN_FLOW_TEMPLATE = 'loginflow';

	public function handle(Event $event): void {
		if (!($event instanceof BeforeTemplateRenderedEvent)) {
			return;
		}

		$response = $event->getResponse();
		if ($response->getRenderAs() !== TemplateResponse::RENDER_AS_GUEST) {
			return;
		}

		if ($response->getTemplateName() !== self::LOGIN_FLOW_TEMPLATE) {
			return;
		}

		Util::addStyle('avuz_theme', 'login-flow');
	}
}
