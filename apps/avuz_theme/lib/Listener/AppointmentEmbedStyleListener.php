<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\Listener;

use OCA\AvuzTheme\AppInfo\Application;
use OCA\AvuzTheme\Service\AppointmentEmbed;
use OCP\AppFramework\Http\Events\BeforeTemplateRenderedEvent;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Util;

/**
 * Loads the widget styles on the public appointment booking page opened with
 * ?embed=1. The pre-hide sheet keeps the page invisible until
 * js/appointment-embed.js has checked the embedding site, so the page chrome
 * never flashes inside the frame; every embed rule only applies once that
 * check passes (html.avuz-embed). No styles on any other page or request.
 *
 * @template-implements IEventListener<BeforeTemplateRenderedEvent>
 */
class AppointmentEmbedStyleListener implements IEventListener {
	public const STYLES = ['appointment-embed-prehide', 'appointment-embed'];

	public function __construct(
		private AppointmentEmbed $appointmentEmbed,
	) {
	}

	public function handle(Event $event): void {
		if (!($event instanceof BeforeTemplateRenderedEvent)) {
			return;
		}

		if (!$this->appointmentEmbed->isEmbedRequested()) {
			return;
		}

		foreach (self::STYLES as $style) {
			Util::addStyle(Application::APP_ID, $style);
		}
	}
}
