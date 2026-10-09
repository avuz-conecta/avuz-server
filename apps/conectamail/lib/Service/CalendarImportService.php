<?php
declare(strict_types=1);
namespace OCA\Roundcube\Service;

use OCP\Calendar\ICalendarIsWritable;
use OCP\Calendar\IManager;
use OCP\IUserManager;
use Sabre\VObject\Reader;

class ImportException extends \RuntimeException {}

class CalendarImportService {
    public function __construct(
        private IUserManager $userManager,
        private IManager $calendarManager,
    ) {}

    /**
     * Upsert an incoming iTip invite (METHOD:REQUEST) into the user's calendar.
     *
     * The invite is handed to Nextcloud's IManager::handleIMip, which routes it
     * through the CalDAV iTip broker. The broker (Sabre's
     * Broker::processMessageRequest) replaces the stored event with the incoming
     * REQUEST regardless of SEQUENCE — it does NOT skip an older/equal one. So WE
     * gate downgrades: the SEQUENCE check below returns 'unchanged' and skips
     * handleIMip whenever the incoming SEQUENCE is not newer than the stored one.
     * The old code returned 'already_present' on ANY matching UID, so a
     * re-sent/updated invite was silently dropped — that is the bug this fixes.
     *
     * handleIMip only returns a bool, so we decide the reported status ourselves:
     *   - no existing event  → 'created'  (handleIMip with absent=create)
     *   - newer SEQUENCE      → 'updated'
     *   - older/equal SEQUENCE → 'unchanged' (we skip handleIMip; the broker
     *     would otherwise overwrite the stored event with the stale invite)
     *
     * @return 'created'|'updated'|'unchanged'
     */
    public function import(string $email, string $ics, string $uid): string {
        $users = $this->userManager->getByEmail($email);
        if (count($users) !== 1) {
            throw new ImportException('no unambiguous user for email');
        }
        $uidNc = $users[0]->getUID();
        $calendars = $this->calendarManager->getCalendarsForPrincipal('principals/users/' . $uidNc);

        $existing = $this->findExisting($calendars, $uid);

        if ($existing === null) {
            // absent=create stores the event, preferring the user's primary
            // calendar and falling back to the first iMip-capable one.
            if (!$this->calendarManager->handleIMip($uidNc, $ics, ['absent' => 'create'])) {
                throw new ImportException('no calendar accepted the invite');
            }
            if ($this->findExisting($calendars, $uid) === null) {
                throw new ImportException('invite accepted but event not stored');
            }
            return 'created';
        }

        $incoming = $this->incomingSequence($ics);
        if ($incoming <= $this->existingSequence($existing)) {
            return 'unchanged';
        }

        if (!$this->calendarManager->handleIMip($uidNc, $ics)) {
            throw new ImportException('calendar rejected the invite update');
        }
        $stored = $this->findExisting($calendars, $uid);
        if ($stored === null || $this->existingSequence($stored) !== $incoming) {
            throw new ImportException('invite accepted but stored SEQUENCE not updated');
        }
        return 'updated';
    }

    /** @return array|null the first stored calendar object carrying $uid, if any */
    private function findExisting(array $calendars, string $uid): ?array {
        foreach ($calendars as $calendar) {
            if (!($calendar instanceof ICalendarIsWritable)
                || !$calendar->isWritable() || $calendar->isDeleted()) {
                continue;
            }
            $found = $calendar->search('', [], ['uid' => $uid], 1);
            if (!empty($found)) {
                return $found[0];
            }
        }
        return null;
    }

    private function incomingSequence(string $ics): int {
        try {
            $vcal = Reader::read($ics);
        } catch (\Throwable $e) {
            return 0;
        }
        return isset($vcal->VEVENT->SEQUENCE) ? (int) (string) $vcal->VEVENT->SEQUENCE : 0;
    }

    /** SEQUENCE lives at objects[0]['SEQUENCE'] = [value, parameters] (ICalendar::search shape). */
    private function existingSequence(array $event): int {
        $sequence = $event['objects'][0]['SEQUENCE'][0] ?? 0;
        return is_scalar($sequence) ? (int) $sequence : 0;
    }
}
