<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\Service;

use OC\Mail\Message;
use OCA\AvuzTheme\AppInfo\Application;
use OCP\EventDispatcher\IEventDispatcher;
use OCP\IAppConfig;
use OCP\Mail\Events\BeforeMessageSent;
use OCP\Mail\IMessage;
use Psr\Log\LoggerInterface;
use Symfony\Component\Mailer\Mailer;
use Symfony\Component\Mailer\Transport\Smtp\EsmtpTransport;
use Symfony\Component\Mailer\Transport\Smtp\Stream\SocketStream;
use Symfony\Component\Mailer\Transport\TransportInterface;
use Symfony\Component\Mime\Exception\InvalidArgumentException;
use Symfony\Component\Mime\Exception\RfcComplianceException;

/**
 * Second SMTP connection for the appointment e-mails of the instant-booking
 * pages: their sender (AVUZ_BOOKING_MAIL_FROM) belongs to a ZeptoMail agent with
 * its own login (AVUZ_BOOKING_SMTP_USER / AVUZ_BOOKING_SMTP_PASSWORD, synced at
 * boot, docker/lib-apps.sh). Everything else keeps core's mailer. Mirrors
 * OC\Mail\Mailer::send(); empty user or password = off.
 */
class BookingMailer {
	public const HOST = 'smtp.zeptomail.com';
	public const PORT = 587;
	public const USER_CONFIG_KEY = 'booking_smtp_user';
	public const PASSWORD_CONFIG_KEY = 'booking_smtp_password';

	private const TIMEOUT_SECONDS = 10;
	private const REDACTED = '***';

	public function __construct(
		private IAppConfig $appConfig,
		private IEventDispatcher $dispatcher,
		private LoggerInterface $logger,
	) {
	}

	public function isConfigured(): bool {
		return $this->user() !== '' && $this->password() !== '';
	}

	/**
	 * True when the booking connection sent the message; false = not sent,
	 * the caller falls back to core's mailer.
	 */
	public function send(IMessage $message): bool {
		if (!$message instanceof Message || !$this->isConfigured()) {
			return false;
		}
		$this->dispatcher->dispatchTyped(new BeforeMessageSent($message));
		try {
			$message->setRecipients();
		} catch (InvalidArgumentException|RfcComplianceException) {
			return false;
		}
		try {
			(new Mailer($this->createTransport()))->send($message->getSymfonyEmail());
		} catch (\Throwable $e) {
			$this->logFailure($e);
			return false;
		}
		return true;
	}

	protected function createTransport(): TransportInterface {
		$transport = new EsmtpTransport(self::HOST, self::PORT, null, null, $this->logger);
		$transport->setUsername($this->user());
		$transport->setPassword($this->password());
		$stream = $transport->getStream();
		if ($stream instanceof SocketStream) {
			$stream->setTimeout(self::TIMEOUT_SECONDS);
		}
		return $transport;
	}

	// Symfony puts the SMTP username in its auth errors and the base64 login in
	// its traces, so the exception itself never reaches the log.
	private function logFailure(\Throwable $failure): void {
		$this->logger->error('Could not send the e-mail through the booking SMTP (' . self::HOST . ')', [
			'app' => Application::APP_ID,
			'exceptionClass' => $failure::class,
			'exceptionCode' => $failure->getCode(),
			'reason' => $this->withoutLogin($failure->getMessage()),
		]);
	}

	private function withoutLogin(string $text): string {
		$secrets = array_filter([
			$this->user(),
			$this->password(),
			base64_encode($this->user()),
			base64_encode($this->password()),
		], static fn (string $secret): bool => $secret !== '');
		return str_replace($secrets, self::REDACTED, $text);
	}

	private function user(): string {
		return $this->appConfig->getValueString(Application::APP_ID, self::USER_CONFIG_KEY);
	}

	private function password(): string {
		return $this->appConfig->getValueString(Application::APP_ID, self::PASSWORD_CONFIG_KEY);
	}
}
