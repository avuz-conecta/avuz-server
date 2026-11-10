<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\Service;

use OCP\IAppConfig;
use OCP\IGroupManager;
use OCP\IRequest;
use OCP\IUser;
use OCP\Security\Ip\IFactory;
use Psr\Log\LoggerInterface;

/**
 * Access restriction by public IP ("Restrição de acesso por IP").
 *
 * When enabled, non-admin accounts may only use Avuz Conecta from an IP or
 * range on the allowlist; members of the admin group can sign in from
 * anywhere. Rules live in the app config (avuz_theme / ip_access_*) and are
 * edited in Administração › Segurança. The client IP is what Nextcloud sees
 * through IRequest::getRemoteAddress(), so behind a reverse proxy the proxy
 * must be listed in trusted_proxies for the real address to be used.
 */
class IpAccess {
	private const KEY_ENABLED = 'ip_access_enabled';
	private const KEY_RULES = 'ip_access_rules';

	public function __construct(
		private IAppConfig $appConfig,
		private IGroupManager $groupManager,
		private IRequest $request,
		private IFactory $ipFactory,
		private LoggerInterface $logger,
	) {
	}

	public function isEnabled(): bool {
		return $this->appConfig->getValueBool('avuz_theme', self::KEY_ENABLED, false);
	}

	/** @return list<array{range: string, description: string}> */
	public function getRules(): array {
		$rules = json_decode($this->appConfig->getValueString('avuz_theme', self::KEY_RULES, '[]'), true);
		return is_array($rules) ? array_values(array_filter($rules, fn ($r) => is_array($r) && isset($r['range']))) : [];
	}

	/**
	 * @param list<array{range?: mixed, description?: mixed}> $rules
	 * @throws \InvalidArgumentException on an invalid IP/range
	 */
	public function save(bool $enabled, array $rules): void {
		$clean = [];
		foreach ($rules as $rule) {
			$range = $this->normalize((string)($rule['range'] ?? ''));
			$clean[$range] = [
				'range' => $range,
				'description' => mb_substr(trim((string)($rule['description'] ?? '')), 0, 120),
			];
		}
		$this->appConfig->setValueString('avuz_theme', self::KEY_RULES, json_encode(array_values($clean)));
		$this->appConfig->setValueBool('avuz_theme', self::KEY_ENABLED, $enabled);
	}

	/** "200.150.30.42" or "200.150.30.0/24" (IPv4/IPv6), validated */
	public function normalize(string $value): string {
		$value = trim($value);
		if ($value === '') {
			throw new \InvalidArgumentException('Informe um IP ou faixa.');
		}
		try {
			if (str_contains($value, '/')) {
				return (string)$this->ipFactory->rangeFromString($value);
			}
			$this->ipFactory->addressFromString($value);
			return $value;
		} catch (\Throwable $e) {
			throw new \InvalidArgumentException("IP ou faixa inválido: $value");
		}
	}

	public function currentIp(): string {
		return $this->request->getRemoteAddress();
	}

	public function isExempt(IUser $user): bool {
		return $this->groupManager->isAdmin($user->getUID());
	}

	public function isIpAllowed(string $ip): bool {
		try {
			$address = $this->ipFactory->addressFromString($ip);
		} catch (\Throwable $e) {
			return false;
		}
		foreach ($this->getRules() as $rule) {
			try {
				$range = str_contains($rule['range'], '/')
					? $this->ipFactory->rangeFromString($rule['range'])
					: $this->ipFactory->rangeFromString($rule['range'] . (str_contains($rule['range'], ':') ? '/128' : '/32'));
				if ($range->contains($address)) {
					return true;
				}
			} catch (\Throwable $e) {
				$this->logger->warning('Invalid IP access rule ignored', ['rule' => $rule['range'], 'exception' => $e]);
			}
		}
		return false;
	}

	/** True when this user must be kept out from the current IP */
	public function isBlocked(IUser $user): bool {
		if (!$this->isEnabled() || $this->isExempt($user)) {
			return false;
		}
		return !$this->isIpAllowed($this->currentIp());
	}

	public function blockedMessage(): string {
		return 'Acesso não permitido a partir deste endereço IP (' . $this->currentIp() . '). Fale com o administrador.';
	}
}
