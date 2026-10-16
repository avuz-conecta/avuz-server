<?php

namespace OCA\Roundcube\Service;

use OCP\IAppConfig;

/**
 * Which webmail the Mail menu entry opens (app config `mail_backend`, env
 * CONECTAMAIL_BACKEND). Roundcube unless set to `webmail` AND the new webmail
 * is configured; anything else falls back to Roundcube.
 */
class MailBackend
{
    public const ROUNDCUBE = 'roundcube';
    public const WEBMAIL = 'webmail';

    private const APP_ID = 'conectamail';
    private const CONFIG_KEY = 'mail_backend';

    public function __construct(
        private IAppConfig $appConfig,
        private WebmailTokenService $webmail,
    ) {}

    public function effective(): string
    {
        $configured = strtolower(trim($this->appConfig->getValueString(self::APP_ID, self::CONFIG_KEY, self::ROUNDCUBE)));
        if ($configured !== self::WEBMAIL || !$this->webmail->isConfigured()) {
            return self::ROUNDCUBE;
        }

        return self::WEBMAIL;
    }
}
