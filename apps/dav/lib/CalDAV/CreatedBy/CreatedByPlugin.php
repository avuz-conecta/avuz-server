<?php

declare(strict_types=1);

/*
 * SPDX-FileCopyrightText: 2026 Avuz Conecta
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
namespace OCA\DAV\CalDAV\CreatedBy;

use OCA\DAV\CalDAV\Calendar;
use OCP\IUserManager;
use OCP\IUserSession;
use Sabre\CalDAV\ICalendarObject;
use Sabre\DAV\Exception\NotFound;
use Sabre\DAV\Server;
use Sabre\DAV\ServerPlugin;
use Sabre\HTTP\RequestInterface;
use Sabre\HTTP\ResponseInterface;
use Sabre\VObject\Component\VCalendar;
use Sabre\VObject\ParseException;
use Sabre\VObject\Reader;

/**
 * AVUZ-CREATED-BY-V1 (card 455): stamps who created a calendar object when it
 * is created in a calendar the user does not own (shares, delegation). The
 * stamp is set on create only and carried over verbatim on every update, so a
 * client can neither drop nor forge it.
 */
class CreatedByPlugin extends ServerPlugin {
	public const PROPERTY = 'X-AVUZ-CREATED-BY';
	private const STAMPED_COMPONENTS = ['VEVENT', 'VTODO', 'VJOURNAL'];
	private const USER_PRINCIPAL_PREFIX = 'principals/users/';

	private ?Server $server = null;

	public function __construct(
		private IUserSession $userSession,
		private IUserManager $userManager,
	) {
	}

	public function initialize(Server $server): void {
		$this->server = $server;
		// After scheduling (priority 100), so the stamp is not part of the invitation sent on create.
		$server->on('calendarObjectChange', [$this, 'calendarObjectChange'], 110);
	}

	public function getPluginName(): string {
		return 'avuz-created-by';
	}

	public function calendarObjectChange(
		RequestInterface $request,
		ResponseInterface $response,
		VCalendar $calendarObject,
		string $calendarPath,
		bool &$modified,
		bool $isNew,
	): void {
		$creator = $isNew
			? $this->findCreator($calendarPath)
			: $this->findStoredCreator($request->getPath());

		if ($this->applyCreator($calendarObject, $creator)) {
			$modified = true;
		}
	}

	/**
	 * @return array{uid: string, displayName: string}|null
	 */
	private function findCreator(string $calendarPath): ?array {
		$user = $this->userSession->getUser();
		if ($user === null) {
			return null;
		}

		$calendar = $this->server?->tree->getNodeForPath($calendarPath);
		if (!$calendar instanceof Calendar) {
			return null;
		}

		$isOwner = $calendar->getOwner() === self::USER_PRINCIPAL_PREFIX . $user->getUID();
		if ($isOwner) {
			return null;
		}

		return ['uid' => $user->getUID(), 'displayName' => $user->getDisplayName()];
	}

	/**
	 * @return array{uid: string, displayName: string}|null
	 */
	private function findStoredCreator(string $objectPath): ?array {
		try {
			$storedObject = $this->server?->tree->getNodeForPath($objectPath);
		} catch (NotFound) {
			return null;
		}
		if (!$storedObject instanceof ICalendarObject) {
			return null;
		}

		try {
			$storedCalendar = Reader::read($storedObject->get());
		} catch (ParseException) {
			return null;
		}
		if (!$storedCalendar instanceof VCalendar) {
			return null;
		}

		foreach ($this->stampedComponents($storedCalendar) as $component) {
			$property = $component->select(self::PROPERTY)[0] ?? null;
			if ($property === null) {
				continue;
			}
			$uid = (string)$property->getValue();
			$displayName = (string)($property['CN'] ?? '');
			return [
				'uid' => $uid,
				'displayName' => $displayName !== '' ? $displayName : $this->userManager->getDisplayName($uid) ?? $uid,
			];
		}

		return null;
	}

	/**
	 * Replaces every stamp the client sent with $creator (or none). Reports a
	 * change only when the stamps differ, so untouched objects keep their ETag.
	 *
	 * @param array{uid: string, displayName: string}|null $creator
	 */
	private function applyCreator(VCalendar $calendarObject, ?array $creator): bool {
		$stampsBefore = $this->serializeStamps($calendarObject);

		foreach ($this->stampedComponents($calendarObject) as $component) {
			$component->remove(self::PROPERTY);
			if ($creator !== null) {
				$component->add(self::PROPERTY, $creator['uid'], ['CN' => $creator['displayName']]);
			}
		}

		return $stampsBefore !== $this->serializeStamps($calendarObject);
	}

	private function serializeStamps(VCalendar $calendarObject): string {
		$stamps = '';
		foreach ($this->stampedComponents($calendarObject) as $component) {
			foreach ($component->select(self::PROPERTY) as $property) {
				$stamps .= $property->serialize();
			}
		}
		return $stamps;
	}

	/**
	 * @return \Generator<\Sabre\VObject\Component>
	 */
	private function stampedComponents(VCalendar $calendarObject): \Generator {
		foreach ($calendarObject->getComponents() as $component) {
			if (in_array($component->name, self::STAMPED_COMPONENTS, true)) {
				yield $component;
			}
		}
	}
}
