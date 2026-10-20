(function () {

    // Fill the page card (#content, #content-vue on Vue pages) down to its own
    // bottom edge: the window bottom sits a card margin lower and gets clipped.
    function resizeFrame() {
        var frame = document.getElementById('roundcube-frame');
        if (!frame) return;
        var card = frame.closest('#content, #content-vue');
        var bottom = card ? card.getBoundingClientRect().bottom : window.innerHeight;
        frame.style.height = (bottom - frame.getBoundingClientRect().top) + 'px';
    }

    function frameOrigin(frame) {
        try {
            return new URL(frame.src).origin;
        } catch (error) {
            return null;
        }
    }

    function isFromFrame(event, frame) {
        return !!frame
            && event.source === frame.contentWindow
            && event.origin === frameOrigin(frame);
    }

    window.addEventListener('message', function (event) {
        if (!event.data || event.data.type !== 'roundcube-sso-password') return;

        var frame = document.getElementById('roundcube-frame');
        if (!isFromFrame(event, frame)) return;

        var password = event.data.password;

        var xhr = new XMLHttpRequest();
        xhr.open('POST', OC.generateUrl('/apps/conectamail/api/credentials'));
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.setRequestHeader('requesttoken', OC.requestToken);
        xhr.onload = function () {
            if (xhr.status === 200) {
                window.location.reload();
            } else if (frame && frame.contentWindow) {
                frame.contentWindow.postMessage(
                    { type: 'roundcube-sso-error', message: 'Falha ao salvar senha. Tente novamente.' },
                    '*'
                );
            }
        };
        xhr.onerror = function () {
            if (frame && frame.contentWindow) {
                frame.contentWindow.postMessage(
                    { type: 'roundcube-sso-error', message: 'Erro de rede. Tente novamente.' },
                    '*'
                );
            }
        };
        xhr.send(JSON.stringify({ password: password }));
    });

    window.addEventListener('resize', resizeFrame);
    document.addEventListener('DOMContentLoaded', resizeFrame);
    resizeFrame();
}());
