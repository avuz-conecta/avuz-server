<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\Tests\Unit\Service;

use OCA\AvuzTheme\Service\EmailLogo;
use OCP\Files\IAppData;
use OCP\Files\NotFoundException;
use OCP\Files\SimpleFS\ISimpleFile;
use OCP\Files\SimpleFS\ISimpleFolder;
use OCP\IAppConfig;
use OCP\IURLGenerator;
use PHPUnit\Framework\TestCase;

class EmailLogoTest extends TestCase {
	private const SHOW_URL = 'https://ramires.example/index.php/apps/avuz_theme/email-logo';

	/** @var array<string, string> */
	private array $config = [];
	private ?string $storedPng = null;

	private function emailLogo(): EmailLogo {
		$appConfig = $this->createMock(IAppConfig::class);
		$appConfig->method('getValueString')->willReturnCallback(
			fn (string $app, string $key, string $default = '') => $this->config[$key] ?? $default,
		);
		$appConfig->method('setValueString')->willReturnCallback(
			function (string $app, string $key, string $value): bool {
				$this->config[$key] = $value;
				return true;
			},
		);
		$appConfig->method('deleteKey')->willReturnCallback(
			function (string $app, string $key): void {
				unset($this->config[$key]);
			},
		);

		$file = $this->createMock(ISimpleFile::class);
		$file->method('getContent')->willReturnCallback(fn () => (string) $this->storedPng);
		$file->method('putContent')->willReturnCallback(function (string $content): void {
			$this->storedPng = $content;
		});
		$file->method('delete')->willReturnCallback(function (): void {
			$this->storedPng = null;
		});
		$folder = $this->createMock(ISimpleFolder::class);
		$folder->method('getFile')->willReturnCallback(function () use ($file) {
			if ($this->storedPng === null) {
				throw new NotFoundException();
			}
			return $file;
		});
		$folder->method('newFile')->willReturnCallback(function (string $name, $content = null) use ($file) {
			$this->storedPng = (string) $content;
			return $file;
		});
		$appData = $this->createMock(IAppData::class);
		$appData->method('getFolder')->willReturn($folder);
		$appData->method('newFolder')->willReturn($folder);

		$urlGenerator = $this->createMock(IURLGenerator::class);
		$urlGenerator->method('linkToRouteAbsolute')->willReturn(self::SHOW_URL);

		return new EmailLogo($appData, $appConfig, $urlGenerator);
	}

	private static function image(int $width, int $height, int $type = IMAGETYPE_PNG): string {
		$image = imagecreatetruecolor($width, $height);
		imagefill($image, 0, 0, (int) imagecolorallocate($image, 200, 30, 30));
		ob_start();
		$type === IMAGETYPE_PNG ? imagepng($image) : imagejpeg($image);
		return (string) ob_get_clean();
	}

	public function testHasNoLogoUntilOneIsUploaded(): void {
		$this->assertNull($this->emailLogo()->current());
	}

	public function testStoresAnUploadedPngAndOffersItFittedToTheHeader(): void {
		$logo = $this->emailLogo();

		$logo->save(self::image(560, 140));

		$current = $logo->current();
		$this->assertNotNull($current);
		$this->assertStringStartsWith(self::SHOW_URL . '?v=', $current['url']);
		$this->assertSame(['width' => 140, 'height' => 35], ['width' => $current['width'], 'height' => $current['height']]);
		$this->assertSame(IMAGETYPE_PNG, getimagesizefromstring((string) $logo->content())[2]);
	}

	public function testStoresAJpegAsPng(): void {
		$logo = $this->emailLogo();

		$logo->save(self::image(300, 100, IMAGETYPE_JPEG));

		$this->assertSame(IMAGETYPE_PNG, getimagesizefromstring((string) $logo->content())[2]);
	}

	public function testFitsATallLogoByItsHeight(): void {
		$logo = $this->emailLogo();

		$logo->save(self::image(100, 200));

		$current = $logo->current();
		$this->assertSame(['width' => 28, 'height' => 56], ['width' => $current['width'], 'height' => $current['height']]);
	}

	public function testKeepsASmallLogoAtItsOwnSize(): void {
		$logo = $this->emailLogo();

		$logo->save(self::image(80, 30));

		$current = $logo->current();
		$this->assertSame(['width' => 80, 'height' => 30], ['width' => $current['width'], 'height' => $current['height']]);
	}

	public function testRefusesSomethingThatIsNotAnImage(): void {
		$this->expectException(\InvalidArgumentException::class);

		$this->emailLogo()->save('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
	}

	public function testRefusesAFileOverOneMegabyte(): void {
		$this->expectException(\InvalidArgumentException::class);

		$this->emailLogo()->save(str_repeat('a', 1024 * 1024 + 1));
	}

	public function testRefusesAnImageOverTwoThousandPixels(): void {
		$this->expectException(\InvalidArgumentException::class);

		$this->emailLogo()->save(self::image(2001, 10));
	}

	public function testRemovingTheLogoGoesBackToNone(): void {
		$logo = $this->emailLogo();
		$logo->save(self::image(300, 100));

		$logo->remove();

		$this->assertNull($logo->current());
		$this->assertNull($logo->content());
	}

	public function testEachUploadGetsANewAddressSoCachedLogosRefresh(): void {
		$logo = $this->emailLogo();
		$logo->save(self::image(300, 100));
		$first = $logo->current()['url'];

		$logo->save(self::image(300, 100));

		$this->assertNotSame($first, $logo->current()['url']);
	}
}
