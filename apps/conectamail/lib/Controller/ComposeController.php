<?php

declare(strict_types=1);

namespace OCA\Roundcube\Controller;

use OCA\Roundcube\Service\ComposeRecipients;
use OCA\Roundcube\Service\MailBackend;
use OCA\Roundcube\Service\MailboxAddress;
use OCA\Roundcube\Service\WebmailTokenService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\RedirectResponse;
use OCP\IRequest;
use OCP\IURLGenerator;

/**
 * Target of e-mail links elsewhere in Avuz Conecta (js/mailto-links.js): opens a new
 * webmail message to the address in its own tab. Anything it cannot open goes to the
 * ConectaMail page, which explains what is missing.
 */
class ComposeController extends Controller
{
    public function __construct(
        IRequest $request,
        private MailBackend $mailBackend,
        private WebmailTokenService $webmail,
        private MailboxAddress $mailboxAddress,
        private IURLGenerator $urlGenerator,
        private ?string $userId,
    ) {
        parent::__construct('conectamail', $request);
    }

    /**
     * @NoAdminRequired
     * @NoCSRFRequired
     */
    public function compose(string $to = ''): RedirectResponse
    {
        $recipients = ComposeRecipients::from($to);
        $userId = (string) $this->userId;
        if ($recipients === ''
            || $this->mailBackend->effective() !== MailBackend::WEBMAIL
            || !$this->mailboxAddress->exists($userId)) {
            return new RedirectResponse($this->urlGenerator->linkToRoute('conectamail.page.index'));
        }

        return new RedirectResponse($this->webmail->buildComposeUrl($userId, $recipients));
    }
}
