<?php

declare(strict_types=1);

namespace OCA\Calendar\Tests\Unit;

use Closure;
use OC\Mail\Message;
use OCA\AvuzTheme\Service\BookingMailer;
use OCA\AvuzTheme\Service\InstantBooking;
use OCA\Calendar\Db\AppointmentConfig;
use OCA\Calendar\Db\Booking;
use OCA\Calendar\Service\Appointments\MailService;
use OCP\Defaults;
use OCP\IConfig;
use OCP\IDateTimeFormatter;
use OCP\IL10N;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\IUser;
use OCP\IUserManager;
use OCP\L10N\IFactory;
use OCP\Mail\IAttachment;
use OCP\Mail\IEMailTemplate;
use OCP\Mail\IEmailValidator;
use OCP\Mail\IMailer;
use OCP\Mail\IMessage;
use OCP\Notification\IManager;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Psr\Container\ContainerInterface;
use Psr\Log\LoggerInterface;

class MailServiceSenderTest extends TestCase {
	private const CONFIG_TOKEN = 'MxXcZpTEzNcH';
	private const BOOKING_SENDER = 'contato@avuzconecta.com.br';
	private const DEFAULT_SENDER = 'naoresponder@avuz.app';
	private const ORGANIZER_NAME = 'Organizer Name';
	private const VISITOR_NAME = 'Visitor Name';
	private const CALENDAR_ICS = 'BEGIN:VCALENDAR';

	/** @var array<string, string>|null */
	private ?array $sentFrom = null;
	/** @var array<string, string>|null From at the moment core's mailer sent, null = not called */
	private ?array $coreMailerSentFrom = null;
	/** @var list<IMessage> */
	private array $bookingMailerMessages = [];

	protected function setUp(): void {
		$this->sentFrom = null;
		$this->coreMailerSentFrom = null;
		$this->bookingMailerMessages = [];
	}

	protected function tearDown(): void {
		\OC::$server = null;
	}

	/**
	 * @return array<string, array{Closure(MailService, Booking, AppointmentConfig): void, string}>
	 */
	public static function emailsFromTheSystemSender(): array {
		return [
			'confirmation' => [
				static fn (MailService $mailService, Booking $booking, AppointmentConfig $config) => $mailService->sendConfirmationEmail($booking, $config),
				self::ORGANIZER_NAME,
			],
			'booking information' => [
				static fn (MailService $mailService, Booking $booking, AppointmentConfig $config) => $mailService->sendBookingInformationEmail($booking, $config, self::CALENDAR_ICS),
				self::ORGANIZER_NAME,
			],
			'organizer booking information' => [
				static fn (MailService $mailService, Booking $booking, AppointmentConfig $config) => $mailService->sendOrganizerBookingInformationEmail($booking, $config, self::CALENDAR_ICS),
				self::VISITOR_NAME,
			],
		];
	}

	#[DataProvider('emailsFromTheSystemSender')]
	public function testSendsFromTheBookingSenderThroughTheBookingSmtpForAListedPage(Closure $sendEmail, string $displayName): void {
		$this->serverResolves($this->gateAnswering(self::BOOKING_SENDER), $this->bookingMailerSending(true));

		$sendEmail($this->mailService($this->createStub(LoggerInterface::class)), $this->booking(), $this->config());

		$this->assertSame([self::BOOKING_SENDER => $displayName], $this->sentFrom);
		$this->assertCount(1, $this->bookingMailerMessages);
		$this->assertNull($this->coreMailerSentFrom, 'core mailer is not called');
	}

	#[DataProvider('emailsFromTheSystemSender')]
	public function testFallsBackToTheDefaultSenderAndSmtpWhenTheBookingSmtpFails(Closure $sendEmail, string $displayName): void {
		$this->serverResolves($this->gateAnswering(self::BOOKING_SENDER), $this->bookingMailerSending(false));
		$logger = $this->createMock(LoggerInterface::class);
		$logger->expects($this->once())
			->method('warning')
			->with($this->stringContains('booking SMTP failed, sending with the default sender'));

		$sendEmail($this->mailService($logger), $this->booking(), $this->config());

		$this->assertCount(1, $this->bookingMailerMessages);
		$this->assertSame([self::DEFAULT_SENDER => $displayName], $this->coreMailerSentFrom);
	}

	#[DataProvider('emailsFromTheSystemSender')]
	public function testFallsBackToTheDefaultSenderAndSmtpWhenTheBookingMailerCannotBeResolved(Closure $sendEmail, string $displayName): void {
		$this->serverResolves($this->gateAnswering(self::BOOKING_SENDER), new \RuntimeException('container unavailable'));
		$logger = $this->createMock(LoggerInterface::class);
		$logger->expects($this->once())
			->method('warning')
			->with($this->stringContains('booking SMTP failed, sending with the default sender'), $this->callback(
				static fn (array $context): bool => $context['exception'] instanceof \RuntimeException,
			));

		$sendEmail($this->mailService($logger), $this->booking(), $this->config());

		$this->assertSame([self::DEFAULT_SENDER => $displayName], $this->coreMailerSentFrom);
	}

	#[DataProvider('emailsFromTheSystemSender')]
	public function testNeverConsultsTheBookingSmtpForThePagesOnTheDefaultSender(Closure $sendEmail, string $displayName): void {
		$this->serverResolves($this->gateAnswering(null), $this->bookingMailerSending(true));

		$sendEmail($this->mailService($this->createStub(LoggerInterface::class)), $this->booking(), $this->config());

		$this->assertSame([], $this->bookingMailerMessages);
		$this->assertSame([self::DEFAULT_SENDER => $displayName], $this->coreMailerSentFrom);
	}

