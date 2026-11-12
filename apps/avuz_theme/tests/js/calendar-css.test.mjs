import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const readStylesheet = (name) => readFileSync(fileURLToPath(new URL(`../../css/${name}`, import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const CALENDAR = readStylesheet('calendar.css');
const RAIL = readStylesheet('left-rail.css');
const RAIL_MEDIA = '@media (min-width: 1024px)';

/** Declarations of every rule whose selector list contains `selector`, inside the rail media query when asked. */
function declarationsFor(css, selector, { insideRailMedia = false } = {}) {
	const scope = insideRailMedia ? css.slice(css.indexOf(RAIL_MEDIA)) : css;
	return [...scope.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
		.filter((match) => match[1].split(/,(?![^(]*\))/).some((part) => part.trim() === selector))
		.map((match) => match[2].replace(/\s+/g, ' ').trim())
		.join(' ');
}

describe('Agenda: novo evento (editor simples) ao lado da barra lateral', () => {
	const MASK = '.app-calendar .simple-editor-anchor > .modal-mask';
	const POPOVER = '.app-calendar .simple-editor-anchor .event-popover';

	it('dims the whole screen, from the top edge, as there is no top bar above it', () => {
		assert.match(declarationsFor(CALENDAR, MASK, { insideRailMedia: true }), /top: 0 !important;/);
		assert.match(declarationsFor(CALENDAR, MASK, { insideRailMedia: true }), /height: 100% !important;/);
	});

	it('centres the editor on the screen instead of on the calendar grid', () => {
		const declarations = declarationsFor(CALENDAR, POPOVER, { insideRailMedia: true });
		assert.match(declarations, /top: 50% !important;/);
		assert.match(declarations, /left: 50% !important;/);
		assert.match(declarations, /transform: translate\(-50%, -50%\)/);
	});

	it('puts the rail under the dimmed backdrop, so no rail tile stays lit', () => {
		assert.match(declarationsFor(RAIL, 'body:is(#body-user, #body-settings):has(.app-calendar .simple-editor-anchor > .modal-mask) #header', { insideRailMedia: true }), /z-index: 0 !important;/);
	});
});
