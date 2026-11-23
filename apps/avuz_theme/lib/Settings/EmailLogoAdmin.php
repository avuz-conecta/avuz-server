<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\Settings;

use OCA\AvuzTheme\Service\EmailLogo;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\IURLGenerator;
use OCP\Settings\ISettings;
use OCP\Util;

/** Administração › Personalização › "Logo dos e-mails" (Deck #516) */
class EmailLogoAdmin implements ISettings {
	// Same file and size as the Avuz logo in Mail/EMailTemplate
	private const AVUZ_LOGO = '/apps/avuz_theme/img/logo-email.png';
	private const AVUZ_LOGO_WIDTH = 140;
	private const AVUZ_LOGO_HEIGHT = 49;

	public function __construct(
		private EmailLogo $emailLogo,
		private IURLGenerator $urlGenerator,
	) {
	}

	public function getForm(): TemplateResponse {
		Util::addStyle('avuz_theme', 'email-logo-admin');
		Util::addScript('avuz_theme', 'email-logo-admin');
		return new TemplateResponse('avuz_theme', 'admin-email-logo', [
			'logo' => $this->emailLogo->current(),
			'avuzLogo' => [
				'url' => $this->urlGenerator->getAbsoluteURL(self::AVUZ_LOGO),
				'width' => self::AVUZ_LOGO_WIDTH,
				'height' => self::AVUZ_LOGO_HEIGHT,
			],
		], '');
	}

	public function getSection(): string {
		return 'theming';
	}

	public function getPriority(): int {
		return 90;
	}
}
