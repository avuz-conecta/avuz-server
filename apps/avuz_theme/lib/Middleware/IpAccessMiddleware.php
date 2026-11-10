<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\Middleware;

use OCA\AvuzTheme\Service\IpAccess;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\JSONResponse;
use OCP\AppFramework\Http\RedirectResponse;
use OCP\AppFramework\Http\Response;
use OCP\AppFramework\Middleware;
use OCP\AppFramework\OCSController;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\IUserSession;

/**
 * Global middleware: a session that was opened before the IP rules changed
 * (or from another network) is closed as soon as a non-admin account makes a
 * request from an IP outside the allowlist. Pages go back to the login screen
 * with the explanation; API calls get a 403.
 */
class IpAccessMiddleware extends Middleware {
	public function __construct(
		private IpAccess $ipAccess,
		private IUserSession $userSession,
		private IRequest $request,
		private IURLGenerator $urlGenerator,
	) {
	}

	public function beforeController($controller, $methodName): void {
		$user = $this->userSession->getUser();
		if ($user === null || !$this->ipAccess->isBlocked($user)) {
			return;
		}
		$ip = $this->ipAccess->currentIp();
		$this->userSession->logout();
		throw new IpAccessDeniedException($this->ipAccess->blockedMessage(), $ip, $controller instanceof OCSController);
	}

	public function afterException($controller, $methodName, \Exception $exception): Response {
		if (!$exception instanceof IpAccessDeniedException) {
			throw $exception;
		}
		$wantsJson = $exception->isOcs
			|| str_contains((string)$this->request->getHeader('Accept'), 'application/json')
			|| $this->request->getHeader('OCS-APIREQUEST') !== ''
			|| strtolower((string)$this->request->getHeader('X-Requested-With')) === 'xmlhttprequest';
		if ($wantsJson) {
			return new JSONResponse(['message' => $exception->getMessage()], Http::STATUS_FORBIDDEN);
		}
		if (!headers_sent()) {
			setcookie('avuz_ip_blocked', $exception->ip, ['expires' => time() + 120, 'path' => '/', 'samesite' => 'Lax']);
		}
		return new RedirectResponse($this->urlGenerator->linkToRoute('core.login.showLoginForm'));
	}
}
