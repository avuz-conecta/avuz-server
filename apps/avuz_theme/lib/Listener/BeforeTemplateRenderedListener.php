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

		// Add login icon row injector
		Util::addScript('avuz_theme', 'login-icons');
	}
}
