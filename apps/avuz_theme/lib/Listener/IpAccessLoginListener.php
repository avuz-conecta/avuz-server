<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\Listener;

use OCA\AvuzTheme\Service\IpAccess;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\IUserSession;
use OCP\User\Events\PostLoginEvent;
use Psr\Log\LoggerInterface;

/**
 * Cancels a login (browser, app password, sync/DAV client) of a non-admin
 * account from an IP outside the allowlist:
 * - browser login form: back to the login page, which explains why
 *   (short-lived avuz_ip_blocked cookie, js/ip-access-login.js);
 * - WebDAV/CalDAV/CardDAV clients: 401 with the reason (Nextcloud turns any
 *   other exception there into a 503);
 * - anything else: the session is logged out, so Nextcloud aborts the login.
 *
 * @template-implements IEventListener<PostLoginEvent>
 */
class IpAccessLoginListener implements IEventListener {
	public function __construct(
		private IpAccess $ipAccess,
		private IUserSession $userSession,
		private IRequest $request,
		private IURLGenerator $urlGenerator,
		private LoggerInterface $logger,
	) {
	}

	public function handle(Event $event): void {
		if (!$event instanceof PostLoginEvent || !$this->ipAccess->isBlocked($event->getUser())) {
			return;
		}
		$this->logger->warning('Login blocked by IP restriction', [
			'app' => 'avuz_theme',
			'user' => $event->getUser()->getUID(),
			'ip' => $this->ipAccess->currentIp(),
		]);
		$this->userSession->logout();

		$path = $this->request->getRequestUri();
		if (str_contains($path, '/remote.php/')) {
			throw new \Sabre\DAV\Exception\NotAuthenticated($this->ipAccess->blockedMessage());
		}
		if ($this->request->getMethod() === 'POST' && preg_match('#/login/?(\?|$)#', $path) && !headers_sent()) {
			// Browser login form: straight back to it, with the explanation
			setcookie('avuz_ip_blocked', $this->ipAccess->currentIp(), [
				'expires' => time() + 120,
				'path' => '/',
				'samesite' => 'Lax',
			]);
			header('Location: ' . $this->urlGenerator->linkToRoute('core.login.showLoginForm'), true, 303);
			exit;
		}
	}
}
