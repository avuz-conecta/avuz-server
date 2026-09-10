<?php
declare(strict_types=1);
namespace OCA\Roundcube\Service;

use OCP\Calendar\ICalendarIsWritable;
use OCP\Calendar\ICreateFromString;
use OCP\Calendar\IManager;
use OCP\IUserManager;

class ImportException extends \RuntimeException {}

class CalendarImportService {
    public function __construct(
        private IUserManager $userManager,
        private IManager $calendarManager,
    ) {}

    public function import(string $email, string $ics, string $uid): string {
        $users = $this->userManager->getByEmail($email);
        if (count($users) === 0) {
            throw new ImportException('no user for email');
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

        $name = md5($uid) . '.ics';
        if (method_exists($target, 'createFromStringMinimal')) {
            $target->createFromStringMinimal($name, $ics);
        } else {
            $target->createFromString($name, $ics);
        }
        return 'created';
    }
}
