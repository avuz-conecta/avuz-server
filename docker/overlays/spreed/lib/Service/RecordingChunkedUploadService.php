<?php

declare(strict_types=1);

namespace OCA\Talk\Service;

use InvalidArgumentException;
use OCA\Talk\Room;
use OCP\Files\IAppData;
use OCP\Files\NotFoundException;
use OCP\Files\SimpleFS\ISimpleFolder;
use OCP\IConfig;
use Psr\Log\LoggerInterface;

class RecordingChunkedUploadService {
	private const CHUNK_TTL_SECONDS = 3600; // 1h — clean stale uploads
	private const MAX_CHUNKS = 200;          // hard cap: 200 × 50MB = 10GB

	public function __construct(
		private IAppData $appData,
		private IConfig $config,
		private LoggerInterface $logger,
	) {
	}

	public function init(Room $room, string $fileName, int $totalSize): string {
		$this->validateFileName($fileName);
		if ($totalSize <= 0) {
			throw new InvalidArgumentException('size');
		}
		$uploadId = bin2hex(random_bytes(16));
		$folder = $this->getUploadFolder($room->getToken(), $uploadId, create: true);
		$folder->newFile('.meta')->putContent(json_encode([
			'token' => $room->getToken(),
			'fileName' => $fileName,
			'totalSize' => $totalSize,
			'createdAt' => time(),
		], JSON_THROW_ON_ERROR));
		return $uploadId;
	}

	public function writeChunk(Room $room, string $uploadId, int $index, string $body): void {
		if ($index < 0 || $index >= self::MAX_CHUNKS) {
			throw new InvalidArgumentException('chunk_index');
		}
		$folder = $this->getUploadFolder($room->getToken(), $uploadId, create: false);
		$folder->newFile(sprintf('%04d.part', $index))->putContent($body);
	}

	/**
	 * @return array{tmp_name: string, name: string, size: int, type: string, error: int}
	 *         Same shape as $_FILES entry — caller hands to RecordingService::store().
	 */
	public function finalize(Room $room, string $uploadId): array {
		$folder = $this->getUploadFolder($room->getToken(), $uploadId, create: false);
		$meta = json_decode($folder->getFile('.meta')->getContent(), true, flags: JSON_THROW_ON_ERROR);

		$tmpPath = tempnam(sys_get_temp_dir(), 'avuz-rec-');
		if ($tmpPath === false) {
			throw new InvalidArgumentException('tmp_create');
		}
		$out = fopen($tmpPath, 'wb');
		if ($out === false) {
			throw new InvalidArgumentException('tmp_open');
		}

		$chunks = [];
		foreach ($folder->getDirectoryListing() as $file) {
			if (str_ends_with($file->getName(), '.part')) {
				$chunks[] = $file;
			}
		}
		usort($chunks, fn($a, $b) => strcmp($a->getName(), $b->getName()));

		$totalWritten = 0;
		foreach ($chunks as $chunk) {
			$bytes = $chunk->getContent();
			$written = fwrite($out, $bytes);
			if ($written === false || $written !== strlen($bytes)) {
				fclose($out);
				@unlink($tmpPath);
				$this->cleanup($room->getToken(), $uploadId);
				throw new InvalidArgumentException('write_failed');
			}
			$totalWritten += $written;
		}
		fclose($out);

		if ($totalWritten !== (int)$meta['totalSize']) {
			@unlink($tmpPath);
			$this->cleanup($room->getToken(), $uploadId);
			throw new InvalidArgumentException('size_mismatch');
		}

		$this->cleanup($room->getToken(), $uploadId);

		return [
			'tmp_name' => $tmpPath,
			'name' => (string)$meta['fileName'],
			'size' => $totalWritten,
			'type' => '',
			'error' => 0,
		];
	}

	public function cleanup(string $token, string $uploadId): void {
		try {
			$this->getUploadFolder($token, $uploadId, create: false)->delete();
		} catch (NotFoundException) {
			// nothing to clean
		}
	}

	public function sweepStale(): void {
		try {
			$root = $this->appData->getFolder('recording-chunks');
		} catch (NotFoundException) {
			return;
		}
		$now = time();
		foreach ($root->getDirectoryListing() as $tokenFolder) {
			if (!$tokenFolder instanceof ISimpleFolder) {
				continue;
			}
			foreach ($tokenFolder->getDirectoryListing() as $uploadFolder) {
				if (!$uploadFolder instanceof ISimpleFolder) {
					continue;
				}
				try {
					$meta = json_decode($uploadFolder->getFile('.meta')->getContent(), true);
					if (($now - (int)$meta['createdAt']) > self::CHUNK_TTL_SECONDS) {
						$uploadFolder->delete();
					}
				} catch (\Throwable $e) {
					$this->logger->warning('Failed to sweep stale recording chunk dir', ['exception' => $e]);
				}
			}
		}
	}

	private function getUploadFolder(string $token, string $uploadId, bool $create): ISimpleFolder {
		if (!preg_match('/^[a-z0-9]{4,30}$/', $token) || !preg_match('/^[a-f0-9]{32}$/', $uploadId)) {
			throw new InvalidArgumentException('id_format');
		}
		try {
			$root = $this->appData->getFolder('recording-chunks');
		} catch (NotFoundException) {
			$root = $this->appData->newFolder('recording-chunks');
		}
		$path = $token . '/' . $uploadId;
		try {
			return $root->getFolder($path);
		} catch (NotFoundException) {
			if (!$create) {
				throw new InvalidArgumentException('upload_unknown');
			}
			return $root->newFolder($path);
		}
	}

	private function validateFileName(string $fileName): void {
		if ($fileName === '' || str_contains($fileName, '/') || str_contains($fileName, "\0")) {
			throw new InvalidArgumentException('filename');
		}
	}
}
