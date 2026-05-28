<?php

namespace OCA\Roundcube\Controller;

use OCA\Roundcube\Service\CredentialService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IRequest;

class CredentialApiController extends Controller
{
    public function __construct(
        IRequest $request,
        private CredentialService $credentialService,
        private string $userId,
    ) {
        parent::__construct('conectamail', $request);
    }

    /**
     * @NoAdminRequired
     */
    public function store(): JSONResponse
    {
        $password = $this->request->getParam('password', '');
        if (empty($password)) {
            return new JSONResponse(['error' => 'password_required'], 400);
        }

        $this->credentialService->storeEmailPassword($this->userId, $password);

        return new JSONResponse(['status' => 'ok']);
    }
}
