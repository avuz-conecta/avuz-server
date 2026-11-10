/**
 * Calendar (css/calendar.css):
 * - expose each calendar's colour (Calendar paints it into the SVG fill of the
 *   checkbox icon) as --avuz-cal-color, for the round colour toggles;
 * - show the current period ("outubro 2026", "Semana 43 de 2026") as a title
 *   in the bar above the grid (.avuz-cal-title), copied from the menu's
 *   date picker label.
 */
(function () {
	"use strict";

	if (!/\/apps\/calendar(\/|$)/.test(location.pathname)) {
		return;
	}

	let queued = false;
	function apply() {
		queued = false;
		const wrapper = document.querySelector(".app-calendar .calendar-wrapper");
		const label = document.querySelector(".app-calendar .datepicker-button-section__datepicker-label")?.textContent.trim();
		if (wrapper) {
			let title = wrapper.querySelector(":scope > .avuz-cal-title");
			if (!title) {
				title = document.createElement("div");
				title.className = "avuz-cal-title";
				title.setAttribute("aria-hidden", "true");
				wrapper.prepend(title);
			}
			if (label && title.textContent !== label) {
				title.textContent = label;
			}
		}
		document.querySelectorAll(".app-calendar .draggable-calendar-list-item .app-navigation-entry-icon .material-design-icon").forEach((icon) => {
			const fill = icon.querySelector("svg")?.getAttribute("fill");
			if (fill && fill !== "currentColor" && icon.style.getPropertyValue("--avuz-cal-color") !== fill) {
				icon.style.setProperty("--avuz-cal-color", fill);
			}
		});
	}

	new MutationObserver((records) => {
		if (records.every((r) => r.target.closest?.(".avuz-cal-title") || [...r.addedNodes].every((n) => n.classList?.contains("avuz-cal-title")) && r.type === "childList" && r.removedNodes.length === 0)) {
			return;
		}
		if (!queued) {
			queued = true;
			requestAnimationFrame(apply);
		}
	}).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["fill"] });
	apply();
})();
