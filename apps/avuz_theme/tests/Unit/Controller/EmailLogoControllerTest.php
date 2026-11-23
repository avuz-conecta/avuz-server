<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\Tests\Unit\Controller;

use OCA\AvuzTheme\Controller\EmailLogoController;
use OCA\AvuzTheme\Service\EmailLogo;
use OCP\AppFramework\Http;
use OCP\IRequest;
use PHPUnit\Framework\TestCase;

class EmailLogoControllerTest extends TestCase {
	private const CURRENT = ['url' => 'https://ramires.example/index.php/apps/avuz_theme/email-logo?v=abc', 'width' => 120, 'height' => 40];

	private function controller(EmailLogo $emailLogo, ?array $upload = null): EmailLogoController {
		$request = $this->createMock(IRequest::class);
		$request->method('getUploadedFile')->willReturn($upload);
		return new EmailLogoController('avuz_theme', $request, $emailLogo);
	}

	public function testServesNothingWhenNoLogoWasUploaded(): void {
		$emailLogo = $this->createMock(EmailLogo::class);
		$emailLogo->method('content')->willReturn(null);

		$response = $this->controller($emailLogo)->show();

		$this->assertSame(Http::STATUS_NOT_FOUND, $response->getStatus());
	}

	// Content-Type and Cache-Control need a running server (Response::getHeaders): checked on HML with curl -I
	public function testServesTheLogo(): void {
		$emailLogo = $this->createMock(EmailLogo::class);
		$emailLogo->method('content')->willReturn('png-bytes');

		$response = $this->controller($emailLogo)->show();

		$this->assertSame(Http::STATUS_OK, $response->getStatus());
		$this->assertSame('png-bytes', $response->render());
	}

	public function testUploadStoresTheFileAndReturnsTheNewLogo(): void {
		$file = tempnam(sys_get_temp_dir(), 'logo');
		file_put_contents($file, 'image-bytes');
		$emailLogo = $this->createMock(EmailLogo::class);
		$emailLogo->expects($this->once())->method('save')->with('image-bytes');
		$emailLogo->method('current')->willReturn(self::CURRENT);

		$response = $this->controller($emailLogo, ['tmp_name' => $file, 'error' => UPLOAD_ERR_OK, 'size' => 11])->upload();
		unlink($file);

		$this->assertSame(Http::STATUS_OK, $response->getStatus());
		$this->assertSame(['logo' => self::CURRENT], $response->getData());
	}

	public function testUploadExplainsWhyAFileIsRefused(): void {
		$file = tempnam(sys_get_temp_dir(), 'logo');
		file_put_contents($file, 'not an image');
		$emailLogo = $this->createMock(EmailLogo::class);
		$emailLogo->method('save')->willThrowException(new \InvalidArgumentException('Envie uma imagem PNG ou JPEG.'));

		$response = $this->controller($emailLogo, ['tmp_name' => $file, 'error' => UPLOAD_ERR_OK, 'size' => 12])->upload();
		unlink($file);

		$this->assertSame(Http::STATUS_BAD_REQUEST, $response->getStatus());
		$this->assertSame(['message' => 'Envie uma imagem PNG ou JPEG.'], $response->getData());
	}

	public function testUploadWithoutAFileIsRefused(): void {
		$emailLogo = $this->createMock(EmailLogo::class);
		$emailLogo->expects($this->never())->method('save');

		$response = $this->controller($emailLogo, null)->upload();

		$this->assertSame(Http::STATUS_BAD_REQUEST, $response->getStatus());
	}

	public function testRemoveGoesBackToTheAvuzLogo(): void {
		$emailLogo = $this->createMock(EmailLogo::class);
		$emailLogo->expects($this->once())->method('remove');

		$response = $this->controller($emailLogo)->remove();

		$this->assertSame(['logo' => null], $response->getData());
	}
}
