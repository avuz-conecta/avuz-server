import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const readStylesheet = (name) => readFileSync(fileURLToPath(new URL(`../../css/${name}`, import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const CALENDAR = readStylesheet('calendar.css');
const RAIL = readStylesheet('left-rail.css');
const RAIL_MEDIA = '@media (min-width: 1024px)';

/* Calendar 6.2 with its new-event editor open, as rendered on staging (core 33.0.8);
   js/app-scope.js marks the page while the editor is open */
const { window } = new JSDOM(`<html class="avuz-calendar-editor-open"><body id="body-user">
	<header id="header"><div class="header-start"></div><div class="header-end"></div></header>
	<div id="content-vue" class="content app-calendar">
		<div class="simple-editor-anchor"><div>
			<div class="modal-mask"></div>
			<div><div class="event-popover"><div class="event-popover__inner edit-simple"></div></div></div>
		</div></div>
	</div>
</body>`);
const element = (selector) => window.document.querySelector(selector);

/** Declarations, inside the rail media query, of every rule whose selector matches `target`. */
function railDeclarationsFor(css, target) {
	const railRules = css.slice(css.indexOf(RAIL_MEDIA));
	return [...railRules.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
		.filter((rule) => rule[1].split(/,(?![^(]*\))/).some((selector) => {
			try {
				return target.matches(selector.trim());
			} catch {
				return false;
			}
		}))
		.map((rule) => rule[2].replace(/\s+/g, ' '))
		.join(' ');
}

describe('Agenda: novo evento (editor simples) ao lado da barra lateral', () => {
	it('dims the whole screen, from the top edge, as there is no top bar above it', () => {
		const mask = railDeclarationsFor(CALENDAR, element('.modal-mask'));
		assert.match(mask, /top: 0 !important;/);
		assert.match(mask, /height: 100% !important;/);
	});

	it('centres the editor on the screen instead of on the calendar grid', () => {
		const popover = railDeclarationsFor(CALENDAR, element('.event-popover'));
		assert.match(popover, /top: 50% !important;/);
		assert.match(popover, /left: 50% !important;/);
		assert.match(popover, /transform: translate\(-50%, -50%\)/);
	});

	it('puts the rail under the dimmed backdrop, so no rail tile stays lit', () => {
		assert.match(railDeclarationsFor(RAIL, element('#header')), /z-index: 0 !important;/);
	});
});

/** Declarations of every calendar.css rule whose selector matches `target`, in source order. */
function calendarDeclarationsFor(target) {
	return [...CALENDAR.matchAll(/([^{}@]+)\{([^{}]*)\}/g)]
		.filter((rule) => rule[1].split(/,(?![^(]*\))/).some((selector) => {
			try {
				return target.matches(selector.trim());
			} catch {
				return false;
			}
		}))
		.map((rule) => rule[2].replace(/\s+/g, ' '))
		.join(' ');
}

/* Week view event as Calendar 6.2 renders an invite awaiting an answer:
   inline calendar colour on the border, white fill, light text from a dark calendar */
const invite = new JSDOM(`<div class="app-calendar"><div class="fc">
	<a class="fc-event fc-v-event fc-event-nc-needs-action" style="border-color: #3b7ea1; background: #fff">
		<div class="fc-event-main" style="color: #fff">
			<div class="fc-event-time">10:00 - 11:00</div>
			<div class="fc-event-title">teste</div>
		</div>
	</a>
	<a class="fc-event fc-daygrid-dot-event fc-event-nc-needs-action"><div class="fc-daygrid-event-dot"></div></a>
</div></div>`).window.document;

describe('Agenda: convite ainda sem resposta', () => {
	it('keeps the calendar-colour outline Calendar draws around the white event', () => {
		const declarations = calendarDeclarationsFor(invite.querySelector('.fc-v-event'));
		assert.doesNotMatch(declarations, /border: 0/);
		assert.match(declarations, /border-width: 2px !important; border-style: solid !important;/);
	});

	it('writes title and time in dark ink, whatever the calendar colour', () => {
		for (const selector of ['.fc-event-title', '.fc-event-time']) {
			const declarations = calendarDeclarationsFor(invite.querySelector(selector));
			assert.match(declarations.split('color: inherit !important;').at(-1), /color: var\(--avuz-ink\) !important;/);
		}
	});

	it('draws the month-view dot as a hollow ring', () => {
		const declarations = calendarDeclarationsFor(invite.querySelector('.fc-daygrid-event-dot'));
		assert.match(declarations.split('border-width: 4px !important;').at(-1), /border-width: 2px !important;/);
	});
});
