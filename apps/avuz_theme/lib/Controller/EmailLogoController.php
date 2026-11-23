<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\Controller;

use OCA\AvuzTheme\Service\EmailLogo;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\Attribute\NoCSRFRequired;
use OCP\AppFramework\Http\Attribute\PublicPage;
use OCP\AppFramework\Http\DataDisplayResponse;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IRequest;

/**
 * The client's e-mail logo (Deck #516): mail clients fetch it anonymously (show);
 * Administração › Personalização › "Logo dos e-mails" (js/email-logo-admin.js)
 * uploads and removes it, admins only.
 */
class EmailLogoController extends Controller {
	private const CACHE_SECONDS = 86400;
	private const UPLOAD_FIELD = 'logo';

	public function __construct(
		string $appName,
		IRequest $request,
		private EmailLogo $emailLogo,
	) {
		parent::__construct($appName, $request);
	}

	#[PublicPage]
	#[NoCSRFRequired]
	public function show(): DataDisplayResponse {
		$png = $this->emailLogo->content();
		if ($png === null) {
			return new DataDisplayResponse('', Http::STATUS_NOT_FOUND);
		}
		// Upload changes the ?v= in the e-mail, so a day of caching never shows an old logo
		return new DataDisplayResponse($png, Http::STATUS_OK, [
			'Content-Type' => 'image/png',
			'Cache-Control' => 'public, max-age=' . self::CACHE_SECONDS,
		]);
	}

	public function upload(): JSONResponse {
		$file = $this->request->getUploadedFile(self::UPLOAD_FIELD);
		if (!self::isReadableUpload($file)) {
			return new JSONResponse(['message' => 'Escolha uma imagem PNG ou JPEG.'], Http::STATUS_BAD_REQUEST);
		}
		try {
			$this->emailLogo->save((string) file_get_contents($file['tmp_name']));
		} catch (\InvalidArgumentException $exception) {
			return new JSONResponse(['message' => $exception->getMessage()], Http::STATUS_BAD_REQUEST);
		}
		return new JSONResponse(['logo' => $this->emailLogo->current()]);
	}

	public function remove(): JSONResponse {
		$this->emailLogo->remove();
		return new JSONResponse(['logo' => null]);
	}

	/** An upload that arrived whole and whose temp file can be read */
	private static function isReadableUpload(mixed $file): bool {
		if (!is_array($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
			return false;
		}
		$path = (string) ($file['tmp_name'] ?? '');
		return $path !== '' && is_file($path) && is_readable($path);
	}
}
