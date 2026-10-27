<?php
// Headless ConectaMail SSO probe, run INSIDE an Avuz Conecta app container as www-data.
// Tokens, app passwords and cookies never leave the container. Delete /tmp/probe-jar-*.txt afterwards.
//   B=$(base64 < scripts/conectamail-sso-probe.php)
//   ./scripts/portainer-exec.sh -u www-data <container> sh -c "echo $B | base64 -d > /tmp/probe.php && php /tmp/probe.php login <uid> t1; rm /tmp/probe.php"
// Usage: php probe.php <mode> <uid> <jar-name>   (mode: login | me | contacts | page | logout | revoker)
// login: mint SSO token in-container, open webmail session (token never printed)
// me: session status + frame-ancestors with the jar's cookie
// logout: mint logout token, POST conecta-logout, print revoked count
// revoker: run the real WebmailSessionRevoker
require '/var/www/html/lib/base.php';
\OC_App::loadApp('conectamail');
[$_, $mode, $uid, $jarName] = $argv;
$tokens = \OC::$server->get(\OCA\Roundcube\Service\WebmailTokenService::class);
$base = $tokens->baseUrl();
$jar = "/tmp/probe-jar-$jarName.txt";

function http(string $url, array $opts = []): array {
  global $jar;
  $ch = curl_init($url);
  curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_HEADER => true, CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_COOKIEJAR => $jar, CURLOPT_COOKIEFILE => $jar, CURLOPT_TIMEOUT => 30] + $opts);
  $raw = curl_exec($ch);
  $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
  $headerSize = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
  return [$status, substr($raw, 0, $headerSize), substr($raw, $headerSize)];
}
function header_value(string $headers, string $name): string {
  return preg_match('/^' . preg_quote($name, '/') . ':\s*(.*)$/mi', $headers, $m) ? trim($m[1]) : '';
}
function report_session(string $base): void {
  [$status, , $body] = http("$base/api/auth/me");
  echo "  me: $status $body\n";
  [, $headers] = http("$base/");
  preg_match('/frame-ancestors [^;]*/', header_value($headers, 'content-security-policy'), $m);
  echo '  ' . ($m[0] ?? 'no frame-ancestors') . "\n";
}

if ($mode === 'login') {
  @unlink($jar);
  $token = $tokens->buildToken($uid);
  if ($token === null) { echo "  no token (no stored password/mailbox)\n"; exit(1); }
  [$status, $headers] = http("$base/api/auth/sso?token=" . urlencode($token) . '&return=%2F');
  echo "  sso: $status -> " . header_value($headers, 'location') . "\n";
  preg_match_all('/^set-cookie:\s*([^=]+)=/mi', $headers, $m);
  echo '  cookies: ' . implode(', ', $m[1]) . "\n";
  report_session($base);
} elseif ($mode === 'me') {
  report_session($base);
} elseif ($mode === 'logout') {
  $ch = curl_init("$base/api/auth/conecta-logout");
  curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_POST => true, CURLOPT_TIMEOUT => 30,
    CURLOPT_HTTPHEADER => ['Content-Type: application/json', 'x-webmail-request: 1'],
    CURLOPT_POSTFIELDS => json_encode(['token' => $tokens->buildLogoutToken($uid)])]);
  $body = curl_exec($ch);
  echo '  conecta-logout: ' . curl_getinfo($ch, CURLINFO_RESPONSE_CODE) . " $body\n";
} elseif ($mode === 'contacts') {
  sleep(5);
  [$status, , $body] = http("$base/api/contacts/status");
  echo "  contacts/status: $status $body
";
  [$status, , $body] = http("$base/api/contacts?limit=1");
  echo "  contacts list: $status " . substr(preg_replace('/"(fn|emails|phones|org|note|id)":("[^"]*"|\[[^\]]*\])/', '"$1":"…"', $body), 0, 160) . "
";
} elseif ($mode === 'page') {
  $page = \OC::$server->get(\OCA\Roundcube\Http\WebmailPage::class)->render($uid);
  $url = $page->getParams()['iframe_url'] ?? '';
  echo '  iframe: ' . preg_replace('/token=[^&]+/', 'token=<redacted>', $url) . "
";
  echo '  NC frame-src: ' . (preg_match('/frame-src [^;]*/', $page->getContentSecurityPolicy()->buildPolicy(), $m) ? $m[0] : '-') . "
";
} elseif ($mode === 'revoker') {
  \OC::$server->get(\OCA\Roundcube\Service\WebmailSessionRevoker::class)->revoke($uid);
  echo "  revoker ran\n";
}
