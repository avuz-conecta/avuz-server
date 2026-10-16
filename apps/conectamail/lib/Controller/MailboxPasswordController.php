<?php

namespace OCA\Roundcube\Controller;

use OCA\Roundcube\Service\CredentialService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IRequest;
use Psr\Log\LoggerInterface;

/**
 * Personal settings API for the current user's ConectaMail mailbox password.
 * Responses carry only the saved status, never the password or its ciphertext.
 */
class MailboxPasswordController extends Controller
{
    public function __construct(
        IRequest $request,
        private CredentialService $credentialService,
        private LoggerInterface $logger,
        private ?string $userId,
    ) {
        parent::__construct('conectamail', $request);
    }

    /**
     * @NoAdminRequired
     */
    public function status(): JSONResponse
    {
        if ($this->userId === null) {
            return new JSONResponse(['error' => 'not_logged_in'], Http::STATUS_UNAUTHORIZED);
        }

        return new JSONResponse($this->credentialService->emailPasswordStatus($this->userId));
    }

    /**
     * @NoAdminRequired
     * @PasswordConfirmationRequired
     */
    public function save(): JSONResponse
    {
        if ($this->userId === null) {
            return new JSONResponse(['error' => 'not_logged_in'], Http::STATUS_UNAUTHORIZED);
        }

        $password = $this->request->getParam('password', '');
        $error = $this->credentialService->emailPasswordError($password);
        if ($error !== null) {
            return new JSONResponse(['error' => $error], Http::STATUS_BAD_REQUEST);
        }

        $this->credentialService->storeEmailPassword($this->userId, $password);
        $this->logger->info('Mailbox password saved', ['app' => 'conectamail', 'uid' => $this->userId]);

        return new JSONResponse($this->credentialService->emailPasswordStatus($this->userId));
    }

    /**
     * @NoAdminRequired
     * @PasswordConfirmationRequired
     */
    public function remove(): JSONResponse
    {
        if ($this->userId === null) {
            return new JSONResponse(['error' => 'not_logged_in'], Http::STATUS_UNAUTHORIZED);
        }

        $this->credentialService->clearEmailPassword($this->userId);
        $this->logger->info('Mailbox password removed', ['app' => 'conectamail', 'uid' => $this->userId]);

        return new JSONResponse($this->credentialService->emailPasswordStatus($this->userId));
    }
}
