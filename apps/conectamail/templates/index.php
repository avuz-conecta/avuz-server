<div style="width:100%;height:100%;overflow:hidden;position:relative;">
<?php if (!empty($_['iframe_url'])): ?>
    <iframe
        id="roundcube-frame"
        src="<?php echo htmlspecialchars($_['iframe_url'], ENT_QUOTES, 'UTF-8'); ?>"
        style="border:none;width:100%;height:100%;position:absolute;top:0;left:0;right:0;bottom:0;"
        allow="clipboard-read; clipboard-write"
        tabindex="-1"
        frameborder="0"
    ></iframe>
<?php else: ?>
    <div style="padding:2rem;text-align:center;color:#666;">
        <p>Roundcube URL not configured.</p>
        <p>Set <code>roundcube_url</code> in the app settings.</p>
    </div>
<?php endif; ?>
</div>
<?php OCP\Util::addScript('conectamail', 'resize'); ?>
