<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\Listener;

use OCA\AvuzTheme\AppInfo\Application;
use OCP\Config\BeforePreferenceSetEvent;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;

/**
 * Lets users save the rail state through the provisioning_api preferences
 * endpoint (POST ocs/v2.php/apps/provisioning_api/api/v1/config/users/avuz_theme/rail_collapsed),
 * which refuses any app preference no listener vouches for.
 *
 * @template-implements IEventListener<BeforePreferenceSetEvent>
 */
class RailPreferenceValidator implements IEventListener {
	public const CONFIG_KEY = 'rail_collapsed';
	private const ALLOWED_VALUES = ['0', '1'];

	public function handle(Event $event): void {
		if (!($event instanceof BeforePreferenceSetEvent)) {
			return;
		}
		if ($event->getAppId() !== Application::APP_ID || $event->getConfigKey() !== self::CONFIG_KEY) {
			return;
		}

		$event->setValid(in_array($event->getConfigValue(), self::ALLOWED_VALUES, true));
	}
}
