<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\Mail;

use OC\Mail\EMailTemplate as BaseEMailTemplate;

/**
 * E-mail template with a compact header: the Avuz Conecta logo centered on
 * white, no circle that mobile clients stretch into a full-width pill.
 */
class EMailTemplate extends BaseEMailTemplate {
	private const EMAIL_LOGO = 'apps/avuz_theme/img/logo-email.png';
	private const EMAIL_LOGO_FILE = __DIR__ . '/../../img/logo-email.png';
	private const EMAIL_LOGO_WIDTH = 140;
	// logo-email.png is 280x91 (2x for retina): 91 / 2 rounded
	private const EMAIL_LOGO_HEIGHT = 46;

	private const COMPACT_HEADER = <<<EOF
<table role="presentation" align="center" width="100%%" class="wrapper header float-center" style="Margin:0 auto;background:#fff;border-collapse:collapse;border-spacing:0;margin:0 auto;padding:0;text-align:center;vertical-align:top;width:100%%">
	<tr>
		<td align="center" style="Margin:0;border-collapse:collapse!important;margin:0;padding:20px 0;text-align:center;vertical-align:middle">
			<img class="logo" src="%s" alt="%s" width="%d" height="%d" style="display:block;margin:0 auto;border:0;outline:0;width:%dpx;max-width:%dpx;height:auto;-ms-interpolation-mode:bicubic;text-decoration:none">
		</td>
	</tr>
</table>
<table class="spacer float-center" style="Margin:0 auto;border-collapse:collapse;border-spacing:0;float:none;margin:0 auto;padding:0;text-align:center;vertical-align:top;width:100%%">
	<tbody>
	<tr style="padding:0;text-align:left;vertical-align:top">
		<td height="40px" style="-moz-hyphens:auto;-webkit-hyphens:auto;Margin:0;border-collapse:collapse!important;color:#0a0a0a;font-size:80px;font-weight:400;hyphens:auto;line-height:80px;margin:0;mso-line-height-rule:exactly;padding:0;text-align:left;vertical-align:top;word-wrap:break-word">&#xA0;</td>
	</tr>
	</tbody>
</table>
EOF;

	public function addHeader(): void {
		if ($this->headerAdded) {
			return;
		}
		$this->headerAdded = true;

		$logoUrl = file_exists(self::EMAIL_LOGO_FILE)
			? $this->urlGenerator->getAbsoluteURL('/' . self::EMAIL_LOGO)
			: $this->urlGenerator->getAbsoluteURL($this->themingDefaults->getLogo(false));

		$this->htmlBody .= sprintf(
			self::COMPACT_HEADER,
			htmlspecialchars($logoUrl),
			htmlspecialchars($this->themingDefaults->getName()),
			self::EMAIL_LOGO_WIDTH,
			self::EMAIL_LOGO_HEIGHT,
			self::EMAIL_LOGO_WIDTH,
			self::EMAIL_LOGO_WIDTH,
		);
	}
}
