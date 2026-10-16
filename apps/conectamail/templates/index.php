<?php
/** @var array{iframe_url: string} $_ */
/** @var \OCP\IL10N $l */
?>
<?php if (!empty($_['iframe_url'])): ?>
<div style="width:100%;height:100%;overflow:hidden;position:relative;">
    <iframe
        id="roundcube-frame"
        src="<?php echo htmlspecialchars($_['iframe_url'], ENT_QUOTES, 'UTF-8'); ?>"
        style="border:none;width:100%;height:100%;position:absolute;top:0;left:0;right:0;bottom:0;"
        allow="clipboard-read; clipboard-write"
        tabindex="-1"
        frameborder="0"
    ></iframe>
</div>
<?php OCP\Util::addScript('conectamail', 'resize'); ?>
<?php else: ?>
<?php print_unescaped($this->inc('part.notice', [
    'heading' => $l->t('E-mail is not available right now.'),
])); ?>
<?php endif; ?>
