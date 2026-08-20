/**
 * Deck read-only stack titles render a bare <h3> with no `title` attribute,
 * so viewers get no hover tooltip on the ellipsis-clipped list name. Mirror the
 * textContent into a native `title` attribute so hovering reveals the full name.
 */
(function () {
	"use strict";

	if (!window.location.pathname.includes("/apps/deck")) {
		return;
	}

	const READONLY_TITLE = ".stack__header h3:not(.stack__title)";

	function syncTitles() {
		document.querySelectorAll(READONLY_TITLE).forEach((heading) => {
			const name = heading.textContent.trim();
			if (name && heading.getAttribute("title") !== name) {
				heading.setAttribute("title", name);
			}
		});
	}

	let scheduled = false;
	function scheduleSync() {
		if (scheduled) {
			return;
		}
		scheduled = true;
		requestAnimationFrame(() => {
			scheduled = false;
			syncTitles();
		});
	}

	const observer = new MutationObserver(scheduleSync);
	observer.observe(document.body, { childList: true, subtree: true });
	syncTitles();
})();
