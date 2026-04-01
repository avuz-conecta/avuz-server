(function () {

    function resizeFrame() {
        var frame = document.getElementById('roundcube-frame');
        if (!frame) return;
        var offset = frame.getBoundingClientRect().top;
        frame.style.height = (window.innerHeight - offset) + 'px';
    }

    window.addEventListener('message', function (event) {
        if (!event.data || event.data.type !== 'roundcube-sso-password') return;

        var frame = document.getElementById('roundcube-frame');
        var password = event.data.password;

        var xhr = new XMLHttpRequest();
        xhr.open('POST', OC.generateUrl('/apps/roundcube/api/credentials'));
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
