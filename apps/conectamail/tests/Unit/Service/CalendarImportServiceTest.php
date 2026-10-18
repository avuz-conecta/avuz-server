<?php
namespace OCA\Roundcube\Tests\Unit\Service;
use OCA\Roundcube\Service\CalendarImportService;
use OCA\Roundcube\Service\ImportException;
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

    /**
     * Writable calendar whose UID lookup returns each $results entry on
     * successive search() calls, sticking on the last once exhausted. This lets
     * a test model the state change a handleIMip write makes: the pre-write
     * search returns one result, the post-write verification search the next.
     */
    private function calendar(array ...$results): object {
        return new class($results) implements ICalendarIsWritable {
            private int $i = 0;
            public function __construct(private array $results) {}
            public function getKey(): string { return 'personal'; }
            public function getUri(): string { return 'personal'; }
            public function getDisplayName(): ?string { return 'Personal'; }
            public function getDisplayColor(): ?string { return null; }
            public function getPermissions(): int { return 31; }
            public function isWritable(): bool { return true; }
            public function isDeleted(): bool { return false; }
            public function search(string $pattern, array $searchProperties=[], array $options=[], ?int $limit=null, ?int $offset=null): array {
                $result = $this->results[$this->i] ?? [];
                if ($this->i < count($this->results) - 1) { $this->i++; }
                return $result;
            }
        };
    }

    private function ics(int $sequence): string {
        return "BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nUID:uid-1\r\n"
            . 'SEQUENCE:' . $sequence . "\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    }

    private function existingWithSequence(int $sequence): array {
        return [['objects' => [['SEQUENCE' => [$sequence, []]]]]];
    }

    public function testCreatesWhenAbsent(): void {
        $cal = $this->calendar([], $this->existingWithSequence(0));
        $ics = $this->ics(0);
        $manager = $this->createMock(IManager::class);
        $manager->method('getCalendarsForPrincipal')->willReturn([$cal]);
        $manager->expects($this->once())->method('handleIMip')
            ->with('alice', $ics, ['absent' => 'create'])->willReturn(true);
        $users = $this->createMock(IUserManager::class);
        $users->method('getByEmail')->willReturn([$this->user('alice')]);

        $svc = new CalendarImportService($users, $manager);
        $this->assertSame('created', $svc->import('a@b.com', $ics, 'uid-1'));
    }

    public function testUpdatesWhenNewerSequence(): void {
        $cal = $this->calendar($this->existingWithSequence(1), $this->existingWithSequence(2));
        $ics = $this->ics(2);
        $manager = $this->createMock(IManager::class);
        $manager->method('getCalendarsForPrincipal')->willReturn([$cal]);
        $manager->expects($this->once())->method('handleIMip')
            ->with('alice', $ics)->willReturn(true);
        $users = $this->createMock(IUserManager::class);
        $users->method('getByEmail')->willReturn([$this->user('alice')]);

        $svc = new CalendarImportService($users, $manager);
        $this->assertSame('updated', $svc->import('a@b.com', $ics, 'uid-1'));
    }

    public function testUnchangedWhenSequenceNotNewer(): void {
        $cal = $this->calendar($this->existingWithSequence(5));
        $manager = $this->createMock(IManager::class);
        $manager->method('getCalendarsForPrincipal')->willReturn([$cal]);
        $manager->expects($this->never())->method('handleIMip');
        $users = $this->createMock(IUserManager::class);
        $users->method('getByEmail')->willReturn([$this->user('alice')]);

        $svc = new CalendarImportService($users, $manager);
        $this->assertSame('unchanged', $svc->import('a@b.com', $this->ics(5), 'uid-1'));
        $this->assertSame('unchanged', $svc->import('a@b.com', $this->ics(3), 'uid-1'));
    }

    public function testThrowsWhenCreateRejected(): void {
        $this->expectException(ImportException::class);
        $cal = $this->calendar([]);
        $manager = $this->createMock(IManager::class);
        $manager->method('getCalendarsForPrincipal')->willReturn([$cal]);
        $manager->method('handleIMip')->willReturn(false);
        $users = $this->createMock(IUserManager::class);
        $users->method('getByEmail')->willReturn([$this->user('alice')]);

        (new CalendarImportService($users, $manager))->import('a@b.com', $this->ics(0), 'uid-1');
    }

    public function testThrowsWhenCreatedButEventMissing(): void {
        $this->expectException(ImportException::class);
        $cal = $this->calendar([], []);
        $manager = $this->createMock(IManager::class);
        $manager->method('getCalendarsForPrincipal')->willReturn([$cal]);
        $manager->method('handleIMip')->willReturn(true);
        $users = $this->createMock(IUserManager::class);
        $users->method('getByEmail')->willReturn([$this->user('alice')]);

        (new CalendarImportService($users, $manager))->import('a@b.com', $this->ics(0), 'uid-1');
    }

    public function testThrowsWhenUpdateSequenceNotApplied(): void {
        $this->expectException(ImportException::class);
        $cal = $this->calendar($this->existingWithSequence(1), $this->existingWithSequence(1));
        $manager = $this->createMock(IManager::class);
        $manager->method('getCalendarsForPrincipal')->willReturn([$cal]);
        $manager->method('handleIMip')->willReturn(true);
        $users = $this->createMock(IUserManager::class);
        $users->method('getByEmail')->willReturn([$this->user('alice')]);

        (new CalendarImportService($users, $manager))->import('a@b.com', $this->ics(2), 'uid-1');
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
