<?php

declare(strict_types=1);

namespace OCA\Roundcube\Listener;

use OCA\Roundcube\Service\MailBackend;
use OCA\Roundcube\Service\MailboxAddress;
use OCP\AppFramework\Http\Events\BeforeTemplateRenderedEvent;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;
use OCP\IUserSession;
use OCP\Util;

/**
 * Loads js/mailto-links.js on every logged-in page for users who can write from the
 * webmail, so e-mail links open a new ConectaMail message instead of the computer's
 * own mail program.
 *
 * @template-implements IEventListener<BeforeTemplateRenderedEvent>
 */
class MailtoLinksListener implements IEventListener
{
    public function __construct(
        private IUserSession $userSession,
        private MailBackend $mailBackend,
        private MailboxAddress $mailboxAddress,
    ) {
    }

    public function handle(Event $event): void
    {
        if (!$event instanceof BeforeTemplateRenderedEvent || !$event->isLoggedIn()) {
            return;
        }
        $user = $this->userSession->getUser();
        if ($user === null
            || $this->mailBackend->effective() !== MailBackend::WEBMAIL
            || !$this->mailboxAddress->exists($user->getUID())) {
            return;
        }
        Util::addScript('conectamail', 'mailto-links');
    }
}
