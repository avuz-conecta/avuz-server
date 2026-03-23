<?php

namespace OCA\Roundcube\Listener;

use OCA\Roundcube\Service\CredentialService;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\User\Events\UserLoggedInEvent;

/** @template-implements IEventListener<UserLoggedInEvent> */
class UserLoggedInListener implements IEventListener
{
    public function __construct(private CredentialService $credentialService) {}

    public function handle(Event $event): void
    {
        if (!$event instanceof UserLoggedInEvent) {
            return;
        }

        // Skip app-password / remember-me token logins — no raw password available
        if ($event->isTokenLogin()) {
            return;
        }

        $password = $event->getPassword();
        if (empty($password)) {
            return;
        }

        $this->credentialService->storeCredentials(
            $event->getUser()->getUID(),
            $password,
        );
    }
}
