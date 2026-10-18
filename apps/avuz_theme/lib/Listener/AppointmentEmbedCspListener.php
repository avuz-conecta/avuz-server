<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\Listener;

use OCA\AvuzTheme\Service\AppointmentEmbed;
use OCP\AppFramework\Http\ContentSecurityPolicy;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Security\CSP\AddContentSecurityPolicyEvent;

/**
 * Adds the allowlisted embedding origins to frame-ancestors on the public
 * appointment booking page only. Core's CSPMiddleware merges this into every
 * app response's policy; on any other route, or with no origins configured,
 * the policy keeps the default frame-ancestors 'self'.
 *
 * @template-implements IEventListener<AddContentSecurityPolicyEvent>
 */
class AppointmentEmbedCspListener implements IEventListener {
	public function __construct(
		private AppointmentEmbed $appointmentEmbed,
	) {
	}

	public function handle(Event $event): void {
		if (!($event instanceof AddContentSecurityPolicyEvent)) {
			return;
		}

		$origins = $this->appointmentEmbed->allowedOrigins();
		if ($origins === []) {
			return;
		}

		$policy = new ContentSecurityPolicy();
		foreach ($origins as $origin) {
			$policy->addAllowedFrameAncestorDomain($origin);
		}
		$event->addPolicy($policy);
	}
}
