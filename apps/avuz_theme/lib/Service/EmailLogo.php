<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\Service;

use OCP\Files\IAppData;
use OCP\Files\NotFoundException;
use OCP\Files\SimpleFS\ISimpleFolder;
use OCP\IAppConfig;
use OCP\IURLGenerator;

/**
 * The client's logo for the top of every e-mail this tenant sends (Deck #516),
 * uploaded in Administração › Personalização › "Logo dos e-mails". Without one,
 * e-mails keep the Avuz Conecta logo (Mail/EMailTemplate).
 *
 * Stored once in the app data (S3-safe), always re-encoded as PNG so only plain
 * pixels reach mail clients.
 */
class EmailLogo {
	private const APP_ID = 'avuz_theme';
	private const FOLDER = 'email-logo';
	private const FILE = 'logo.png';
	private const SHOW_ROUTE = 'avuz_theme.email_logo.show';
	private const VERSION_KEY = 'email_logo_version';
	private const WIDTH_KEY = 'email_logo_width';
	private const HEIGHT_KEY = 'email_logo_height';
	private const MAX_BYTES = 1024 * 1024;
	private const MAX_SOURCE_PIXELS = 2000;
	private const ACCEPTED_TYPES = [IMAGETYPE_PNG, IMAGETYPE_JPEG];
	// Header box, same width as the Avuz logo it replaces
	private const MAX_WIDTH = 140;
	private const MAX_HEIGHT = 56;

	public function __construct(
		private IAppData $appData,
		private IAppConfig $appConfig,
		private IURLGenerator $urlGenerator,
	) {
	}

	/**
	 * @throws \InvalidArgumentException with a message for the admin page
	 */
	public function save(string $bytes): void {
		if (strlen($bytes) > self::MAX_BYTES) {
			throw new \InvalidArgumentException('O logo pode ter no máximo 1 MB.');
		}
		$size = @getimagesizefromstring($bytes);
		if ($size === false || !in_array($size[2], self::ACCEPTED_TYPES, true)) {
			throw new \InvalidArgumentException('Envie uma imagem PNG ou JPEG.');
		}
		[$width, $height] = $size;
		if ($width < 1 || $height < 1 || $width > self::MAX_SOURCE_PIXELS || $height > self::MAX_SOURCE_PIXELS) {
			throw new \InvalidArgumentException('O logo pode ter no máximo 2000 × 2000 pixels.');
		}

		$this->storeFile($this->toPng($bytes));
		$this->appConfig->setValueString(self::APP_ID, self::WIDTH_KEY, (string) $width);
		$this->appConfig->setValueString(self::APP_ID, self::HEIGHT_KEY, (string) $height);
		$this->appConfig->setValueString(self::APP_ID, self::VERSION_KEY, bin2hex(random_bytes(6)));
	}

	public function remove(): void {
		try {
			$this->folder()->getFile(self::FILE)->delete();
		} catch (NotFoundException) {
			// already gone
		}
		foreach ([self::VERSION_KEY, self::WIDTH_KEY, self::HEIGHT_KEY] as $key) {
			$this->appConfig->deleteKey(self::APP_ID, $key);
		}
	}

	/**
	 * @return array{url: string, width: int, height: int}|null the header logo, fitted to 140 × 56
	 */
	public function current(): ?array {
		$version = $this->appConfig->getValueString(self::APP_ID, self::VERSION_KEY);
		if ($version === '') {
			return null;
		}
		[$width, $height] = self::fit(
			(int) $this->appConfig->getValueString(self::APP_ID, self::WIDTH_KEY),
			(int) $this->appConfig->getValueString(self::APP_ID, self::HEIGHT_KEY),
		);
		return [
			'url' => $this->urlGenerator->linkToRouteAbsolute(self::SHOW_ROUTE) . '?v=' . rawurlencode($version),
			'width' => $width,
			'height' => $height,
		];
	}

	/** The stored PNG, or null when the tenant has none */
	public function content(): ?string {
		try {
			return $this->folder()->getFile(self::FILE)->getContent();
		} catch (NotFoundException) {
			return null;
		}
	}

	/**
	 * @return array{0: int, 1: int} the size that fits in the header box, never enlarged
	 */
	private static function fit(int $width, int $height): array {
		if ($width < 1 || $height < 1) {
			return [self::MAX_WIDTH, self::MAX_HEIGHT];
		}
		$scale = min(1, self::MAX_WIDTH / $width, self::MAX_HEIGHT / $height);
		return [max(1, (int) round($width * $scale)), max(1, (int) round($height * $scale))];
	}

	private function toPng(string $bytes): string {
		$image = @imagecreatefromstring($bytes);
		if ($image === false) {
			throw new \InvalidArgumentException('Envie uma imagem PNG ou JPEG.');
		}
		imagealphablending($image, false);
		imagesavealpha($image, true);
		ob_start();
		imagepng($image);
		return (string) ob_get_clean();
	}

	private function storeFile(string $png): void {
		$folder = $this->folder();
		try {
			$folder->getFile(self::FILE)->putContent($png);
		} catch (NotFoundException) {
			$folder->newFile(self::FILE, $png);
		}
	}

	private function folder(): ISimpleFolder {
		try {
			return $this->appData->getFolder(self::FOLDER);
		} catch (NotFoundException) {
			return $this->appData->newFolder(self::FOLDER);
		}
	}
}
