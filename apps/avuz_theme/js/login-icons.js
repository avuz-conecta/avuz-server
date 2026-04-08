/**
 * Avuz Login — Icon row injector
 * Appends a row of 5 branded icons at the bottom of the login card.
 * Icons are linked to support/product pages (update hrefs as needed).
 * Runs after DOMContentLoaded.
 */
(function () {
    var BASE = OC.filePath ? '' : '';

    // Resolve the image path relative to this app's img/ directory.
    // OC.generateUrl is not available on the login page, so we build it manually.
    function imgUrl(filename) {
        return '/apps/avuz_theme/img/' + filename;
    }

    var icons = [
        { img: imgUrl('login-icon-1.png'), alt: 'Arquivos'   },
        { img: imgUrl('login-icon-2.png'), alt: 'E-mail'     },
        { img: imgUrl('login-icon-3.png'), alt: 'Vídeo'      },
        { img: imgUrl('login-icon-4.png'), alt: 'Chat'       },
        { img: imgUrl('login-icon-5.png'), alt: 'Calendário' },
    ];

    function inject() {
        var wrapper = document.querySelector('body#body-login .wrapper');
        if (!wrapper) return;

        var row = document.createElement('div');
        row.className = 'avuz-login-icons';

        icons.forEach(function (icon) {
            var span = document.createElement('span');
            span.title = icon.alt;

            var img = document.createElement('img');
            img.src = icon.img;
            img.alt = icon.alt;
            img.width = 28;
            img.height = 28;

            span.appendChild(img);
            row.appendChild(span);
        });

        wrapper.appendChild(row);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', inject);
    } else {
        inject();
    }
})();
