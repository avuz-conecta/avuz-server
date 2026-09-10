<?php
declare(strict_types=1);
namespace OCA\Roundcube\Service;

use OCP\Calendar\ICalendarIsWritable;
use OCP\Calendar\ICreateFromString;
use OCP\Calendar\IManager;
use OCP\IUserManager;
use Sabre\VObject\Reader;

class ImportException extends \RuntimeException {}

class CalendarImportService {
    public function __construct(
        private IUserManager $userManager,
        private IManager $calendarManager,
    ) {}

    public function import(string $email, string $ics, string $uid): string {
        $users = $this->userManager->getByEmail($email);
        if (count($users) !== 1) {
            throw new ImportException('no unambiguous user for email');
        }
        $uidNc = $users[0]->getUID();
        $calendars = $this->calendarManager->getCalendarsForPrincipal('principals/users/' . $uidNc);

        $target = null;
        foreach ($calendars as $calendar) {
            if ($calendar instanceof ICreateFromString
                && $calendar instanceof ICalendarIsWritable
                && $calendar->isWritable() && !$calendar->isDeleted()) {
                $target = $calendar;
                break;
            }
        }
        if ($target === null) {
            throw new ImportException('no writable calendar');
        }

        $existing = $target->search('', [], ['uid' => $uid], 1);
        if (!empty($existing)) {
            return 'already_present';
        }

        // The invite is an iTip message (METHOD:REQUEST). A calendar object stored
        // on a CalDAV server MUST NOT carry a METHOD property (RFC 4791 / Sabre
        // rejects it with UnsupportedMediaType). Strip METHOD before storing so we
        // persist a plain event, not a scheduling message.
        $vcal = Reader::read($ics);
        unset($vcal->METHOD);
        $clean = $vcal->serialize();

        $name = md5($uid) . '.ics';
        if (method_exists($target, 'createFromStringMinimal')) {
            $target->createFromStringMinimal($name, $clean);
        } else {
            $target->createFromString($name, $clean);
        }
        return 'created';
    }
}
