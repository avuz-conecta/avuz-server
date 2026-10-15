<?php

namespace OCA\Roundcube\Service;

use OCP\IConfig;
use OCP\IUserManager;

/**
 * The user's mailbox address: the custom ConectaMail `email` user value, else
 * the Avuz Conecta account e-mail. No "@" means the user has no mailbox yet.
 */
class MailboxAddress
{
    private const APP_ID = 'conectamail';

    public function __construct(
        private IConfig $config,
        private IUserManager $userManager,
    ) {}

    public function resolve(string $userId): string
    {
        $customEmail = $this->config->getUserValue($userId, self::APP_ID, 'email', '');
        if ($customEmail !== '') {
            return $customEmail;
        }

        return $this->userManager->get($userId)?->getEMailAddress() ?: '';
    }

    public function exists(string $userId): bool
    {
        return str_contains($this->resolve($userId), '@');
    }
}
