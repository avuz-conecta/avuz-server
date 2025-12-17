<?php
/**
 * Avuz Theme - Standalone Maintenance Page
 * This template overrides `core/templates/update.user.php`
 */

// We can't use the normal theming methods here, so we construct paths manually.
// This is necessary because this template is rendered before the full theming app is loaded.
$avuzThemePath = \OCP\Server::get(\OCP\IURLGenerator::class)->getAbsoluteURL(\OCP\Server::get(\OCP\IAppManager::class)->getAppPath('avuz_theme'));
$theme = \OCP\Server::get('ThemingDefaults');
$l = \OCP\Server::get(\OCP\L10N\IFactory::class)->get('lib');
?>
<!DOCTYPE html>
<html class="ng-csp" data-placeholder-focus="false" lang="<?php p(\OCP\Server::get(\OCP\L10N\IFactory::class)->findLanguage() ?? 'en'); ?>" data-locale="<?php p(\OCP\Server::get(\OCP\L10N\IFactory::class)->findLocale() ?? 'en_US'); ?>" translate="no">
<head>
    <meta charset="utf-8">
    <title><?php p($theme->getTitle()); ?></title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, minimum-scale=1.0">
    <meta name="theme-color" content="#2bb5e3">
    <link rel="icon" href="<?php print_unescaped($avuzThemePath . '/img/favicon.ico'); ?>">
    <link rel="apple-touch-icon" href="<?php print_unescaped($avuzThemePath . '/img/favicon-touch.png'); ?>">
    <link rel="mask-icon" sizes="any" href="<?php print_unescaped($avuzThemePath . '/img/favicon-mask.svg'); ?>" color="#2bb5e3">

    <style>
        /* Avuz Custom Maintenance/Guest Layout - Inlined */
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
            font-size: 1rem;
            font-weight: 400;
            line-height: 1.5;
            color: #212529;
            text-align: left;
            display: flex !important;
            flex-direction: row !important;
            justify-content: flex-end !important;
            align-items: stretch !important;
            padding: 0 !important;
            margin: 0 !important;
            min-height: 100vh;
            height: 100vh;
            position: relative;
            overflow: hidden !important;
            background: none !important;
            background-image: none !important;
            background-color: #ffffff !important;
        }
        body::after { display: none !important; }
        body::before {
            content: '';
            position: fixed;
            left: 0;
            top: 0;
            bottom: 0;
            width: 70%;
            background-color: #f2f6fb !important;
            background-image: url('<?php print_unescaped($avuzThemePath); ?>/img/network-diagram.png');
            background-repeat: no-repeat;
            background-position: calc(50% - 1.5rem) center;
            background-size: 60%;
            z-index: 0;
        }
        .wrapper {
            width: 30% !important;
            max-width: none !important;
            margin: 0 !important;
            margin-left: auto !important;
            padding: 0rem 3rem !important;
            display: flex !important;
            flex-direction: column !important;
            align-items: center !important;
            justify-content: center !important;
            position: relative;
            z-index: 1;
            background-color: #f2f6fb !important;
            min-height: 100vh;
            height: 100vh;
            overflow-y: auto;
            overflow-x: hidden;
        }
        .v-align {
            width: 100%;
            max-width: 380px;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: auto;
            padding: 2rem;
            overflow: hidden;
            background-color: #ffffff !important;
            border-radius: 35px;
            margin: auto;
        }
        .avuz-logo-top {
            display: block;
            width: 160px;
            height: 50px;
            background-image: url('<?php print_unescaped($avuzThemePath); ?>/img/logo.png');
            background-repeat: no-repeat;
            background-position: center;
            background-size: contain;
            margin: 1rem auto 1rem;
        }
        .avuz-logo-bottom {
            display: block;
            width: 400px;
            height: 128px;
            background-image: url('<?php print_unescaped($avuzThemePath); ?>/img/logo2.png');
            background-repeat: no-repeat;
            background-position: center;
            background-size: contain;
            margin: 2rem auto 0;
        }
        .message-box {
            text-align: center;
            color: #767676;
        }
        h2 {
           font-size: 1.5rem;
           margin-bottom: 1rem;
           color: #767676;
        }
        p {
           margin-top: 0;
           margin-bottom: 1rem;
        }
        @media only screen and (max-width: 768px) {
            body { flex-direction: column !important; justify-content: center !important; }
            body::before { display: none; }
            .wrapper { width: 100% !important; padding: 2rem !important; min-height: auto !important; }
        }
    </style>
</head>
<body>
    <div class="wrapper">
        <div class="v-align">
            <div class="avuz-logo-top"></div>
            <div class="message-box">
                <h2><?php p($l->t('Maintenance mode')); ?></h2>
	            <p><?php p($l->t('This %s instance is currently in maintenance mode, which may take a while.', [$theme->getName()])); ?></p>
	            <p><?php p($l->t('Please refresh this page in a few minutes.')); ?></p>
            </div>
            <div class="avuz-logo-bottom"></div>
        </div>
    </div>
</body>
</html>
