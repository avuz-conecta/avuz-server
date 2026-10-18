<?php
/**
 * SPDX-FileCopyrightText: 2020 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */
/** @var \OCP\IL10N $l */
\OCP\Util::addStyle('core', 'guest-notice');
$loginUrl = \OCP\Server::get(\OCP\IURLGenerator::class)->linkToRoute('core.login.showLoginForm');
?>
<main class="guest-notice guest-notice--link-only" aria-labelledby="guest-notice-title">
	<h2 id="guest-notice-title" class="guest-notice__title"><?php p($l->t('Too many attempts')); ?></h2>
	<p class="guest-notice__body"><?php p($l->t('Wait a few minutes and try again.')); ?></p>
	<div class="guest-notice__actions">
		<a class="guest-notice__ghost" href="<?php p($loginUrl); ?>"><?php p($l->t('Back to login')); ?></a>
	</div>
</main>
