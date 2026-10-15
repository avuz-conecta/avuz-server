<?php
/** @var array{heading: string, text?: string} $_ */
OCP\Util::addStyle('conectamail', 'notice');
?>
<div class="conectamail-notice">
    <section class="conectamail-notice__card" aria-labelledby="conectamail-notice-heading">
        <span class="conectamail-notice__mark" aria-hidden="true"></span>
        <h2 id="conectamail-notice-heading" class="conectamail-notice__heading"><?php p($_['heading']); ?></h2>
<?php if (!empty($_['text'])): ?>
        <p class="conectamail-notice__text"><?php p($_['text']); ?></p>
<?php endif; ?>
    </section>
</div>
