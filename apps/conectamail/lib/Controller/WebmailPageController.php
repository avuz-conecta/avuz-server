<?php

namespace OCA\Roundcube\Controller;

use OCA\Roundcube\Service\WebmailTokenService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\ContentSecurityPolicy;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\IRequest;

/**
 * Embedded (iframe) handover to the new webmail, reusing the Roundcube page
 * template + resize.js (including its missing-password postMessage path).
 */
class WebmailPageController extends Controller
{
    public function __construct(
        IRequest $request,
        private WebmailTokenService $webmail,
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
