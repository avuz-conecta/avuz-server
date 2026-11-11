<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\Middleware;

class IpAccessDeniedException extends \Exception {
	public function __construct(string $message, public readonly string $ip, public readonly bool $isOcs) {
		parent::__construct($message);
	}
}
