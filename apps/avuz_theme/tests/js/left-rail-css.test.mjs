import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const STYLESHEET = readFileSync(fileURLToPath(new URL('../../css/left-rail.css', import.meta.url)), 'utf8');
const RAIL_MEDIA = '@media (min-width: 1024px)';

/** Top-level blocks of a stylesheet: { prelude, body } for each rule or at-rule. */
function topLevelBlocks(css) {
	const source = css.replace(/\/\*[\s\S]*?\*\//g, '');
	const blocks = [];
	let depth = 0;
	let preludeStart = 0;
	let bodyStart = 0;
	let prelude = '';
	for (let index = 0; index < source.length; index++) {
		const character = source[index];
		if (character === '{') {
			if (depth === 0) {
				prelude = source.slice(preludeStart, index).trim();
				bodyStart = index + 1;
			}
			depth++;
		}
		if (character === '}') {
			depth--;
			if (depth === 0) {
				blocks.push({ prelude, body: source.slice(bodyStart, index) });
				preludeStart = index + 1;
			}
		}
	}
	return blocks;
}

/** Every selector of every rule, including rules nested in at-rules. */
function selectorsIn(css) {
	return topLevelBlocks(css).flatMap((block) => (block.prelude.startsWith('@')
		? selectorsIn(block.body)
		: block.prelude.split(/,(?![^(]*\))/).map((selector) => selector.trim())));
}

describe('left rail stylesheet', () => {
	it('below 1024px only hides the rail, leaving the core header as it is', () => {
		const outsideRailMedia = topLevelBlocks(STYLESHEET).filter((block) => block.prelude !== RAIL_MEDIA);

		assert.deepEqual(outsideRailMedia, [{ prelude: '#avuz-rail', body: '\n\tdisplay: none;\n' }]);
	});

	it('lays out settings pages like app pages (core renders them as body#body-settings)', () => {
		const railRules = topLevelBlocks(STYLESHEET).find((block) => block.prelude === RAIL_MEDIA).body;
		const selectors = selectorsIn(railRules);
		const appPageOnly = selectors.filter((selector) => selector.includes('#body-user') && !selector.includes('#body-settings'));

		assert.ok(selectors.some((selector) => selector.includes('#body-user')));
		assert.deepEqual(appPageOnly, []);
	});

	it('keeps a hidden "Mais aplicativos" list hidden despite its flex layout', () => {
		const railRules = topLevelBlocks(STYLESHEET).find((block) => block.prelude === RAIL_MEDIA).body;

		assert.match(railRules, /\.avuz-rail__overflow\[hidden\]\s*\{\s*display:\s*none;/);
	});
});
