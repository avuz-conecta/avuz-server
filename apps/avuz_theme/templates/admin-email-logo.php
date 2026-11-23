<?php
/**
 * Mounted by js/email-logo-admin.js (Deck #516).
 *
 * @var array{logo: array{url: string, width: int, height: int}|null, avuzLogo: array{url: string, width: int, height: int}} $_
 */
$avuzLogo = $_['avuzLogo'];
$tenantLogo = $_['logo'];
?>
<div id="avuz-email-logo" class="section avuz-elogo"
	data-avuz-logo="<?php p(json_encode($avuzLogo)); ?>"
	data-tenant-logo="<?php p(json_encode($tenantLogo)); ?>"></div>
