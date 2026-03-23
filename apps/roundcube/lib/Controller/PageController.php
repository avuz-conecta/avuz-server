<?php

namespace OCA\Roundcube\Controller;

use OCA\Roundcube\Service\CredentialService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\IRequest;

class PageController extends Controller
{
    public function __construct(
        IRequest $request,
        private CredentialService $credentialService,
        private string $userId,
    ) {
        parent::__construct('roundcube', $request);
    }

    /**
     * @NoAdminRequired
     * @NoCSRFRequired
     */
    public function index(): TemplateResponse
    {
        $iframeUrl = $this->credentialService->buildIframeUrl($this->userId);

        return new TemplateResponse('roundcube', 'index', [
            'iframe_url' => $iframeUrl,
        ]);
    }
}
