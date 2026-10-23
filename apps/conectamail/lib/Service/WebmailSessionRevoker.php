<?php

namespace OCA\Roundcube\Service;

use OCP\Http\Client\IClientService;
use Psr\Log\LoggerInterface;

/**
 * Ends the user's webmail-avuz sessions when they log out of Avuz Conecta,
 * so the webmail URL opened directly no longer shows their inbox.
 *
 * Server to server: POST {webmail}/api/auth/conecta-logout with a signed,
 * single-use logout token in the body. The webmail destroys every session
 * its SSO opened for the uid; mailbox-password logins are left alone.
 * Never blocks the logout: short timeout, failures only logged.
 * See docs/superpowers/specs/2026-10-20-webmail-logout-revokes-sessions.md.
 */
class WebmailSessionRevoker
{
    private const LOGOUT_PATH = '/api/auth/conecta-logout';
    private const TIMEOUT_SECONDS = 3;
    // The webmail refuses writes without it (its CSRF gate)
    private const REQUEST_HEADER = 'x-webmail-request';

    public function __construct(
        private WebmailTokenService $tokens,
        private IClientService $clientService,
        private LoggerInterface $logger,
    ) {}

    public function revoke(string $userId): void
    {
        $token = $this->tokens->buildLogoutToken($userId);
        if ($token === null) {
            return;
        }

        try {
            $response = $this->clientService->newClient()->post($this->tokens->baseUrl() . self::LOGOUT_PATH, [
                'json' => ['token' => $token],
                'headers' => [self::REQUEST_HEADER => '1'],
                'timeout' => self::TIMEOUT_SECONDS,
            ]);
            $this->logger->info('Webmail sessions ended on logout', [
                'app' => 'conectamail',
                'user' => $userId,
                'response' => $response->getBody(),
            ]);
        } catch (\Throwable $e) {
            $this->logger->warning('Could not end webmail sessions on logout: ' . $e->getMessage(), [
                'app' => 'conectamail',
                'user' => $userId,
            ]);
        }
    }
}
