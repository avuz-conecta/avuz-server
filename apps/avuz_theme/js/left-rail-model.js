/**
 * Left rail logic without the DOM, shared with js/left-rail.js through
 * window.AvuzLeftRail (a classic script, so it rides the server's ?v= cache
 * buster like every other avuz_theme script).
 *
 * splitApps decides which app entries (core/apps initial state, already in
 * the user's order) fit the rail's height and which go behind
 * "Mais aplicativos". That entry takes one slot whenever anything overflows.
 * The active app always stays visible: it takes the last visible slot.
 */
(function leftRailModel() {
	'use strict';

	function slotsFor(availableHeight, itemHeight) {
		if (itemHeight <= 0) {
			return 0;
		}
		return Math.max(0, Math.floor(availableHeight / itemHeight));
	}

	function splitApps(apps, availableHeight, itemHeight) {
		var slots = slotsFor(availableHeight, itemHeight);
		if (apps.length <= slots) {
			return { visible: apps.slice(), overflow: [] };
		}

		var visibleCount = Math.max(0, slots - 1);
		var activeIndex = apps.findIndex(function (app) { return app.active; });
		var activeOverflows = activeIndex >= visibleCount && visibleCount > 0;
		if (!activeOverflows) {
			return { visible: apps.slice(0, visibleCount), overflow: apps.slice(visibleCount) };
		}

		var active = apps[activeIndex];
		var others = apps.filter(function (app) { return app !== active; });
		return {
			visible: others.slice(0, visibleCount - 1).concat([active]),
			overflow: others.slice(visibleCount - 1),
		};
	}

	window.AvuzLeftRail = Object.freeze({ splitApps: splitApps });
}());
