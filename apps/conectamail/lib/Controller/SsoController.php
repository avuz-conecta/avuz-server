<?php

namespace OCA\Roundcube\Controller;

use OCA\Roundcube\Service\MailboxAddress;
use OCA\Roundcube\Service\WebmailTokenService;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http\NotFoundResponse;
use OCP\AppFramework\Http\RedirectResponse;
use OCP\AppFramework\Http\Response;
use OCP\AppFramework\Http\TemplateResponse;
use OCP\IRequest;

/**
 * Standalone (own-tab) handover to the new webmail. Logged-in only
 * (@NoAdminRequired, no @PublicPage): an unauthenticated hit lands on the normal
 * Avuz Conecta login page and returns here afterwards. @NoCSRFRequired because
 * it is a top-level GET navigation, not a form post.
 */
class SsoController extends Controller
{
    public function __construct(
        IRequest $request,
        private WebmailTokenService $webmail,
        private MailboxAddress $mailboxAddress,
        private ?string $userId,
    ) {
        parent::__construct('conectamail', $request);
    }

    /**
     * @NoAdminRequired
     * @NoCSRFRequired
     */
    public function webmail(string $return = ''): Response
    {
        $baseUrl = $this->webmail->baseUrl();
        if ($baseUrl === '' || !$this->webmail->isConfigured()) {
            return new NotFoundResponse();
        }

        if (!$this->mailboxAddress->exists((string) $this->userId)) {
            return new TemplateResponse('conectamail', 'no-mailbox');
        }

        $returnQuery = $this->returnQuery($return);

        $token = $this->webmail->buildToken($this->userId);
        if ($token === null) {
            // No stored mail password yet: send to the webmail root so it runs
            // its own login/prompt, mirroring the Roundcube fallback.
            return new RedirectResponse($baseUrl . '/' . $this->prefix($returnQuery, '?'));
        }

        $url = $baseUrl . '/api/auth/sso?token=' . urlencode($token) . $this->prefix($returnQuery, '&');

        return new RedirectResponse($url);
    }

    /**
     * Relative paths only — blocks open redirects (absolute URLs, scheme,
     * protocol-relative `//host`, backslashes, NUL). Returns `return=<enc>` or ''.
     */
    private function returnQuery(string $return): string
    {
        if ($return === '' || str_contains($return, "\0") || str_contains($return, '\\')) {
            return '';
        }
        if (!str_starts_with($return, '/') || str_starts_with($return, '//')) {
            return '';
        }
        if (preg_match('#^[a-z][a-z0-9+.-]*:#i', $return) === 1) {
            return '';
        }

        return 'return=' . urlencode($return);
    }

    private function prefix(string $query, string $separator): string
    {
        return $query === '' ? '' : $separator . $query;
    }
}
