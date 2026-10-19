<?php

declare(strict_types=1);

namespace OCA\Calendar\Tests\Unit;

use OCA\AvuzTheme\Service\InstantBooking;
use OCA\Calendar\Controller\BookingController;
use OCA\Calendar\Db\AppointmentConfig;
use OCA\Calendar\Db\Booking;
use OCA\Calendar\Exception\NoSlotFoundException;
use OCA\Calendar\Service\Appointments\AppointmentConfigService;
use OCA\Calendar\Service\Appointments\BookingService;
use OCP\AppFramework\Http;
use OCP\AppFramework\Services\IInitialState;
use OCP\AppFramework\Utility\ITimeFactory;
use OCP\IConfig;
use OCP\IRequest;
use OCP\IURLGenerator;
use OCP\Mail\IMailer;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\TestCase;
use Psr\Container\ContainerInterface;
use Psr\Log\LoggerInterface;

class BookingControllerInstantTest extends TestCase {
	private const CONFIG_TOKEN = 'MxXcZpTEzNcH';
	private const SLOT_START = 1_800_000_000;
	private const SLOT_END = 1_800_001_800;

	private IRequest $request;
	private BookingService&MockObject $bookingService;
	private InstantBooking&MockObject $instantBooking;
	private BookingController $controller;

	protected function setUp(): void {
		$this->request = $this->createStub(IRequest::class);
		$this->bookingService = $this->createMock(BookingService::class);
		$this->instantBooking = $this->createMock(InstantBooking::class);

		$container = $this->createStub(ContainerInterface::class);
		$container->method('get')->willReturnMap([[InstantBooking::class, $this->instantBooking]]);
		\OC::$server = $container;

		$appointmentConfigService = $this->createStub(AppointmentConfigService::class);
		$appointmentConfigService->method('findByToken')->willReturn(new AppointmentConfig());
		$mailer = $this->createStub(IMailer::class);
		$mailer->method('validateMailAddress')->willReturn(true);

		$this->controller = new BookingController(
			'calendar',
			$this->request,
			$this->createStub(ITimeFactory::class),
			$this->createStub(IInitialState::class),
			$this->bookingService,
			$appointmentConfigService,
			$this->createStub(IURLGenerator::class),
			$this->createStub(LoggerInterface::class),
			$mailer,
			$this->createStub(IConfig::class),
		);
	}

	protected function tearDown(): void {
		\OC::$server = null;
	}

	private function gateAnswers(bool $allowed): void {
		$this->instantBooking->expects($this->once())
			->method('isAllowed')
			->with($this->request, self::CONFIG_TOKEN)
			->willReturn($allowed);
	}

	private function bookSlot(): int {
		return $this->controller->bookSlot(
			self::CONFIG_TOKEN,
			self::SLOT_START,
			self::SLOT_END,
			'Visitor',
			'visitor@example.com',
			'Demo please',
			'America/Sao_Paulo',
		)->getStatus();
	}

	public function testBooksInstantlyWhenTheGateAllows(): void {
		$this->gateAnswers(true);
		$this->bookingService->expects($this->once())->method('bookInstantly')->willReturn(new Booking());
		$this->bookingService->expects($this->never())->method('book');

		$this->assertSame(Http::STATUS_OK, $this->bookSlot());
	}

	public function testBooksTheClassicWayWhenTheGateRefuses(): void {
		$this->gateAnswers(false);
		$this->bookingService->expects($this->once())->method('book')->willReturn(new Booking());
		$this->bookingService->expects($this->never())->method('bookInstantly');

		$this->assertSame(Http::STATUS_OK, $this->bookSlot());
	}

	public function testAnswersNotFoundWhenTheInstantSlotIsGone(): void {
		$this->gateAnswers(true);
		$this->bookingService->expects($this->once())->method('bookInstantly')
			->willThrowException(new NoSlotFoundException('Slot for booking is not available any more'));

		$this->assertSame(Http::STATUS_NOT_FOUND, $this->bookSlot());
	}
}
