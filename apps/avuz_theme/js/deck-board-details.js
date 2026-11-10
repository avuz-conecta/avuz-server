/**
 * Deck (Tarefas): close the board details modal on outside click
 *
 * css/deck-board-details.css shows the board details sidebar as a centered
 * window. Deck itself only closes it from its X button, so a click on the
 * dimmed area around the window presses that button.
 */
(function () {
	"use strict";

	function boardDetails() {
		const sidebar = document.querySelector(".app-deck #app-sidebar-vue");
		return sidebar && sidebar.querySelector("#tab-sharing") ? sidebar : null;
	}

	document.addEventListener(
		"pointerdown",
		(event) => {
			const sidebar = boardDetails();
			if (!sidebar || event.button !== 0 || sidebar.contains(event.target)) {
				return;
			}
			// Popovers/menus opened from inside the window are teleported to
			// <body>; clicking them must not close the window.
			if (event.target.closest(".v-popper__popper, .vs__dropdown-menu, [role='dialog'], .modal-mask")) {
				return;
			}
			const close = sidebar.querySelector(".app-sidebar__close");
			if (close) {
				event.preventDefault();
				event.stopPropagation();
				close.click();
			}
		},
		true,
	);
})();

/* Card modal: the label / people selects open their list in <body>, placed
   under the select itself, which starts after the field's icon. Line the list
   up with the whole field box (css/deck-board-details.css .avuz-card-dd). */
(function () {
	"use strict";

	function place(menu) {
		const select = document.querySelector(`#tab-details .selector-wrapper [aria-controls="${CSS.escape(menu.id)}"]`);
		const box = select?.closest(".selector-wrapper");
		if (!box) {
			return;
		}
		menu.classList.add("avuz-card-dd");
		// NcSelect keeps rewriting left/top/width inline while it is open, so
		// the position goes through CSS variables used with !important
		const r = box.getBoundingClientRect();
		const below = window.innerHeight - r.bottom;
		const up = below < 240 && r.top > below;
		menu.classList.toggle("avuz-card-dd--up", up);
		menu.style.setProperty("--avuz-dd-left", r.left + "px");
		menu.style.setProperty("--avuz-dd-width", r.width + "px");
		menu.style.setProperty("--avuz-dd-top", (r.bottom + 6) + "px");
		menu.style.setProperty("--avuz-dd-bottom", (window.innerHeight - r.top + 6) + "px");
	}

	const update = () => document.querySelectorAll("body > .vs__dropdown-menu").forEach(place);
	new MutationObserver((records) => {
		if (records.some((r) => [...r.addedNodes].some((n) => n.classList?.contains("vs__dropdown-menu")))) {
			update();
		}
	}).observe(document.body, { childList: true });
	window.addEventListener("scroll", update, true);
	window.addEventListener("resize", update);
})();
