/**
 * Avuz Login — open the "Esqueceu a senha?" view from a link
 * The invalid reset-link page sends users to login?direct=1#lostpassword.
 * The login Vue app has no URL for its lost-password view, so once it renders
 * we press its own "Esqueceu a senha?" button (#lost-password). If the button
 * never shows up (reset disabled, SSO-only), the plain login page stays.
 */
(function () {
    var LOST_PASSWORD_HASH = '#lostpassword';
    var GIVE_UP_AFTER_MS = 5000;

    if (window.location.hash !== LOST_PASSWORD_HASH) {
        return;
    }

    function clearHash() {
        history.replaceState(null, '', window.location.pathname + window.location.search);
    }

    function pressLostPasswordButton() {
        var button = document.getElementById('lost-password');
        if (!button) {
            return false;
        }
        clearHash();
        button.click();
        return true;
    }

    function watch() {
        if (pressLostPasswordButton()) {
            return;
        }
        var observer = new MutationObserver(function () {
            if (pressLostPasswordButton()) {
                observer.disconnect();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(function () {
            observer.disconnect();
        }, GIVE_UP_AFTER_MS);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', watch);
    } else {
        watch();
    }
})();
