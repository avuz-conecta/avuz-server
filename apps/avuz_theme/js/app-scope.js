/**
 * Markers the theme's stylesheets scope by, instead of :has().
 *
 * Rules like `body:has(.app-deck) …` or `#app-sidebar-vue:has(#tab-button-details) …`
 * made Chrome restyle the whole page on every DOM change: on a 360-card Tarefas
 * board a card took ~11 s to open and close (0.5 s without them). The same
 * scopes as plain selectors cost nothing:
 *
 * - html[data-avuz-app="deck"]: the open app, from the address
 * - #app-sidebar-vue[data-avuz-sidebar="card" | "board"]: a Tarefas card or board panel
 * - html.avuz-board-sidebar-open: the board panel is open
 * - html.avuz-calendar-editor-open: Calendar's new-event editor (and its backdrop) is open
 * - #app-content-vue[data-avuz-content="board-list"]: "Todos os painéis"
 * - .filter[data-avuz-filter="items"]: the board filter popover
 *
 * Attributes, not classes: Vue rewrites the class of the elements it renders.
 */
(function () {
	"use strict";

	const APP_IN_PATH = /\/apps\/([a-z0-9_]+)/;
	const app = window.location.pathname.match(APP_IN_PATH)?.[1];
	if (app) {
		document.documentElement.dataset.avuzApp = app;
	}

	// container, the data attribute it gets (value by what is inside it)
	const MARKERS = [
		{ container: "#app-sidebar-vue", attribute: "avuzSidebar", values: [["card", "#tab-button-details"], ["board", "#tab-sharing"]] },
		{ container: "#app-content-vue", attribute: "avuzContent", values: [["board-list", ".board-list"]] },
		{ container: ".v-popper__inner .filter", attribute: "avuzFilter", values: [["items", ":scope > .filter--item"]] },
	];
	const WATCHED = [...new Set(MARKERS.flatMap(({ values }) => values.map(([, inside]) => inside.replace(":scope > ", ""))).concat(".modal-mask"))].join(", ");
	const MARKED = MARKERS.map(({ attribute }) => `[data-${attribute.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}]`).join(", ");

	function refresh() {
		for (const { container, attribute, values } of MARKERS) {
			document.querySelectorAll(container).forEach((element) => {
				const value = values.find(([, inside]) => element.querySelector(inside) !== null)?.[0];
				if (value === undefined) {
					delete element.dataset[attribute];
					return;
				}
				element.dataset[attribute] = value;
			});
		}
		document.documentElement.classList.toggle("avuz-board-sidebar-open", document.querySelector('.app-deck #app-sidebar-vue[data-avuz-sidebar="board"]') !== null);
		document.documentElement.classList.toggle("avuz-calendar-editor-open", document.querySelector(".app-calendar .simple-editor-anchor .modal-mask") !== null);
	}

	// Only additions or removals that carry a watched element change a marker;
	// everything else (cards, editor typing) is skipped without touching the page
	const touchesWatched = (nodes) => Array.prototype.some.call(nodes, (node) => node.nodeType === 1
		&& (node.matches(WATCHED) || node.querySelector(WATCHED) !== null || node.matches(MARKED)));

	new MutationObserver((records) => {
		if (records.some((record) => touchesWatched(record.addedNodes) || touchesWatched(record.removedNodes))) {
			refresh();
		}
	}).observe(document.documentElement, { childList: true, subtree: true });

	refresh();
})();
