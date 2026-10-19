<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\Tests\Unit\Service;

use OC\Mail\Message;
use OCA\AvuzTheme\Service\BookingMailer;
use OCP\EventDispatcher\IEventDispatcher;
use OCP\IAppConfig;
use OCP\Mail\Events\BeforeMessageSent;
use OCP\Mail\IMessage;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;
use Symfony\Component\Mailer\Exception\TransportException;
use Symfony\Component\Mailer\SentMessage;
use Symfony\Component\Mailer\Transport\AbstractTransport;
use Symfony\Component\Mailer\Transport\Smtp\EsmtpTransport;
use Symfony\Component\Mailer\Transport\Smtp\Stream\SocketStream;
use Symfony\Component\Mailer\Transport\TransportInterface;
use Symfony\Component\Mime\Email;

class BookingMailerTest extends TestCase {
	private const SMTP_USER = 'booking-smtp-user';
	private const SMTP_PASSWORD = 'booking-smtp-password';
	private const SENDER = 'contato@avuzconecta.com.br';
	private const RECIPIENT = 'visitor@example.com';
	private const SUBJECT = 'Your appointment';

	private function appConfig(string $user = self::SMTP_USER, string $password = self::SMTP_PASSWORD): IAppConfig {
		$appConfig = $this->createStub(IAppConfig::class);
		$appConfig->method('getValueString')->willReturnCallback(
			static fn (string $app, string $key, string $default = ''): string => match (true) {
				$app === 'avuz_theme' && $key === 'booking_smtp_user' => $user,
				$app === 'avuz_theme' && $key === 'booking_smtp_password' => $password,
				default => $default,
			},
		);
		return $appConfig;
	}

	private function message(): Message {
		$message = new Message(new Email(), false);
		$message->setFrom([self::SENDER => 'Organizer Name'])
			->setTo([self::RECIPIENT => 'Visitor Name'])
			->setSubject(self::SUBJECT)
			->setPlainBody('See you soon.');
		return $message;
	}

	private function mailer(
		TransportInterface $transport,
		IAppConfig $appConfig,
		?IEventDispatcher $dispatcher = null,
		?LoggerInterface $logger = null,
	): BookingMailer {
		return new class($appConfig, $dispatcher ?? $this->createStub(IEventDispatcher::class), $logger ?? $this->createStub(LoggerInterface::class), $transport) extends BookingMailer {
			public function __construct(
				IAppConfig $appConfig,
				IEventDispatcher $dispatcher,
				LoggerInterface $logger,
				private TransportInterface $transport,
			) {
				parent::__construct($appConfig, $dispatcher, $logger);
			}

			protected function createTransport(): TransportInterface {
				return $this->transport;
			}
		};
	}

	public function testSendsThroughTheBookingConnectionWhenConfigured(): void {
		$transport = new RecordingTransport();

		$sent = $this->mailer($transport, $this->appConfig())->send($this->message());

		$this->assertTrue($sent);
		$this->assertCount(1, $transport->sentEmails);
		$this->assertSame(self::SENDER, $transport->sentEmails[0]->getFrom()[0]->getAddress());
		$this->assertSame(self::RECIPIENT, $transport->sentEmails[0]->getTo()[0]->getAddress());
		$this->assertSame(self::SUBJECT, $transport->sentEmails[0]->getSubject());
	}

	public function testConnectsToZeptoMailWithTheBookingLoginWithoutStartingTls(): void {
		$mailer = new class($this->appConfig(), $this->createStub(IEventDispatcher::class), $this->createStub(LoggerInterface::class)) extends BookingMailer {
			public function transport(): TransportInterface {
				return $this->createTransport();
			}
		};

		$transport = $mailer->transport();

		$this->assertInstanceOf(EsmtpTransport::class, $transport);
		$this->assertTrue($transport->getUsername() === self::SMTP_USER, 'uses the booking SMTP user');
		$this->assertTrue($transport->getPassword() === self::SMTP_PASSWORD, 'uses the booking SMTP password');
		$stream = $transport->getStream();
		$this->assertInstanceOf(SocketStream::class, $stream);
		$this->assertSame('smtp.zeptomail.com', $stream->getHost());
		$this->assertSame(587, $stream->getPort());
		$this->assertFalse($stream->isTLS());
		$this->assertSame(10.0, $stream->getTimeout());
	}

