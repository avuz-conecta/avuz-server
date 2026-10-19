<?php

declare(strict_types=1);

namespace OCA\Calendar\Tests\Unit;

use OCA\Calendar\Db\AppointmentConfig;
use OCA\Calendar\Db\Booking;
use OCA\Calendar\Db\BookingMapper;
use OCA\Calendar\Exception\NoSlotFoundException;
use OCA\Calendar\Service\Appointments\AvailabilityGenerator;
use OCA\Calendar\Service\Appointments\BookingCalendarWriter;
use OCA\Calendar\Service\Appointments\BookingService;
use OCA\Calendar\Service\Appointments\DailyLimitFilter;
use OCA\Calendar\Service\Appointments\EventConflictFilter;
use OCA\Calendar\Service\Appointments\Interval;
use OCA\Calendar\Service\Appointments\MailService;
use OCA\Calendar\Service\Appointments\SlotExtrapolator;
use OCP\DB\Exception as DbException;
use OCP\EventDispatcher\IEventDispatcher;
use OCP\Security\ISecureRandom;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\MockObject\Stub;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

class BookingServiceInstantTest extends TestCase {
	private const SLOT_START = 1_800_000_000;
	private const SLOT_END = 1_800_001_800;
	private const TIME_ZONE = 'America/Sao_Paulo';
	private const BOOKING_ID = 42;
	private const CALENDAR_URI = 'personal';

	private EventConflictFilter&Stub $eventConflictFilter;
	private BookingMapper&MockObject $bookingMapper;
	private BookingCalendarWriter&MockObject $calendarWriter;
	private MailService&MockObject $mailService;
	private LoggerInterface&MockObject $logger;
	private BookingService $service;
	private AppointmentConfig $config;

	protected function setUp(): void {
		$slot = new Interval(self::SLOT_START, self::SLOT_END);
		$availabilityGenerator = $this->createStub(AvailabilityGenerator::class);
		$availabilityGenerator->method('generate')->willReturn([$slot]);
		$extrapolator = $this->createStub(SlotExtrapolator::class);
		$extrapolator->method('extrapolate')->willReturn([$slot]);
		$dailyLimitFilter = $this->createStub(DailyLimitFilter::class);
		$dailyLimitFilter->method('filter')->willReturn([$slot]);
		$this->eventConflictFilter = $this->createStub(EventConflictFilter::class);
		$random = $this->createStub(ISecureRandom::class);
		$random->method('generate')->willReturn('bookingtoken');

		$this->bookingMapper = $this->createMock(BookingMapper::class);
		$this->bookingMapper->method('insert')->willReturnCallback(
			static function (Booking $booking): Booking {
				$booking->setId(self::BOOKING_ID);
				return $booking;
			},
		);
		$this->calendarWriter = $this->createMock(BookingCalendarWriter::class);
		$this->mailService = $this->createMock(MailService::class);
		$this->logger = $this->createMock(LoggerInterface::class);

		$this->service = new BookingService(
			$availabilityGenerator,
			$extrapolator,
			$dailyLimitFilter,
			$this->eventConflictFilter,
			$this->bookingMapper,
			$this->calendarWriter,
			$random,
			$this->mailService,
			$this->createStub(IEventDispatcher::class),
			$this->logger,
		);

		$this->config = new AppointmentConfig();
		$this->config->setId(7);
		$this->config->setToken('MxXcZpTEzNcH');
	}

	private function slotStaysFree(): void {
		$this->eventConflictFilter->method('filter')->willReturn([new Interval(self::SLOT_START, self::SLOT_END)]);
	}

	private function bookInstantly(): Booking {
		return $this->service->bookInstantly(
			$this->config,
			self::SLOT_START,
			self::SLOT_END,
			self::TIME_ZONE,
			'Visitor',
			'visitor@example.com',
			'Demo please',
		);
	}

	public function testBookInstantlyConfirmsWithoutTheConfirmationEmail(): void {
		$this->slotStaysFree();
		$this->calendarWriter->expects($this->once())->method('write')->willReturn(self::CALENDAR_URI);
		$this->mailService->expects($this->once())->method('sendBookingInformationEmail');
		$this->mailService->expects($this->once())->method('sendOrganizerBookingInformationEmail');
		$this->mailService->expects($this->never())->method('sendConfirmationEmail');
		$this->bookingMapper->expects($this->once())->method('update');
		$this->bookingMapper->expects($this->never())->method('delete');
		$this->logger->expects($this->never())->method('error');

		$booking = $this->bookInstantly();

		$this->assertTrue($booking->isConfirmed());
	}

	public function testBookInstantlyReturnsNotFoundAndDeletesTheRowWhenTheSlotIsGone(): void {
		$slot = new Interval(self::SLOT_START, self::SLOT_END);
		$this->eventConflictFilter->method('filter')->willReturnOnConsecutiveCalls([$slot], []);
		$this->calendarWriter->expects($this->never())->method('write');
		$this->bookingMapper->expects($this->once())->method('delete');
		$this->mailService->expects($this->never())->method('sendConfirmationEmail');
		$this->mailService->expects($this->never())->method('sendBookingInformationEmail');
		$this->mailService->expects($this->never())->method('sendOrganizerBookingInformationEmail');
		$this->logger->expects($this->never())->method('error');

		$this->expectException(NoSlotFoundException::class);

		$this->bookInstantly();
	}

	public function testBookInstantlyFallsBackToTheConfirmationEmailWhenTheCalendarWriteFails(): void {
		$this->slotStaysFree();
		$this->calendarWriter->expects($this->once())->method('write')->willThrowException(new \RuntimeException('no writable calendar'));
		$this->mailService->expects($this->once())->method('sendConfirmationEmail');
		$this->bookingMapper->expects($this->never())->method('delete');
		$this->logger->expects($this->once())->method('error');

		$booking = $this->bookInstantly();

		$this->assertNotTrue($booking->isConfirmed());
		$this->assertSame(self::BOOKING_ID, $booking->getId());
	}

	public function testBookInstantlySendsTheBookingEmailsWhenOnlyTheDatabaseUpdateFails(): void {
		$this->slotStaysFree();
		$this->calendarWriter->expects($this->once())->method('write')->willReturn(self::CALENDAR_URI);
		$this->bookingMapper->method('update')->willThrowException(new DbException('connection lost'));
		$this->bookingMapper->expects($this->never())->method('delete');
		$this->mailService->expects($this->never())->method('sendConfirmationEmail');
		$this->mailService->expects($this->once())->method('sendBookingInformationEmail');
		$this->mailService->expects($this->once())->method('sendOrganizerBookingInformationEmail');
		$this->logger->expects($this->once())->method('error');

		$booking = $this->bookInstantly();

		$this->assertTrue($booking->isConfirmed());
	}

	public function testBookStillSendsTheConfirmationEmail(): void {
		$this->slotStaysFree();
		$this->calendarWriter->expects($this->never())->method('write');
		$this->mailService->expects($this->once())->method('sendConfirmationEmail');
		$this->mailService->expects($this->never())->method('sendBookingInformationEmail');
		$this->bookingMapper->expects($this->never())->method('delete');
		$this->logger->expects($this->never())->method('error');

		$booking = $this->service->book(
			$this->config,
			self::SLOT_START,
			self::SLOT_END,
			self::TIME_ZONE,
			'Visitor',
			'visitor@example.com',
			'Demo please',
		);

		$this->assertNotTrue($booking->isConfirmed());
		$this->assertSame(self::BOOKING_ID, $booking->getId());
	}
}