	#[DataProvider('emailsFromTheSystemSender')]
	public function testSendsFromTheDefaultSenderWhenThePageKeepsIt(Closure $sendEmail, string $displayName): void {
		$this->serverResolves($this->gateAnswering(null));

		$sendEmail($this->mailService($this->createStub(LoggerInterface::class)), $this->booking(), $this->config());

		$this->assertSame([self::DEFAULT_SENDER => $displayName], $this->sentFrom);
	}

	#[DataProvider('emailsFromTheSystemSender')]
	public function testSendsFromTheDefaultSenderAndWarnsWhenTheLookupThrows(Closure $sendEmail, string $displayName): void {
		$gate = $this->createStub(InstantBooking::class);
		$gate->method('bookingMailFrom')->willThrowException(new \RuntimeException('app config unavailable'));
		$this->serverResolves($gate);
		$logger = $this->createMock(LoggerInterface::class);
		$logger->expects($this->once())
			->method('warning')
			->with($this->stringContains('booking sender'), $this->callback(
				static fn (array $context): bool => $context['exception'] instanceof \RuntimeException
					&& $context['config'] === 42,
			));

		$sendEmail($this->mailService($logger), $this->booking(), $this->config());

		$this->assertSame([self::DEFAULT_SENDER => $displayName], $this->sentFrom);
	}

	private function gateAnswering(?string $sender): InstantBooking {
		$gate = $this->createStub(InstantBooking::class);
		$gate->method('bookingMailFrom')->willReturnMap([[self::CONFIG_TOKEN, $sender]]);
		return $gate;
	}

	private function bookingMailerSending(bool $sent): BookingMailer {
		$bookingMailer = $this->createStub(BookingMailer::class);
		$bookingMailer->method('send')->willReturnCallback(function (IMessage $message) use ($sent): bool {
			$this->bookingMailerMessages[] = $message;
			return $sent;
		});
		return $bookingMailer;
	}

	private function serverResolves(InstantBooking $gate, BookingMailer|\Throwable|null $bookingMailer = null): void {
		$systemConfig = $this->createStub(IConfig::class);
		$systemConfig->method('getSystemValueString')->willReturnMap([
			['mail_from_address', 'appointments-noreply', 'naoresponder'],
			['mail_domain', 'localhost', 'avuz.app'],
		]);
		$request = $this->createStub(IRequest::class);
		$request->method('getServerHost')->willReturn('localhost');
		$emailValidator = $this->createStub(IEmailValidator::class);
		$emailValidator->method('isValid')->willReturn(true);

		$services = [
			InstantBooking::class => $gate,
			BookingMailer::class => $bookingMailer ?? $this->bookingMailerSending(true),
			IConfig::class => $systemConfig,
			IRequest::class => $request,
			IEmailValidator::class => $emailValidator,
		];
		$container = $this->createStub(ContainerInterface::class);
		$container->method('get')->willReturnCallback(static function (string $id) use ($services): object {
			if ($services[$id] instanceof \Throwable) {
				throw $services[$id];
			}
			return $services[$id];
		});
		\OC::$server = $container;
	}

	private function booking(): Booking {
		$booking = new Booking();
		$booking->setEmail('visitor@example.com');
		$booking->setDisplayName(self::VISITOR_NAME);
		$booking->setTimezone('America/Sao_Paulo');
		$booking->setStart(1_800_000_000);
		$booking->setToken('booking-token');
		return $booking;
	}

	private function config(): AppointmentConfig {
		$config = new AppointmentConfig();
		$config->setId(42);
		$config->setToken(self::CONFIG_TOKEN);
		$config->setUserId('organizer');
		$config->setName('Demo');
		$config->setAvailabilityAsArray(['timezoneId' => 'America/Sao_Paulo']);
		return $config;
	}

	private function mailService(LoggerInterface $logger): MailService {
		$organizer = $this->createStub(IUser::class);
		$organizer->method('getEMailAddress')->willReturn('organizer@example.com');
		$organizer->method('getDisplayName')->willReturn(self::ORGANIZER_NAME);
		$userManager = $this->createStub(IUserManager::class);
		$userManager->method('get')->willReturn($organizer);

		$message = $this->createStub(Message::class);
		$message->method('setFrom')->willReturnCallback(function (array $addresses) use ($message): IMessage {
			$this->sentFrom = $addresses;
			return $message;
		});
		$message->method('getFrom')->willReturnCallback(fn (): array => $this->sentFrom ?? []);
		foreach (['setTo', 'setReplyTo', 'attach', 'useTemplate'] as $chainedMethod) {
			$message->method($chainedMethod)->willReturnSelf();
		}
		$mailer = $this->createStub(IMailer::class);
		$mailer->method('createMessage')->willReturn($message);
		$mailer->method('createEMailTemplate')->willReturn($this->createStub(IEMailTemplate::class));
		$mailer->method('createAttachment')->willReturn($this->createStub(IAttachment::class));
		$mailer->method('send')->willReturnCallback(function (): array {
			$this->coreMailerSentFrom = $this->sentFrom;
			return [];
		});

		$languageFactory = $this->createStub(IFactory::class);
		$languageFactory->method('findGenericLanguage')->willReturn('en');
		$languageFactory->method('get')->willReturn($this->createStub(IL10N::class));

		return new MailService(
			$mailer,
			$userManager,
			$this->createStub(IL10N::class),
			$this->createStub(Defaults::class),
			$logger,
			$this->createStub(IURLGenerator::class),
			$this->createStub(IDateTimeFormatter::class),
			$languageFactory,
			$this->createStub(IManager::class),
			$this->createStub(IConfig::class),
		);
	}
}
