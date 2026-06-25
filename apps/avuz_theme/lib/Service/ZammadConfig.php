<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\Service;

use OCP\IAppConfig;

class ZammadConfig {
	private const APP_ID = 'avuz_theme';

	public function __construct(
		private IAppConfig $appConfig,
	) {
	}

	public function isChatEnabled(): bool {
		if ($this->get('zammad_chat_enabled') !== '1') {
			return false;
		}
		return $this->get('zammad_url') !== '' && $this->get('zammad_chat_id') !== '';
	}

	public function portalUrl(): string {
		return $this->get('zammad_portal_url');
	}

	public function host(): string {
		return rtrim($this->get('zammad_url'), '/');
	}

	/**
	 * @return array{url: string, chatId: int}
	 */
	public function initialState(): array {
		return [
			'url' => $this->host(),
			'chatId' => (int)$this->get('zammad_chat_id'),
		];
	}

	private function get(string $key): string {
		return $this->appConfig->getValueString(self::APP_ID, $key, '');
	}
}
