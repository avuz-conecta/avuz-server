<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\Controller;

use OCA\AvuzTheme\Service\ZammadConfig;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\Attribute\NoAdminRequired;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\NotFoundResponse;
use OCP\AppFramework\Http\RedirectResponse;
use OCP\IRequest;

class SupportController extends Controller {
	public function __construct(
		string $appName,
		IRequest $request,
		private ZammadConfig $zammad,
	) {
		parent::__construct($appName, $request);
	}

	#[NoAdminRequired]
	#[NoCSRFRequired]
	public function redirect(): RedirectResponse|NotFoundResponse {
		$url = $this->zammad->portalUrl();
		if ($url === '') {
			return new NotFoundResponse();
		}
		return new RedirectResponse($url);
	}
}
