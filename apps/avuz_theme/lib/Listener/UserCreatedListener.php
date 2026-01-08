<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\Listener;

use OCA\AvuzTheme\Service\CustomBoardService;
use OCP\App\IAppManager;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\User\Events\UserCreatedEvent;
use Psr\Log\LoggerInterface;

/**
 * Listens for user creation events and creates a custom Avuz Conecta
 * welcome board in Deck, preventing the default Nextcloud-branded board.
 *
 * @template-implements IEventListener<UserCreatedEvent>
 */
class UserCreatedListener implements IEventListener {

	public function __construct(
		private LoggerInterface $logger,
		private IAppManager $appManager,
		private CustomBoardService $customBoardService,
	) {
	}

	public function handle(Event $event): void {
		if (!($event instanceof UserCreatedEvent)) {
			return;
		}

		$userId = $event->getUid();

		// Check if Deck app is enabled
		if (!$this->appManager->isEnabledForUser('deck', $event->getUser())) {
			$this->logger->debug('Deck not enabled, skipping welcome board creation', [
				'userId' => $userId,
			]);
			return;
		}

		$this->logger->debug('Creating Avuz welcome board for new user', ['userId' => $userId]);
		$this->customBoardService->createWelcomeBoard($userId);
	}
}
