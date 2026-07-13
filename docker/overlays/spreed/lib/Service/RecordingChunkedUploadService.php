<?php

declare(strict_types=1);

namespace OCA\Talk\Service;

use InvalidArgumentException;
use OCA\Talk\Room;
use OCP\IConfig;
use Psr\Log\LoggerInterface;

class RecordingChunkedUploadService {
	private const CHUNK_TTL_SECONDS = 3600;
	private const MAX_CHUNKS = 200;

	public function __construct(
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
		$dir = $this->getUploadDir($room->getToken(), $uploadId, create: true);
		file_put_contents($dir . '/.meta', json_encode([
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
		$dir = $this->getUploadDir($room->getToken(), $uploadId, create: false);
		$path = $dir . '/' . sprintf('%04d.part', $index);
		// Write to a unique temp then atomically rename: a retried chunk racing the
		// slow first write can never interleave into the final part, and finalize's
		// glob of *.part never sees a partial file.
		$tmp = $path . '.tmp.' . bin2hex(random_bytes(6));
		if (file_put_contents($tmp, $body) === false) {
			@unlink($tmp);
			throw new InvalidArgumentException('chunk_write');
		}
		if (!rename($tmp, $path)) {
			@unlink($tmp);
			throw new InvalidArgumentException('chunk_rename');
		}
	}

	/**
	 * @return array{tmp_name: string, name: string, size: int, type: string, error: int}
	 */
	public function finalize(Room $room, string $uploadId, ?int $actualSize = null): array {
		$dir = $this->getUploadDir($room->getToken(), $uploadId, create: false);
		$metaRaw = @file_get_contents($dir . '/.meta');
		if ($metaRaw === false) {
			throw new InvalidArgumentException('meta_missing');
		}
		$meta = json_decode($metaRaw, true, flags: JSON_THROW_ON_ERROR);

		$tmpPath = tempnam(sys_get_temp_dir(), 'avuz-rec-');
		if ($tmpPath === false) {
			throw new InvalidArgumentException('tmp_create');
		}
		$out = fopen($tmpPath, 'wb');
		if ($out === false) {
			throw new InvalidArgumentException('tmp_open');
		}

		$chunks = glob($dir . '/[0-9][0-9][0-9][0-9].part') ?: [];
		sort($chunks);

		$totalWritten = 0;
		foreach ($chunks as $chunkPath) {
			$bytes = @file_get_contents($chunkPath);
			if ($bytes === false) {
				fclose($out);
				@unlink($tmpPath);
				throw new InvalidArgumentException('chunk_read');
			}
			$written = fwrite($out, $bytes);
			if ($written === false || $written !== strlen($bytes)) {
				fclose($out);
				@unlink($tmpPath);
				throw new InvalidArgumentException('write_failed');
			}
			$totalWritten += $written;
		}
		fclose($out);

		$expectedSize = $actualSize !== null && $actualSize > 0
			? $actualSize
			: (int)$meta['totalSize'];
		if ($totalWritten !== $expectedSize) {
			@unlink($tmpPath);
			throw new InvalidArgumentException(sprintf(
				'size_mismatch:got=%d:expected=%d:chunks=%d',
				$totalWritten, $expectedSize, count($chunks),
			));
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
		$this->validateIds($token, $uploadId);
		$dir = $this->getRoot() . '/' . $token . '/' . $uploadId;
		if (!is_dir($dir)) {
			return;
		}
		foreach (glob($dir . '/*') ?: [] as $f) {
			@unlink($f);
		}
		@unlink($dir . '/.meta');
		@rmdir($dir);
		// Drop the per-token parent dir if it's now empty.
		$tokenDir = $this->getRoot() . '/' . $token;
		if (is_dir($tokenDir) && count(glob($tokenDir . '/*') ?: []) === 0) {
			@rmdir($tokenDir);
		}
	}

	public function sweepStale(): void {
		$root = $this->getRoot();
		if (!is_dir($root)) {
			return;
		}
		$now = time();
		foreach (glob($root . '/*', GLOB_ONLYDIR) ?: [] as $tokenDir) {
			foreach (glob($tokenDir . '/*', GLOB_ONLYDIR) ?: [] as $uploadDir) {
				try {
					$meta = json_decode((string)@file_get_contents($uploadDir . '/.meta'), true);
					if (is_array($meta) && ($now - (int)($meta['createdAt'] ?? 0)) > self::CHUNK_TTL_SECONDS) {
						$token = basename($tokenDir);
						$uploadId = basename($uploadDir);
						$this->cleanup($token, $uploadId);
					}
				} catch (\Throwable $e) {
					$this->logger->warning('Failed to sweep stale chunk dir', ['exception' => $e, 'dir' => $uploadDir]);
				}
			}
		}
	}

	public function getRoot(): string {
		$dataDir = $this->config->getSystemValue('datadirectory', '/var/www/html/data');
		return rtrim($dataDir, '/') . '/avuz-recording-chunks';
	}

	private function getUploadDir(string $token, string $uploadId, bool $create): string {
		$this->validateIds($token, $uploadId);
		$dir = $this->getRoot() . '/' . $token . '/' . $uploadId;
		if (is_dir($dir)) {
			return $dir;
		}
		if (!$create) {
			throw new InvalidArgumentException('upload_unknown');
		}
		if (!mkdir($dir, 0770, true) && !is_dir($dir)) {
			throw new InvalidArgumentException('mkdir');
		}
		return $dir;
	}

	private function validateIds(string $token, string $uploadId): void {
		if (!preg_match('/^[a-z0-9]{4,30}$/', $token) || !preg_match('/^[a-f0-9]{32}$/', $uploadId)) {
			throw new InvalidArgumentException('id_format');
		}
	}

	private function validateFileName(string $fileName): void {
		if ($fileName === '' || str_contains($fileName, '/') || str_contains($fileName, "\0")) {
			throw new InvalidArgumentException('filename');
		}
	}
}
