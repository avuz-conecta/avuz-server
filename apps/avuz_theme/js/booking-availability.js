/**
 * Appointment booking page: gray out days the visitor cannot actually book.
 *
 * The bundled calendar date picker only disables past days and days outside the
 * config `start`/`end` window. It ignores `futureLimit` (how far ahead bookings
 * are allowed) and the weekday `availability` schedule, so every future day
 * looks selectable even when it has no availability. This reads the booking
 * config already injected into the page and disables the days that fall beyond
 * the future limit or land on a weekday with no availability, so the green
 * "available" highlight (theme.css) only marks truly bookable days.
 *
 * Pure DOM enhancement: no extra requests, all data comes from the page config.
 */
(function bookingAvailability() {
	'use strict';

	var CONFIG_ELEMENT_ID = 'initial-state-calendar-config';
	var WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
	var UNAVAILABLE_CLASS = 'avuz-unavailable';
	var DISABLED_CLASS = 'disabled';
	var CELL_SELECTOR = '.mx-datepicker td.cell[title]';
	var TABLE_SELECTOR = '.mx-datepicker .mx-calendar-content';

	var configElement = document.getElementById(CONFIG_ELEMENT_ID);
	if (!configElement) {
		return;
	}

	var config = parseConfig(configElement.value);
	if (!config) {
		return;
	}

	var futureLimitSeconds = typeof config.futureLimit === 'number' ? config.futureLimit : null;
	var weekdaySlots = config.availability && config.availability.slots ? config.availability.slots : null;
	if (futureLimitSeconds === null && !weekdaySlots) {
		return;
	}

	var maxBookableDay = futureLimitSeconds === null
		? null
		: toDayString(new Date(Date.now() + futureLimitSeconds * 1000));

	function parseConfig(encoded) {
		try {
			return JSON.parse(atob(encoded));
		} catch (error) {
			return null;
		}
	}

	function toDayString(date) {
		var year = date.getFullYear();
		var month = String(date.getMonth() + 1).padStart(2, '0');
		var day = String(date.getDate()).padStart(2, '0');
		return year + '-' + month + '-' + day;
	}

	function weekdayHasNoAvailability(dayString) {
		if (!weekdaySlots) {
			return false;
		}
		var weekday = WEEKDAYS[new Date(dayString + 'T00:00:00').getDay()];
		var slots = weekdaySlots[weekday];
		return !slots || slots.length === 0;
	}

	function isBeyondFutureLimit(dayString) {
		return maxBookableDay !== null && dayString > maxBookableDay;
	}

	function markCells() {
		var cells = document.querySelectorAll(CELL_SELECTOR);
		cells.forEach(function markCell(cell) {
			if (cell.classList.contains('active')) {
				return;
			}
			var dayString = cell.getAttribute('title');
			if (!dayString) {
				return;
			}
			if (isBeyondFutureLimit(dayString) || weekdayHasNoAvailability(dayString)) {
				cell.classList.add(UNAVAILABLE_CLASS, DISABLED_CLASS);
			}
		});
	}

	function observeTable(table) {
		// The picker reuses the same cell nodes across month navigation, only
		// rewriting their `title`/`class`, so watch attributes and text too.
		var OBSERVE_OPTIONS = {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ['title', 'class'],
			characterData: true,
		};
		var observer = new MutationObserver(function onMutation() {
			observer.disconnect();
			markCells();
			observer.observe(table, OBSERVE_OPTIONS);
		});
		markCells();
		observer.observe(table, OBSERVE_OPTIONS);
	}

	function waitForTable() {
		var table = document.querySelector(TABLE_SELECTOR);
		if (table) {
			observeTable(table);
			return;
		}
		var bodyObserver = new MutationObserver(function onBody() {
			var readyTable = document.querySelector(TABLE_SELECTOR);
			if (readyTable) {
				bodyObserver.disconnect();
				observeTable(readyTable);
			}
		});
		bodyObserver.observe(document.body, { childList: true, subtree: true });
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', waitForTable);
	} else {
		waitForTable();
	}
})();
