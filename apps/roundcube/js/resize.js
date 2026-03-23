(function () {
    function resizeFrame() {
        const frame = document.getElementById('roundcube-frame');
        if (!frame) return;

        const offset = frame.getBoundingClientRect().top;
        frame.style.height = (window.innerHeight - offset) + 'px';
    }

    window.addEventListener('resize', resizeFrame);
    document.addEventListener('DOMContentLoaded', resizeFrame);
    resizeFrame();
})();
