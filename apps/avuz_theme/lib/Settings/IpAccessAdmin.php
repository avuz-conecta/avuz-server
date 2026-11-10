<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\Settings;

use OCP\AppFramework\Http\TemplateResponse;
use OCP\Settings\ISettings;
use OCP\Util;

/** Administração › Segurança › "Restrição de acesso por IP" */
class IpAccessAdmin implements ISettings {
	public function getForm(): TemplateResponse {
		Util::addStyle('avuz_theme', 'ip-access-admin');
		Util::addScript('avuz_theme', 'ip-access-admin');
		return new TemplateResponse('avuz_theme', 'admin-ip-access', [], '');
	}

	public function getSection(): string {
		return 'security';
	}

	public function getPriority(): int {
		return 1;
	}
}
