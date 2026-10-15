<?php
/**
 * SPDX-FileCopyrightText: 2026 Avuz Conecta
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/** @var array $_ */
/** @var \OCP\IL10N $l */
\OCP\Util::addStyle('core', 'guest-notice');
?>
<main class="guest-notice" aria-labelledby="guest-notice-title">
	<h2 id="guest-notice-title" class="guest-notice__title"><?php p($l->t('Invalid or expired reset link')); ?></h2>
	<p class="guest-notice__body"><?php p($l->t('This link was already used or has expired. Request a new link to reset your password.')); ?></p>
	<div class="guest-notice__actions">
		<a class="guest-notice__primary" href="<?php p($_['requestLinkUrl']); ?>"><?php p($l->t('Request new link')); ?></a>
		<a class="guest-notice__ghost" href="<?php p($_['loginUrl']); ?>"><?php p($l->t('Back to login')); ?></a>
	</div>
</main>
