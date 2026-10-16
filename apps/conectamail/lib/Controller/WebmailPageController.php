<?php

namespace OCA\Roundcube\Controller;

use OCA\Roundcube\Http\WebmailPage;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\IRequest;

class WebmailPageController extends Controller
{
    public function __construct(
        IRequest $request,
        private WebmailPage $webmailPage,
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
        return $this->webmailPage->render((string) $this->userId);
    }
}
