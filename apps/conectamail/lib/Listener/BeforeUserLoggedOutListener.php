<?php

namespace OCA\Roundcube\Listener;

use OCA\Roundcube\Service\WebmailSessionRevoker;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\User\Events\BeforeUserLoggedOutEvent;

/**
 * Before, not after: Nextcloud clears the session user before it fires
 * UserLoggedOutEvent, so this event is the last place that knows who left.
 *
 * @template-implements IEventListener<BeforeUserLoggedOutEvent>
 */
class BeforeUserLoggedOutListener implements IEventListener
{
    public function __construct(private WebmailSessionRevoker $webmailSessions) {}

    public function handle(Event $event): void
    {
        if (!$event instanceof BeforeUserLoggedOutEvent) {
            return;
        }

        $user = $event->getUser();
        if ($user === null) {
            return;
        }

        $this->webmailSessions->revoke($user->getUID());
    }
}
