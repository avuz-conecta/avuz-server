<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\Listener;

use OCA\AvuzTheme\Service\ZammadConfig;
use OCP\AppFramework\Http\ContentSecurityPolicy;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\Security\CSP\AddContentSecurityPolicyEvent;

/**
 * @template-implements IEventListener<AddContentSecurityPolicyEvent>
 */
class ZammadCspListener implements IEventListener {
	public function __construct(
		private ZammadConfig $zammad,
	) {
	}

	public function handle(Event $event): void {
		if (!($event instanceof AddContentSecurityPolicyEvent)) {
			return;
		}
		if (!$this->zammad->isChatEnabled()) {
			return;
		}

		$https = $this->zammad->host();
		$wss = preg_replace('/^http/', 'ws', $https);

		$policy = new ContentSecurityPolicy();
		$policy->addAllowedScriptDomain($https);
		$policy->addAllowedConnectDomain($https);
		$policy->addAllowedConnectDomain($wss);
		$policy->addAllowedImageDomain($https);
		$policy->addAllowedStyleDomain($https);
		$policy->addAllowedFontDomain($https);

		$event->addPolicy($policy);
	}
}
