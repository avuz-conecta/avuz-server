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
        private ?string $userId,
    ) {
        parent::__construct('conectamail', $request);
    }

    /**
     * @NoAdminRequired
     */
    public function store(): JSONResponse
    {
        $password = $this->request->getParam('password', '');
        $error = $this->credentialService->emailPasswordError($password);
        if ($error !== null) {
            return new JSONResponse(['error' => $error], 400);
        }

        $this->credentialService->storeEmailPassword($this->userId, $password);

        return new JSONResponse(['status' => 'ok']);
    }
}
