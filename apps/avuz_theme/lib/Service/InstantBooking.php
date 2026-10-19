<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\Service;

use OCA\AvuzTheme\AppInfo\Application;
use OCP\IAppConfig;
use OCP\IRequest;

/**
 * Decides whether a booking made from the embedded demo page skips Calendar's
 * e-mail confirmation. Needs the embed header, an instance with embedding on and
 * a booking page listed in AVUZ_INSTANT_BOOKING_TOKENS (synced to app config at
 * boot, docker/lib-apps.sh). Empty = off. Those pages also send their appointment
 * e-mails from AVUZ_BOOKING_MAIL_FROM through their own SMTP login (BookingMailer)
 * when both are set (bookingMailFrom()).
 */
class InstantBooking {
	public const HEADER = 'X-Avuz-Embed-Booking';
	public const HEADER_VALUE = '1';
	public const CONFIG_KEY = 'instant_booking_tokens';
	public const MAIL_FROM_CONFIG_KEY = 'booking_mail_from';

	private const TOKEN_SEPARATOR = ',';
	private const TOKEN_PATTERN = '/^[A-Za-z0-9]+$/';

	public function __construct(
		private IAppConfig $appConfig,
	) {
	}

	public function isAllowed(IRequest $request, string $configToken): bool {
		if ($request->getHeader(self::HEADER) !== self::HEADER_VALUE) {
			return false;
		}
		// Not AppointmentEmbed::allowedOrigins(): that one is empty off the booking page route.
		$embeddingOn = AppointmentEmbed::parseOrigins(
			$this->appConfig->getValueString(Application::APP_ID, AppointmentEmbed::CONFIG_KEY),
		) !== [];
		if (!$embeddingOn) {
			return false;
		}
		return in_array(
			$configToken,
			self::parseTokens($this->appConfig->getValueString(Application::APP_ID, self::CONFIG_KEY)),
			true,
		);
	}

	/**
	 * Sender of the appointment e-mails for a listed booking page, null = keep
	 * Calendar's default sender. Server-side e-mails, so no embed header check.
	 * Needs the booking SMTP login: the main SMTP rejects this sender's domain.
	 */
	public function bookingMailFrom(string $configToken): ?string {
		$listed = in_array(
			$configToken,
			self::parseTokens($this->appConfig->getValueString(Application::APP_ID, self::CONFIG_KEY)),
			true,
		);
		if (!$listed || !$this->hasBookingSmtpLogin()) {
			return null;
		}
		$address = trim($this->appConfig->getValueString(Application::APP_ID, self::MAIL_FROM_CONFIG_KEY));
		return filter_var($address, FILTER_VALIDATE_EMAIL) === false ? null : $address;
	}

	private function hasBookingSmtpLogin(): bool {
		return $this->appConfig->getValueString(Application::APP_ID, BookingMailer::USER_CONFIG_KEY) !== ''
			&& $this->appConfig->getValueString(Application::APP_ID, BookingMailer::PASSWORD_CONFIG_KEY) !== '';
	}

	/**
	 * Comma-separated list -> unique, trimmed, alphanumeric tokens in order.
	 *
	 * @return list<string>
	 */
	public static function parseTokens(string $commaSeparatedTokens): array {
		$tokens = [];
		foreach (explode(self::TOKEN_SEPARATOR, $commaSeparatedTokens) as $entry) {
			$token = trim($entry);
			if (preg_match(self::TOKEN_PATTERN, $token) === 1) {
				$tokens[$token] = true;
			}
		}
		return array_map('strval', array_keys($tokens));
	}
}
