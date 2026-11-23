<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\Listener;

use OCP\AppFramework\Http\ContentSecurityPolicy;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Security\CSP\AddContentSecurityPolicyEvent;

/**
 * Lets the browser look up addresses on ViaCEP: the Formulários address
 * block fills the address from the CEP (Deck #449), also on public form
 * pages. Core's CSPMiddleware merges this into every app response's policy.
 *
 * @template-implements IEventListener<AddContentSecurityPolicyEvent>
 */
class ViaCepCspListener implements IEventListener {
	public const VIACEP_ORIGIN = 'https://viacep.com.br';

	public function handle(Event $event): void {
		if (!($event instanceof AddContentSecurityPolicyEvent)) {
			return;
		}

		$policy = new ContentSecurityPolicy();
		$policy->addAllowedConnectDomain(self::VIACEP_ORIGIN);
		$event->addPolicy($policy);
	}
}
