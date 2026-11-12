/**
 * Markers the theme's stylesheets scope by, instead of :has().
 *
 * Rules like `body:has(.app-deck) …` or `#app-sidebar-vue:has(#tab-button-details) …`
 * made Chrome restyle the whole page on every DOM change: on a 360-card Tarefas
 * board a card took ~11 s to open and close (0.5 s without them). The same
 * scopes as plain selectors cost nothing:
 *
 * - html[data-avuz-app="deck"]: the open app, from the address
 * - #app-sidebar-vue.avuz-sidebar--card / --board: a Tarefas card or board panel
 * - html.avuz-board-sidebar-open: the board panel is open
 * - html.avuz-calendar-editor-open: Calendar's new-event editor (and its backdrop) is open
 * - #app-content-vue.avuz-content--board-list: "Todos os painéis"
 * - .filter.avuz-filter--items: the board filter popover
 */
(function () {
	"use strict";

	const APP_IN_PATH = /\/apps\/([a-z0-9_]+)/;
	const app = window.location.pathname.match(APP_IN_PATH)?.[1];
	if (app) {
		document.documentElement.dataset.avuzApp = app;
	}

	// container, the class it gets, and what inside it earns the class
	const MARKERS = [
		{ container: "#app-sidebar-vue", marker: "avuz-sidebar--card", inside: "#tab-button-details" },
		{ container: "#app-sidebar-vue", marker: "avuz-sidebar--board", inside: "#tab-sharing" },
		{ container: "#app-content-vue", marker: "avuz-content--board-list", inside: ".board-list" },
		{ container: ".v-popper__inner .filter", marker: "avuz-filter--items", inside: ":scope > .filter--item" },
	];
	const WATCHED = [...new Set(MARKERS.map(({ inside }) => inside.replace(":scope > ", "")).concat(".modal-mask"))].join(", ");

	function refresh() {
		for (const { container, marker, inside } of MARKERS) {
			document.querySelectorAll(container).forEach((element) => {
				element.classList.toggle(marker, element.querySelector(inside) !== null);
			});
		}
		document.documentElement.classList.toggle("avuz-board-sidebar-open", document.querySelector(".app-deck #app-sidebar-vue.avuz-sidebar--board") !== null);
		document.documentElement.classList.toggle("avuz-calendar-editor-open", document.querySelector(".app-calendar .simple-editor-anchor .modal-mask") !== null);
	}

	// Only additions or removals that carry a watched element change a marker;
	// everything else (cards, editor typing) is skipped without touching the page
	const touchesWatched = (nodes) => Array.prototype.some.call(nodes, (node) => node.nodeType === 1
		&& (node.matches(WATCHED) || node.querySelector(WATCHED) !== null || node.matches(MARKERS.map(({ marker }) => `.${marker}`).join(", "))));

	new MutationObserver((records) => {
		if (records.some((record) => touchesWatched(record.addedNodes) || touchesWatched(record.removedNodes))) {
			refresh();
		}
	}).observe(document.documentElement, { childList: true, subtree: true });

	refresh();
})();
