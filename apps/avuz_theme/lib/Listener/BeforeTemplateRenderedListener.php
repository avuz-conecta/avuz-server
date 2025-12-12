<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\Listener;

use OCP\AppFramework\Http\Events\BeforeLoginTemplateRenderedEvent;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Util;

/**
 * @template-implements IEventListener<BeforeLoginTemplateRenderedEvent>
 */
class BeforeTemplateRenderedListener implements IEventListener {
	public function handle(Event $event): void {
		if (!($event instanceof BeforeLoginTemplateRenderedEvent)) {
			return;
		}

		// Add login CSS
		Util::addStyle('avuz_theme', 'login');

		// Set custom favicon for login page
		Util::addHeader('link', [
			'rel' => 'icon',
			'href' => '/apps/avuz_theme/img/logo.png',
			'type' => 'image/png'
		]);

		Util::addHeader('link', [
			'rel' => 'shortcut icon',
			'href' => '/apps/avuz_theme/img/logo.png',
			'type' => 'image/png'
		]);
	}
}
