<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\Service;

use OCA\AvuzTheme\AppInfo\Application;
use OCP\IAppConfig;
use OCP\IRequest;

/**
 * Lets allowlisted sites (e.g. the Avuz Conecta marketing site) embed the public
 * appointment booking page in an iframe. The allowlist is the
 * AVUZ_EMBED_ALLOWED_ORIGINS stack env, synced to app config at boot
 * (docker/lib-apps.sh). Empty = embedding off.
 */
class AppointmentEmbed {
	public const ROUTE = 'calendar.appointment.show';
	public const CONFIG_KEY = 'embed_allowed_origins';

	private const ORIGIN_SEPARATOR = ',';
	private const DEFAULT_HTTPS_PORT_SUFFIX = ':443';
	private const HTTPS_ORIGIN_PATTERN = '/^https:\/\/[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(?::(?<port>[0-9]{1,5}))?$/';
	private const MAX_PORT = 65535;

	public function __construct(
		private IRequest $request,
		private IAppConfig $appConfig,
	) {
	}

	/**
	 * Origins allowed to frame the current page: empty on every page but the
	 * public appointment booking page, and when no valid origin is configured.
	 *
	 * @return list<string>
	 */
	public function allowedOrigins(): array {
		if ($this->request->getParam('_route') !== self::ROUTE) {
			return [];
		}
		return self::parseOrigins($this->appConfig->getValueString(Application::APP_ID, self::CONFIG_KEY));
	}

	/**
	 * Comma-separated list -> unique, lowercased https origins (scheme + host
	 * + optional port, no path). Invalid entries are dropped.
	 *
	 * @return list<string>
	 */
	public static function parseOrigins(string $commaSeparatedOrigins): array {
		$origins = [];
		foreach (explode(self::ORIGIN_SEPARATOR, $commaSeparatedOrigins) as $entry) {
			$origin = self::normalizeOrigin($entry);
			if ($origin !== null) {
				$origins[$origin] = true;
			}
		}
		return array_keys($origins);
	}

	private static function normalizeOrigin(string $entry): ?string {
		$origin = strtolower(trim($entry));
		if (preg_match(self::HTTPS_ORIGIN_PATTERN, $origin, $matches) !== 1) {
			return null;
		}
		$port = $matches['port'] ?? '';
		if ($port !== '' && ((int)$port < 1 || (int)$port > self::MAX_PORT)) {
			return null;
		}
		// Browsers serialize the default port away; keep it out so exact matches work.
		if (str_ends_with($origin, self::DEFAULT_HTTPS_PORT_SUFFIX)) {
			return substr($origin, 0, -strlen(self::DEFAULT_HTTPS_PORT_SUFFIX));
		}
		return $origin;
	}
}
