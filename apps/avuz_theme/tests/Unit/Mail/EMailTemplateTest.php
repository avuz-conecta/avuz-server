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
		$marker = strpos($html, 'class="wrapper header');
		$this->assertNotFalse($marker, 'header marker missing');
		$start = strrpos(substr($html, 0, $marker), '<table');
		$this->assertNotFalse($start, 'header table start missing');
		$end = strpos($html, 'class="spacer', $start);
		$this->assertNotFalse($end, 'header spacer missing');
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

	private function fullSampleHtml(): string {
		$template = $this->templateNamed('Avuz Conecta');
		$template->addHeader();
		$template->addHeading('Agendamento confirmado');
		$template->addBodyText('Até lá.');
		$template->addBodyButton('Ver agenda', 'https://app3.example/agenda');
		$template->addFooter('Avuz Conecta');
		return $template->renderHtml();
	}

	public function testRenderHtmlDropsTheFixedMinimumWidths(): void {
		$html = $this->fullSampleHtml();

		$this->assertStringNotContainsString('min-width:580px', $html);
		$this->assertStringNotContainsString('min-width:490px', $html);
		$this->assertStringContainsString('min-width:0', $html);
	}

	public function testRenderHtmlCapsTheFixedWidthsInsteadOfForcingThem(): void {
		$html = preg_replace('/<!--\[if mso\]>.*?<!\[endif\]-->/s', '', $this->fullSampleHtml());

		$this->assertSame(0, preg_match('/(?<!max-)(?<!min-)width:(580|550)px/', $html));
		$this->assertStringContainsString('width:100%;max-width:580px', $html);
		$this->assertStringContainsString('width:100%;max-width:550px', $html);
	}

	public function testRenderHtmlLeavesOtherWidthsUntouched(): void {
		$html = $this->fullSampleHtml();

		$this->assertStringContainsString('max-width:610px', $html);
		$this->assertStringContainsString('width:140px', $html);
		$this->assertStringNotContainsString('max-width:610px;max-width', $html);
	}

	public function testRenderHtmlStaysIdenticalWhenCalledTwice(): void {
		$template = $this->templateNamed('Avuz Conecta');
		$template->addHeader();
		$template->addFooter('Avuz Conecta');

		$this->assertSame($template->renderHtml(), $template->renderHtml());
	}

	public function testRenderHtmlRestoresTheFixedColumnWidthsForOutlookDesktopOnce(): void {
		$template = $this->templateNamed('Avuz Conecta');
		$template->addHeader();
		$template->addFooter('Avuz Conecta');
		$template->renderHtml();
		$html = $template->renderHtml();

		$this->assertSame(1, substr_count($html, '<!--[if mso]>'));
		$mso = substr($html, (int)strpos($html, '<!--[if mso]>'));
		$mso = substr($mso, 0, (int)strpos($mso, '<![endif]-->'));
		$this->assertStringContainsString('width:580px!important', $mso);
		$this->assertStringContainsString('width:550px!important', $mso);
		$this->assertLessThan(strpos($html, '</head>'), strpos($html, '<!--[if mso]>'));
	}

	public function testHeaderHeightIsHalfTheLogoPixelHeight(): void {
		$expectedHeight = (int)round(getimagesize(self::LOGO_PATH)[1] / 2);

		$this->assertStringContainsString('height="' . $expectedHeight . '"', $this->headerHtml());
	}

	public function testLightLogoAssetStaysSmallAndTwiceTheDisplayWidth(): void {
		$this->assertFileExists(self::LOGO_PATH);
		$this->assertLessThan(self::LOGO_MAXIMUM_BYTES, filesize(self::LOGO_PATH));
		$this->assertSame(self::LOGO_PIXEL_WIDTH, getimagesize(self::LOGO_PATH)[0]);
	}
}
