<?php

namespace OCA\Roundcube\Settings;

use OCA\Roundcube\AppInfo\Application;
use OCA\Roundcube\Service\CredentialService;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\IUserSession;
use OCP\Settings\ISettings;

/**
 * "ConectaMail" personal settings: save, replace or remove the mailbox password.
 */
class Personal implements ISettings
{
    private const PRIORITY = 10;

    public function __construct(
        private CredentialService $credentialService,
        private IUserSession $userSession,
    ) {}

    public function getForm(): TemplateResponse
    {
        $userId = $this->userSession->getUser()?->getUID() ?? '';

        return new TemplateResponse(Application::APP_ID, 'settings-personal', [
            'status' => $this->credentialService->emailPasswordStatus($userId),
            'max_length' => CredentialService::EMAIL_PASSWORD_MAX_LENGTH,
        ]);
    }

    public function getSection(): string
    {
        return Application::APP_ID;
    }

    public function getPriority(): int
    {
        return self::PRIORITY;
    }
}
