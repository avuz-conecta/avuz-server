<?php
/** @var array{heading: string, text?: string, action?: array{label: string, url: string}} $_ */
OCP\Util::addStyle('conectamail', 'notice');
$headingWithoutHyphenBreak = preg_replace('/e-mail/i', '<span class="conectamail-notice__nowrap">$0</span>', htmlspecialchars($_['heading'], ENT_QUOTES, 'UTF-8'));
?>
<div class="conectamail-notice">
    <section class="conectamail-notice__card" aria-labelledby="conectamail-notice-heading">
        <img class="conectamail-notice__mark conectamail-notice__mark--light" src="<?php p(image_path('conectamail', 'conecta-mail-logo.png')); ?>" alt="ConectaMail" width="560" height="199">
        <img class="conectamail-notice__mark conectamail-notice__mark--dark" src="<?php p(image_path('conectamail', 'conecta-mail-logo-dark.png')); ?>" alt="ConectaMail" width="560" height="199">
        <h2 id="conectamail-notice-heading" class="conectamail-notice__heading"><?php print_unescaped($headingWithoutHyphenBreak); ?></h2>
<?php if (!empty($_['text'])): ?>
        <p class="conectamail-notice__text"><?php p($_['text']); ?></p>
<?php endif; ?>
<?php if (!empty($_['action']['url'])): ?>
        <a class="conectamail-notice__button" href="<?php p($_['action']['url']); ?>"><?php p($_['action']['label']); ?></a>
<?php endif; ?>
    </section>
</div>
