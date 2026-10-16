<?php

namespace OCA\Roundcube\Controller;

use OCA\Roundcube\Service\CredentialService;
use OCA\Roundcube\Service\MailboxAddress;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\ContentSecurityPolicy;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\IRequest;
use OCP\IURLGenerator;

class PageController extends Controller
{
    public function __construct(
        IRequest $request,
        private CredentialService $credentialService,
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

        $iframeUrl = $this->credentialService->buildIframeUrl($this->userId);
        $roundcubeOrigin = $this->credentialService->getRoundcubeOrigin();

        $response = new TemplateResponse('conectamail', 'index', [
            'iframe_url' => $iframeUrl,
        ]);

        $csp = new ContentSecurityPolicy();
        $csp->addAllowedFrameDomain($roundcubeOrigin);
        $response->setContentSecurityPolicy($csp);

        return $response;
    }
}
