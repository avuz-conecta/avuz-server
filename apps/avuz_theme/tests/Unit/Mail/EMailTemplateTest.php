<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\Tests\Unit\Mail;

use OCA\AvuzTheme\Mail\EMailTemplate;
use OCP\Defaults;
use OCP\IURLGenerator;
use OCP\L10N\IFactory;
use PHPUnit\Framework\TestCase;

class EMailTemplateTest extends TestCase {
	private const BASE_URL = 'https://app3.example';
	private const LOGO_PATH = __DIR__ . '/../../../img/logo-email.png';
	private const LOGO_URL = 'https://app3.example/apps/avuz_theme/img/logo-email.png';
	private const LOGO_PIXEL_WIDTH = 280;
	private const LOGO_MAXIMUM_BYTES = 30 * 1024;

	private function templateNamed(string $name): EMailTemplate {
		$defaults = $this->createStub(Defaults::class);
		$defaults->method('getName')->willReturn($name);
		$defaults->method('getLogo')->willReturn('/core/img/logo/logo.svg');
		$urlGenerator = $this->createStub(IURLGenerator::class);
		$urlGenerator->method('getAbsoluteURL')->willReturnCallback(
			static fn (string $path): string => self::BASE_URL . $path,
		);
		return new EMailTemplate($defaults, $urlGenerator, $this->createStub(IFactory::class), null, null, 'test.mail', []);
	}

	private function headerHtml(string $name = 'Avuz Conecta'): string {
		$template = $this->templateNamed($name);
		$template->addHeader();
		return $template->renderHtml();
	}

	private function headerPart(string $html): string {
		$marker = (int)strpos($html, 'class="wrapper header');
		$start = (int)strrpos(substr($html, 0, $marker), '<table');
		$end = (int)strpos($html, 'class="spacer', $start);
		return substr($html, $start, $end - $start);
	}

	public function testAddHeaderShowsTheLightLogoAtHalfItsPixelWidth(): void {
		$html = $this->headerHtml();

		$this->assertStringContainsString('src="' . self::LOGO_URL . '"', $html);
		$this->assertStringContainsString('width="140"', $html);
		$this->assertStringContainsString('height="46"', $html);
		$this->assertStringContainsString('width:140px;max-width:140px;height:auto', $html);
	}

	public function testAddHeaderLeavesOutThePill(): void {
		$body = $this->headerPart($this->headerHtml());

		$this->assertStringNotContainsString('border-radius', $body);
		$this->assertStringNotContainsString('min-width:175px', $body);
		$this->assertStringNotContainsString('<center', $body);
	}

	public function testAddHeaderUsesAPresentationTableWithBreathingRoom(): void {
		$body = $this->headerPart($this->headerHtml());

		$this->assertStringContainsString('role="presentation"', $body);
		$this->assertStringContainsString('padding:20px 0', $body);
	}

	public function testAddHeaderKeepsTheSpacerBeforeTheBody(): void {
		$this->assertStringContainsString('<td height="40px"', $this->headerHtml());
	}

	public function testAddHeaderTwiceAddsTheLogoOnce(): void {
		$template = $this->templateNamed('Avuz Conecta');
		$template->addHeader();
		$template->addHeader();

		$this->assertSame(1, substr_count($template->renderHtml(), 'logo-email.png'));
	}

	public function testAddHeaderEscapesTheThemingNameInTheAltText(): void {
		$html = $this->headerHtml('Avuz "<b>" & Co');

		$this->assertStringContainsString('alt="Avuz &quot;&lt;b&gt;&quot; &amp; Co"', $html);
		$this->assertStringNotContainsString('<b>', $html);
	}

	public function testRenderHtmlKeepsHeadingAndBodyAfterTheCompactHeader(): void {
		$template = $this->templateNamed('Avuz Conecta');
		$template->addHeader();
		$template->addHeading('Agendamento confirmado');
		$template->addBodyText('Até lá.');
		$template->addBodyButton('Ver agenda', 'https://app3.example/agenda');
		$template->addFooter('Avuz Conecta');
		$html = $template->renderHtml();

		$this->assertLessThan(strpos($html, 'Agendamento confirmado'), strpos($html, 'logo-email.png'));
		$this->assertStringContainsString('Ver agenda', $html);
	}

	public function testLightLogoAssetStaysSmallAndTwiceTheDisplayWidth(): void {
		$this->assertFileExists(self::LOGO_PATH);
		$this->assertLessThan(self::LOGO_MAXIMUM_BYTES, filesize(self::LOGO_PATH));
		$this->assertSame(self::LOGO_PIXEL_WIDTH, getimagesize(self::LOGO_PATH)[0]);
	}
}
