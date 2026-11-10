<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\Controller;

use OCA\AvuzTheme\Service\IpAccess;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IRequest;

/**
 * Admin-only endpoints for Administração › Segurança › "Restrição de acesso
 * por IP" (js/ip-access-admin.js). No #[NoAdminRequired]: admins only.
 */
class IpAccessController extends Controller {
	public function __construct(
		string $appName,
		IRequest $request,
		private IpAccess $ipAccess,
	) {
		parent::__construct($appName, $request);
	}

	public function show(): JSONResponse {
		return new JSONResponse($this->state());
	}

	public function update(bool $enabled = false, array $rules = []): JSONResponse {
		try {
			$this->ipAccess->save($enabled, $rules);
		} catch (\InvalidArgumentException $e) {
			return new JSONResponse(['message' => $e->getMessage()], Http::STATUS_BAD_REQUEST);
		}
		return new JSONResponse($this->state());
	}

	private function state(): array {
		$ip = $this->ipAccess->currentIp();
		return [
			'enabled' => $this->ipAccess->isEnabled(),
			'rules' => $this->ipAccess->getRules(),
			'currentIp' => $ip,
			'currentIpAllowed' => $this->ipAccess->isIpAllowed($ip),
		];
	}
}
