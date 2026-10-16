<?php

namespace OCA\Roundcube\Controller;

use OCA\Roundcube\Service\MailboxAddress;
use OCA\Roundcube\Service\WebmailTokenService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\ContentSecurityPolicy;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\IRequest;
use OCP\IURLGenerator;

/**
 * Embedded (iframe) handover to the new webmail, reusing the Roundcube page
 * template + resize.js (including its missing-password postMessage path).
 */
class WebmailPageController extends Controller
{
    public function __construct(
        IRequest $request,
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
    public function index(): TemplateResponse
    {
        if (!$this->mailboxAddress->exists((string) $this->userId)) {
            return new TemplateResponse('conectamail', 'no-mailbox', [
                'dashboard_url' => $this->urlGenerator->linkToRoute('dashboard.dashboard.index'),
            ]);
        }

        $response = new TemplateResponse('conectamail', 'index', [
            'iframe_url' => $this->webmail->buildIframeUrl($this->userId),
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
