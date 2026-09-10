<?php
namespace OCA\Roundcube\Tests\Unit\Service;
use OCA\Roundcube\Service\CalendarImportService;
use OCA\Roundcube\Service\ImportException;
use OCP\Calendar\ICreateFromString;
use OCP\Calendar\ICalendarIsWritable;
use OCP\Calendar\IManager;
use OCP\IUser;
use OCP\IUserManager;
use PHPUnit\Framework\TestCase;

class CalendarImportServiceTest extends TestCase {
    protected function setUp(): void {
        if (!interface_exists('OCP\\Calendar\\IManager')) {
            $this->markTestSkipped('requires Nextcloud environment');
        }
    }

    private function user(string $uid): IUser {
        $u = $this->createMock(IUser::class);
        $u->method('getUID')->willReturn($uid);
        return $u;
    }
    private function writableCalendar(array $searchResult): object {
        return new class($searchResult) implements ICreateFromString, ICalendarIsWritable {
            public array $created = [];
            public function __construct(private array $searchResult) {}
            public function getKey(): string { return 'personal'; }
            public function getUri(): string { return 'personal'; }
            public function getDisplayName(): ?string { return 'Personal'; }
            public function getDisplayColor(): ?string { return null; }
            public function getPermissions(): int { return 31; }
            public function isWritable(): bool { return true; }
            public function isDeleted(): bool { return false; }
            public function search(string $pattern, array $searchProperties=[], array $options=[], ?int $limit=null, ?int $offset=null): array { return $this->searchResult; }
            public function createFromString(string $name, string $calendarData): void { $this->created[] = [$name,$calendarData]; }
        };
    }

    public function testCreatesWhenAbsent(): void {
        $cal = $this->writableCalendar([]);
        $manager = $this->createMock(IManager::class);
        $manager->method('getCalendarsForPrincipal')->willReturn([$cal]);
        $users = $this->createMock(IUserManager::class);
        $users->method('getByEmail')->willReturn([$this->user('alice')]);
        $svc = new CalendarImportService($users, $manager);
        $this->assertSame('created', $svc->import('a@b.com', "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n", 'uid-1'));
        $this->assertCount(1, $cal->created);
        $this->assertSame(md5('uid-1').'.ics', $cal->created[0][0]);
    }

    public function testSkipsWhenUidPresent(): void {
        $cal = $this->writableCalendar([['uri'=>'x.ics']]);
        $manager = $this->createMock(IManager::class);
        $manager->method('getCalendarsForPrincipal')->willReturn([$cal]);
        $users = $this->createMock(IUserManager::class);
        $users->method('getByEmail')->willReturn([$this->user('alice')]);
        $svc = new CalendarImportService($users, $manager);
        $this->assertSame('already_present', $svc->import('a@b.com', 'x', 'uid-1'));
        $this->assertCount(0, $cal->created);
    }

    public function testThrowsWhenNoUser(): void {
        $this->expectException(ImportException::class);
        $manager = $this->createMock(IManager::class);
        $users = $this->createMock(IUserManager::class);
        $users->method('getByEmail')->willReturn([]);
        (new CalendarImportService($users, $manager))->import('a@b.com', 'x', 'uid-1');
    }

    public function testThrowsWhenEmailAmbiguousAcrossUsers(): void {
        $this->expectException(ImportException::class);
        $manager = $this->createMock(IManager::class);
        $users = $this->createMock(IUserManager::class);
        $users->method('getByEmail')->willReturn([$this->user('alice'), $this->user('bob')]);
        (new CalendarImportService($users, $manager))->import('a@b.com', 'x', 'uid-1');
    }
}
