<?php
declare(strict_types=1);
namespace OCA\Roundcube\Controller;

use OCA\Roundcube\Service\CalendarImportService;
use OCA\Roundcube\Service\ImportException;
use OCA\Roundcube\Service\SignatureException;
use OCA\Roundcube\Service\SignatureVerifier;
use OCP\AppFramework\Controller;
use OCP\AppFramework\Http;
use OCP\AppFramework\Http\JSONResponse;
use OCP\IConfig;
use OCP\IRequest;
use Sabre\VObject\Reader;

class CalendarApiController extends Controller {
    public function __construct(
        IRequest $request,
        private IConfig $config,
        private CalendarImportService $importService,
    ) {
        parent::__construct('conectamail', $request);
    }

    /**
     * @PublicPage
     * @NoCSRFRequired
     */
    public function import(): JSONResponse {
        $body = file_get_contents('php://input') ?: '';
        $envelope = $this->request->getHeader('X-Avuz-Signature');
        $secret = $this->config->getAppValue('conectamail', 'sso_secret', (string) getenv('ROUNDCUBE_SSO_SECRET'));
        try {
            $payload = (new SignatureVerifier($secret))->verify($envelope, $body);
        } catch (SignatureException $e) {
            return new JSONResponse(['error' => 'unauthorized'], Http::STATUS_UNAUTHORIZED);
        }

        $uid = $this->extractUid($body);
        if ($uid === null) {
            return new JSONResponse(['error' => 'invalid ics'], Http::STATUS_UNPROCESSABLE_ENTITY);
        }

        try {
            $status = $this->importService->import($payload['email'], $body, $uid);
        } catch (ImportException $e) {
            return new JSONResponse(['error' => 'not_found'], Http::STATUS_NOT_FOUND);
        } catch (\Exception $e) {
            return new JSONResponse(['error' => 'invalid ics'], Http::STATUS_UNPROCESSABLE_ENTITY);
        }
        return new JSONResponse(['status' => $status]);
    }

    private function extractUid(string $ics): ?string {
        try {
            $vcal = Reader::read($ics);
        } catch (\Throwable $e) {
            return null;
        }
        $uid = isset($vcal->VEVENT) ? trim((string) $vcal->VEVENT->UID) : '';
        return $uid !== '' ? $uid : null;
    }
}
