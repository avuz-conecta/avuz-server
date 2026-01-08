<?php

declare(strict_types=1);

namespace OCA\AvuzTheme\Service;

use OCA\Deck\Db\Board;
use OCP\IConfig;
use OCP\IServerContainer;
use Psr\Log\LoggerInterface;

/**
 * Creates a custom Avuz Conecta welcome board for new users.
 * Uses lazy loading to avoid DI failures when Deck app is not enabled.
 */
class CustomBoardService {

	public function __construct(
		private LoggerInterface $logger,
		private IConfig $config,
		private IServerContainer $container,
	) {
	}

	private function getBoardData(): array {
		$jsonPath = __DIR__ . '/fixtures/default-board.json';
		$jsonContent = file_get_contents($jsonPath);
		return json_decode($jsonContent, true);
	}

	public function createWelcomeBoard(string $userId): ?Board {
		try {
			// Check if user already has firstRun set to 'no' (board already created)
			$firstRun = $this->config->getUserValue($userId, 'deck', 'firstRun', 'yes');
			if ($firstRun === 'no') {
				$this->logger->debug('User already has Deck firstRun=no, skipping', ['userId' => $userId]);
				return null;
			}

			// Set firstRun to 'no' BEFORE creating our board to prevent race condition
			// with DefaultBoardMiddleware
			$this->config->setUserValue($userId, 'deck', 'firstRun', 'no');

			// Get Deck services lazily through container
			$boardService = $this->container->get(\OCA\Deck\Service\BoardService::class);
			$stackService = $this->container->get(\OCA\Deck\Service\StackService::class);
			$cardService = $this->container->get(\OCA\Deck\Service\CardService::class);
			$labelService = $this->container->get(\OCA\Deck\Service\LabelService::class);

			// CRITICAL: Set userId on services so permission checks pass
			// BoardService.setUserId also sets it on PermissionService
			$boardService->setUserId($userId);

			$boardData = $this->getBoardData();

			/** @var Board $board */
			$board = $boardService->create(
				$boardData['title'],
				$userId,
				$boardData['color'],
			);

			$boardId = $board->getId();
			$customLabels = [];

			// Create additional labels
			foreach ($boardData['addition_labels'] as $labelData) {
				$customLabels[$labelData['title']] = $labelService->create(
					$labelData['title'],
					$labelData['color'],
					$boardId
				);
			}

			// Merge with default board labels
			$allLabels = array_merge($board->getLabels() ?? [], array_values($customLabels));

			// Create stacks and cards
			foreach ($boardData['stacks'] as $stackData) {
				$stack = $stackService->create(
					$stackData['title'],
					$boardId,
					$stackData['order']
				);

				foreach ($stackData['cards'] as $cardData) {
					$card = $cardService->create(
						$cardData['title'],
						$stack->getId(),
						$cardData['type'],
						$cardData['order'],
						$userId,
						$cardData['description'] ?? '',
					);

					// Assign labels to card
					foreach ($allLabels as $label) {
						if ($label && in_array($label->getTitle(), $cardData['labels'] ?? [])) {
							$cardService->assignLabel($card->getId(), $label->getId());
						}
					}
				}
			}

			$this->logger->info('Created Avuz Conecta welcome board for user: ' . $userId);
			return $board;

		} catch (\Throwable $e) {
			$this->logger->error('Failed to create Avuz welcome board for user: ' . $userId, [
				'exception' => $e,
				'message' => $e->getMessage(),
				'trace' => $e->getTraceAsString(),
			]);
			return null;
		}
	}
}
