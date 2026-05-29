<?php

namespace OCA\Roundcube\Listener;

use OCA\Roundcube\Service\CredentialService;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\IUserSession;
use OCP\User\Events\UserLoggedOutEvent;

/** @template-implements IEventListener<UserLoggedOutEvent> */
class UserLoggedOutListener implements IEventListener
{
    public function __construct(
        private CredentialService $credentialService,
        private IUserSession $userSession,
    ) {}

    public function handle(Event $event): void
    {
        if (!$event instanceof UserLoggedOutEvent) {
            return;
        }

        $user = $this->userSession->getUser();
        if ($user === null) {
            return;
        }

        $this->credentialService->clearCredentials($user->getUID());
    }
}
