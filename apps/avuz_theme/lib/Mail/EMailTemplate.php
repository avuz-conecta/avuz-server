<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\Mail;

use OC\Mail\EMailTemplate as BaseEMailTemplate;

/**
 * Custom Email Template for Avuz Conecta
 *
 * Allows using a different logo and background color for emails
 * without affecting the main UI theming.
 */
class EMailTemplate extends BaseEMailTemplate {

	/**
	 * Custom email logo path (relative to avuz_theme app img folder)
	 * Change this to use a different logo in emails
	 */
	private const EMAIL_LOGO = 'apps/avuz_theme/img/logo2.png';

	/**
	 * Custom background color for the circular logo area in emails
	 * Set to empty string to use the default primary color
	 */
	private const EMAIL_LOGO_BACKGROUND = '#f2f6fb';

	/**
	 * Adds a header to the email with custom logo support
	 */
	public function addHeader(): void {
		if ($this->headerAdded) {
			return;
		}
		$this->headerAdded = true;

		$logoSizeDimensions = '';
		if ($this->logoWidth && $this->logoHeight) {
			$logoSizeDimensions = ' width="' . $this->logoWidth . '" height="' . $this->logoHeight . '"';
		}

		// Use custom email logo if it exists, otherwise fall back to default
		$customLogoPath = \OC::$SERVERROOT . '/' . self::EMAIL_LOGO;
		if (self::EMAIL_LOGO !== '' && file_exists($customLogoPath)) {
			$logoUrl = $this->urlGenerator->getAbsoluteURL('/' . self::EMAIL_LOGO);
		} else {
			$logoUrl = $this->urlGenerator->getAbsoluteURL($this->themingDefaults->getLogo(false));
		}

		// Use custom background color if set, otherwise use default primary color
		$backgroundColor = self::EMAIL_LOGO_BACKGROUND !== ''
			? self::EMAIL_LOGO_BACKGROUND
			: $this->themingDefaults->getDefaultColorPrimary();

		$this->htmlBody .= vsprintf($this->header, [
			$backgroundColor,
			$logoUrl,
			$this->themingDefaults->getName(),
			$logoSizeDimensions
		]);
	}
}