	public function testReportsItselfConfiguredWithUserAndPassword(): void {
		$this->assertTrue($this->mailer(new RecordingTransport(), $this->appConfig())->isConfigured());
	}

	public function testSendsNothingWhenTheUserIsEmpty(): void {
		$transport = new RecordingTransport();
		$mailer = $this->mailer($transport, $this->appConfig(user: ''));

		$this->assertFalse($mailer->isConfigured());
		$this->assertFalse($mailer->send($this->message()));
		$this->assertSame([], $transport->sentEmails);
	}

	public function testSendsNothingWhenThePasswordIsEmpty(): void {
		$transport = new RecordingTransport();
		$mailer = $this->mailer($transport, $this->appConfig(password: ''));

		$this->assertFalse($mailer->isConfigured());
		$this->assertFalse($mailer->send($this->message()));
		$this->assertSame([], $transport->sentEmails);
	}

	public function testRefusesAMessageThatIsNotACoreMessage(): void {
		$transport = new RecordingTransport();

		$sent = $this->mailer($transport, $this->appConfig())->send($this->createStub(IMessage::class));

		$this->assertFalse($sent);
		$this->assertSame([], $transport->sentEmails);
	}

	public function testRefusesAMessageWithAnInvalidRecipient(): void {
		$transport = new RecordingTransport();
		$message = $this->message()->setTo(['not an address' => 'Visitor Name']);

		$sent = $this->mailer($transport, $this->appConfig())->send($message);

		$this->assertFalse($sent);
		$this->assertSame([], $transport->sentEmails);
	}

	public function testDispatchesBeforeMessageSentWithTheMessage(): void {
		$message = $this->message();
		$dispatcher = $this->createMock(IEventDispatcher::class);
		$dispatcher->expects($this->once())
			->method('dispatchTyped')
			->with($this->callback(
				static fn (object $event): bool => $event instanceof BeforeMessageSent && $event->getMessage() === $message,
			));

		$this->mailer(new RecordingTransport(), $this->appConfig(), $dispatcher)->send($message);
	}

	public function testLogsAnErrorWithoutTheLoginWhenTheTransportFails(): void {
		$loggedErrors = [];
		$logger = $this->createStub(LoggerInterface::class);
		$logger->method('error')->willReturnCallback(
			static function (string|\Stringable $message, array $context = []) use (&$loggedErrors): void {
				$loggedErrors[] = [(string)$message, $context];
			},
		);
		$failure = new TransportException(sprintf(
			'Failed to authenticate on SMTP server with username "%s" using password "%s" (%s).',
			self::SMTP_USER,
			self::SMTP_PASSWORD,
			base64_encode(self::SMTP_PASSWORD),
		), 535);

		$sent = $this->mailer(new FailingTransport($failure), $this->appConfig(), logger: $logger)->send($this->message());

		$this->assertFalse($sent);
		$this->assertCount(1, $loggedErrors);
		[$loggedMessage, $loggedContext] = $loggedErrors[0];
		$this->assertStringContainsString('booking SMTP', $loggedMessage);
		$this->assertStringContainsString('535', var_export($loggedContext, true));
		$logged = $loggedMessage . var_export($loggedContext, true);
		foreach ([self::SMTP_USER, self::SMTP_PASSWORD, base64_encode(self::SMTP_PASSWORD), self::RECIPIENT] as $secret) {
			$this->assertStringNotContainsString($secret, $logged);
		}
	}
}

class RecordingTransport extends AbstractTransport {
	/** @var list<Email> */
	public array $sentEmails = [];

	protected function doSend(SentMessage $message): void {
		$original = $message->getOriginalMessage();
		if ($original instanceof Email) {
			$this->sentEmails[] = $original;
		}
	}

	public function __toString(): string {
		return 'recording://';
	}
}

class FailingTransport extends AbstractTransport {
	public function __construct(
		private TransportException $failure,
	) {
		parent::__construct();
	}

	protected function doSend(SentMessage $message): void {
		throw $this->failure;
	}

	public function __toString(): string {
		return 'failing://';
	}
}
