<?php

namespace OCA\Roundcube\Http;

use OCA\Roundcube\Service\MailboxAddress;
use OCA\Roundcube\Service\WebmailTokenService;
use OCP\AppFramework\Http\ContentSecurityPolicy;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\IURLGenerator;

/**
 * Embedded (iframe) handover to the new webmail, reusing the Roundcube page
 * template + resize.js (including its missing-password postMessage path).
 * Rendered by /webmail and by the Mail menu entry when mail_backend=webmail.
 */
class WebmailPage
{
    public function __construct(
        private WebmailTokenService $webmail,
        private MailboxAddress $mailboxAddress,
        private IURLGenerator $urlGenerator,
    ) {}

    public function render(string $userId): TemplateResponse
    {
        if (!$this->mailboxAddress->exists($userId)) {
            return new TemplateResponse('conectamail', 'no-mailbox', [
                'dashboard_url' => $this->urlGenerator->linkToRoute('dashboard.dashboard.index'),
            ]);
        }

        $response = new TemplateResponse('conectamail', 'index', [
            'iframe_url' => $this->webmail->buildIframeUrl($userId),
        ]);

        $origin = $this->webmail->origin();
        if ($origin !== '') {
            $csp = new ContentSecurityPolicy();
            $csp->addAllowedFrameDomain($origin);
            $response->setContentSecurityPolicy($csp);
        }

        return $response;
    }
}
