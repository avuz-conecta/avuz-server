<?php

namespace OCA\Roundcube\Service;

use OC\Authentication\Token\IProvider;
use OCP\Authentication\Exceptions\ExpiredTokenException;
use OCP\Authentication\Exceptions\InvalidTokenException;
use OCP\Authentication\Exceptions\WipeTokenException;
use OCP\Authentication\Token\IToken;
use OCP\IConfig;
use OCP\Security\ISecureRandom;
use Psr\Log\LoggerInterface;

/**
 * Issues an Avuz Conecta app password (device token) per user for CardDAV, used
 * by the new webmail to read contacts. Created once, reused, regenerated if the
 * user revoked it from their security settings.
 *
 * Mirrors the core app-password flow (core/Controller/AppPasswordController):
 * 72-char random token via ISecureRandom, persisted through the token provider
 * as a PERMANENT_TOKEN. The plaintext is never returned to the browser and never
 * logged — only handed to the webmail inside the 60s SSO token.
 */
class AppPasswordService
{
    private const APP_ID = 'conectamail';
    private const TOKEN_NAME = 'Conecta Mail (contatos)';
    private const PREF_TOKEN_ID = 'webmail_app_token_id';
    private const PREF_TOKEN = 'webmail_app_token_enc';

    public function __construct(
        private IConfig $config,
        private IProvider $tokenProvider,
        private ISecureRandom $random,
        private Crypto $crypto,
        private LoggerInterface $logger,
    ) {}

    /**
     * Returns the plaintext CardDAV app password for the user, creating it on
     * first use and recreating it if it was revoked. Null on failure.
     */
    public function getOrCreate(string $userId): ?string
    {
        $existing = $this->readValid($userId);
        if ($existing !== null) {
            return $existing;
        }

        return $this->create($userId);
    }

    private function readValid(string $userId): ?string
    {
        $storedId = $this->config->getUserValue($userId, self::APP_ID, self::PREF_TOKEN_ID, '');
        $storedToken = $this->config->getUserValue($userId, self::APP_ID, self::PREF_TOKEN, '');
        if ($storedId === '' || $storedToken === '') {
            return null;
        }

        try {
            $token = $this->tokenProvider->getTokenById((int) $storedId);
        } catch (InvalidTokenException | ExpiredTokenException | WipeTokenException) {
            $this->clear($userId);
            return null;
        }

        if ($token->getUID() !== $userId) {
            $this->clear($userId);
            return null;
        }

        $plain = $this->crypto->decrypt($storedToken);
        return $plain !== '' ? $plain : null;
    }

    private function create(string $userId): ?string
    {
        $plain = $this->random->generate(72, ISecureRandom::CHAR_UPPER . ISecureRandom::CHAR_LOWER . ISecureRandom::CHAR_DIGITS);

        try {
            $token = $this->tokenProvider->generateToken(
                $plain,
                $userId,
                $userId,
                null,
                self::TOKEN_NAME,
                IToken::PERMANENT_TOKEN,
                IToken::DO_NOT_REMEMBER,
            );
        } catch (\Throwable $e) {
            $this->logger->error('conectamail: failed to create CardDAV app password', ['exception' => $e]);
            return null;
        }

        $this->config->setUserValue($userId, self::APP_ID, self::PREF_TOKEN_ID, (string) $token->getId());
        $this->config->setUserValue($userId, self::APP_ID, self::PREF_TOKEN, $this->crypto->encrypt($plain));

        return $plain;
    }

    private function clear(string $userId): void
    {
        $this->config->deleteUserValue($userId, self::APP_ID, self::PREF_TOKEN_ID);
        $this->config->deleteUserValue($userId, self::APP_ID, self::PREF_TOKEN);
    }
}
