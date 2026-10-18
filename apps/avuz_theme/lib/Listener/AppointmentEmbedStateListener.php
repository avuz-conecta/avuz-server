<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\Listener;

use OCA\AvuzTheme\Service\AppointmentEmbed;
use OCP\AppFramework\Http\Events\BeforeTemplateRenderedEvent;
use OCP\AppFramework\Services\IInitialState;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;

/**
 * Hands the embedding allowlist to js/appointment-embed.js on the public
 * appointment booking page, so it can tell the embedding site that a booking
 * was requested. Not provided anywhere else, nor when the allowlist is empty.
 *
 * @template-implements IEventListener<BeforeTemplateRenderedEvent>
 */
class AppointmentEmbedStateListener implements IEventListener {
	public const STATE_KEY = 'embedAllowedOrigins';

	public function __construct(
		private AppointmentEmbed $appointmentEmbed,
		private IInitialState $initialState,
	) {
	}

	public function handle(Event $event): void {
		if (!($event instanceof BeforeTemplateRenderedEvent)) {
			return;
		}

		$origins = $this->appointmentEmbed->allowedOrigins();
		if ($origins === []) {
			return;
		}

		$this->initialState->provideInitialState(self::STATE_KEY, $origins);
	}
}
