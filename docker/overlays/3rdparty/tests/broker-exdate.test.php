<?php

declare(strict_types=1);

/**
 * Regression test for the Google Calendar import crash: a NEW recurring event
 * with EXDATE in which the user is an attendee made sabre/vobject 4.5.6 call
 * in_array() on a null haystack (TypeError → CalDAV PUT 500, event lost).
 *
 * Usage: php broker-exdate.test.php <3rdparty/autoload.php> [<Broker.php to test>]
 * In the image: php /var/www/html/docker/overlays/3rdparty/tests/broker-exdate.test.php /var/www/html/3rdparty/autoload.php
 */

[, $autoload, $brokerUnderTest] = $argv + [null, null, null];
if ($autoload === null) {
	fwrite(STDERR, "usage: php broker-exdate.test.php <3rdparty/autoload.php> [<Broker.php>]\n");
	exit(2);
}
require $autoload;
if ($brokerUnderTest !== null) {
	require $brokerUnderTest;
}

use Sabre\VObject\ITip\Broker;

const ATTENDEE_HREF = 'mailto:lucia@avuz.example';

const GOOGLE_RECURRING_MEETING = <<<ICS
BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Google Inc//Google Calendar 70.9054//EN
BEGIN:VEVENT
UID:weekly-sync@google.com
DTSTART:20261102T130000Z
DTEND:20261102T140000Z
RRULE:FREQ=WEEKLY;COUNT=6
EXDATE:20261109T130000Z
SUMMARY:Reunião semanal
ORGANIZER;CN=Ana:mailto:ana@cliente.example
ATTENDEE;CN=Ana;PARTSTAT=ACCEPTED:mailto:ana@cliente.example
ATTENDEE;CN=Lúcia;PARTSTAT=ACCEPTED:mailto:lucia@avuz.example
END:VEVENT
END:VCALENDAR
ICS;

$failures = 0;
$check = static function (string $name, callable $test) use (&$failures): void {
	try {
		$test();
		echo "ok   {$name}\n";
	} catch (\Throwable $error) {
		$failures++;
		echo "FAIL {$name}: " . get_class($error) . ': ' . $error->getMessage() . "\n";
	}
};

$check('parses a new recurring meeting with EXDATE where the user is an attendee', static function (): void {
	$messages = (new Broker())->parseEvent(GOOGLE_RECURRING_MEETING, [ATTENDEE_HREF]);
	if (!is_array($messages)) {
		throw new \RuntimeException('parseEvent did not return a list of messages');
	}
});

$check('declines the skipped instance to the organizer when importing the meeting', static function (): void {
	$messages = (new Broker())->parseEvent(GOOGLE_RECURRING_MEETING, [ATTENDEE_HREF]);
	$replies = array_values(array_filter($messages, static fn ($message): bool => $message->method === 'REPLY'));
	if (count($replies) !== 1 || $replies[0]->recipient !== 'mailto:ana@cliente.example') {
		throw new \RuntimeException('expected one REPLY to the organizer, got ' . count($replies));
	}
	if (!str_contains($replies[0]->message->serialize(), 'PARTSTAT=DECLINED')) {
		throw new \RuntimeException('the REPLY does not decline the EXDATE instance');
	}
});

exit($failures === 0 ? 0 : 1);
