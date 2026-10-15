<?php
/** @var array{status: array{saved: bool, updated_at: ?int}, max_length: int} $_ */
/** @var \OCP\IL10N $l */
OCP\Util::addScript('conectamail', 'settings-personal');
OCP\Util::addStyle('conectamail', 'settings-personal');
$saved = $_['status']['saved'];
?>
<div class="section" id="conectamail-mailbox-password"
     data-saved="<?php p($saved ? 'true' : 'false'); ?>"
     data-updated-at="<?php p((string) ($_['status']['updated_at'] ?? '')); ?>"
     data-max-length="<?php p((string) $_['max_length']); ?>">
    <h2><?php p($l->t('Mailbox password')); ?></h2>
    <p class="settings-hint">
        <?php p($l->t('Save your ConectaMail mailbox password so Avuz Conecta opens your e-mail without asking for it. It is stored encrypted and never shown again.')); ?>
    </p>

    <p id="conectamail-password-status" class="conectamail-password-status">
        <span id="conectamail-password-status-text"><?php p($saved ? $l->t('Mailbox password saved') : $l->t('No password saved')); ?></span>
        <span id="conectamail-password-updated-at" class="conectamail-password-updated-at"></span>
    </p>

    <form id="conectamail-password-form" class="conectamail-password-form" novalidate>
        <label for="conectamail-password-input"><?php p($l->t('New mailbox password')); ?></label>
        <div class="conectamail-password-row">
            <input type="password"
                   id="conectamail-password-input"
                   name="password"
                   autocomplete="new-password"
                   maxlength="<?php p((string) $_['max_length']); ?>"
                   aria-describedby="conectamail-password-message"
                   required>
            <button type="submit" id="conectamail-password-save" class="primary"><?php p($l->t('Save')); ?></button>
            <button type="button" id="conectamail-password-remove" class="conectamail-password-remove"<?php if (!$saved): ?> hidden<?php endif; ?>><?php p($l->t('Remove')); ?></button>
            <div id="conectamail-password-confirm"
                 class="conectamail-password-confirm"
                 role="group"
                 aria-label="<?php p($l->t('Confirm mailbox password removal')); ?>"
                 hidden>
                <span><?php p($l->t('Remove the saved mailbox password? Avuz Conecta will try your login password to open your e-mail.')); ?></span>
                <button type="button" id="conectamail-password-confirm-remove" class="conectamail-password-danger"><?php p($l->t('Remove')); ?></button>
                <button type="button" id="conectamail-password-confirm-cancel"><?php p($l->t('Cancel')); ?></button>
            </div>
        </div>
        <p id="conectamail-password-message" class="conectamail-password-message" aria-live="polite"></p>
    </form>
</div>
