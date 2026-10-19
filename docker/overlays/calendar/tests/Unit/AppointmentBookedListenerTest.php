<?php

declare(strict_types=1);

namespace OCA\Calendar\Tests\Unit;

use OCA\Calendar\Db\AppointmentConfig;
use OCA\Calendar\Db\Booking;
use OCA\Calendar\Events\BeforeAppointmentBookedEvent;
use OCA\Calendar\Listener\AppointmentBookedListener;
use OCP\IL10N;
use OCP\IUser;
use OCP\IUserManager;
use OCP\Talk\IBroker;
use OCP\Talk\IConversation;
use OCP\Talk\IConversationOptions;
use PHPUnit\Framework\MockObject\MockObject;
use PHPUnit\Framework\MockObject\Stub;
use PHPUnit\Framework\TestCase;
use Psr\Log\LoggerInterface;

class AppointmentBookedListenerTest extends TestCase {
	private IBroker&Stub $broker;
	private IUserManager&Stub $userManager;
	private LoggerInterface&MockObject $logger;
	private AppointmentBookedListener $listener;
	private Booking $booking;
	private BeforeAppointmentBookedEvent $event;

	protected function setUp(): void {
		$this->broker = $this->createStub(IBroker::class);
		$this->userManager = $this->createStub(IUserManager::class);
		$this->logger = $this->createMock(LoggerInterface::class);
		$l10n = $this->createStub(IL10N::class);
		$l10n->method('t')->willReturnCallback(
			static fn (string $text, array $parameters): string => vsprintf($text, $parameters),
		);
		$this->listener = new AppointmentBookedListener(
			$this->broker,
			$this->userManager,
			$l10n,
			$this->logger,
		);

		$config = new AppointmentConfig();
		$config->setId(7);
		$config->setUserId('organizer');
		$config->setName('Demo');
		$config->setCreateTalkRoom(true);
		$this->booking = new Booking();
		$this->booking->setDisplayName('Visitor');
		$this->event = new BeforeAppointmentBookedEvent($this->booking, $config);

		$this->broker->method('hasBackend')->willReturn(true);
		$this->broker->method('newConversationOptions')
			->willReturn($this->createStub(IConversationOptions::class));
		$this->userManager->method('get')->willReturn($this->createStub(IUser::class));
	}

	public function testSetsTheTalkLinkWhenTheRoomIsCreated(): void {
		$conversation = $this->createStub(IConversation::class);
		$conversation->method('getAbsoluteUrl')->willReturn('https://talk.example/call/abc');
		$this->broker->method('createConversation')->willReturn($conversation);
		$this->logger->expects($this->never())->method('warning');

		$this->listener->handle($this->event);

		$this->assertSame('https://talk.example/call/abc', $this->booking->getTalkUrl());
	}

	public function testBooksWithoutALinkWhenTalkFailsToCreateTheRoom(): void {
		$this->broker->method('createConversation')->willThrowException(new \RuntimeException('talk is down'));
		$this->logger->expects($this->once())->method('warning');

		$this->listener->handle($this->event);

		$this->assertNull($this->booking->getTalkUrl());
	}

	public function testBooksWithoutALinkWhenTalkFailsToResolveTheRoomUrl(): void {
		$conversation = $this->createStub(IConversation::class);
		$conversation->method('getAbsoluteUrl')->willThrowException(new \RuntimeException('no url'));
		$this->broker->method('createConversation')->willReturn($conversation);
		$this->logger->expects($this->once())->method('warning');

		$this->listener->handle($this->event);

		$this->assertNull($this->booking->getTalkUrl());
	}
}
