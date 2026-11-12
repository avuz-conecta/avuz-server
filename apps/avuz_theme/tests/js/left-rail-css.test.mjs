import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const STYLESHEET_DIRECTORY = new URL('../../css/', import.meta.url);
const STYLESHEET = readFileSync(fileURLToPath(new URL('left-rail.css', STYLESHEET_DIRECTORY)), 'utf8');
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

	it('keeps the rail icons only, 72px wide, with no wider state', () => {
		const railRules = topLevelBlocks(STYLESHEET).find((block) => block.prelude === RAIL_MEDIA).body;

		assert.deepEqual([...railRules.matchAll(/--avuz-rail-width:\s*([^;]+);/g)].map((match) => match[1]), ['72px']);
	});

	it('lays out settings pages like app pages (core renders them as body#body-settings)', () => {
		const railRules = topLevelBlocks(STYLESHEET).find((block) => block.prelude === RAIL_MEDIA).body;
		const selectors = selectorsIn(railRules);
		const appPageOnly = selectors.filter((selector) => selector.includes('#body-user') && !selector.includes('#body-settings'));

		assert.ok(selectors.some((selector) => selector.includes('#body-user')));
		assert.deepEqual(appPageOnly, []);
	});

	it('draws Material foot icons only once the rail script provided them', () => {
		const railRules = topLevelBlocks(STYLESHEET).find((block) => block.prelude === RAIL_MEDIA).body;
		const footSelectors = selectorsIn(railRules).filter((selector) => /#unified-search|#notifications/.test(selector));

		assert.ok(footSelectors.length > 0);
		assert.deepEqual(footSelectors.filter((selector) => !selector.startsWith('html.avuz-rail--material-foot ')), []);
	});

	describe('tooltip', () => {
		const railRules = () => topLevelBlocks(STYLESHEET).find((block) => block.prelude === RAIL_MEDIA).body;
		const tooltipSelector = () => selectorsIn(railRules()).find((selector) => selector.endsWith(':is(:hover, :focus-visible) .avuz-rail__label'));

		it('shows the app name on hover and keyboard focus, with no transition delay', () => {
			assert.ok(tooltipSelector());
			assert.doesNotMatch(railRules(), /transition/);
		});

		it('stays hidden while "Mais aplicativos" is open and after Escape', () => {
			assert.match(tooltipSelector(), /^#avuz-rail:not\(\.avuz-rail--tooltip-dismissed\) /);
			assert.match(tooltipSelector(), /\.avuz-rail__app:not\(\[aria-expanded='true'\]\)/);
		});

		it('is not clipped by the app list, which clips only vertically', () => {
			assert.match(railRules(), /\.avuz-rail__apps\s*\{[^}]*overflow-x:\s*visible;\s*overflow-y:\s*clip;/);
		});
	});

	describe('OnlyOffice editor in its own tab', () => {
		const editorFrameRule = () => topLevelBlocks(topLevelBlocks(STYLESHEET).find((block) => block.prelude === RAIL_MEDIA).body)
			.find((block) => block.prelude.endsWith('> #content.app-onlyoffice #app > iframe'));

		it('fills the content box beside the rail instead of the viewport under a 50px top bar', () => {
			const declarations = editorFrameRule().body.replace(/\s+/g, ' ');

			assert.match(declarations, /position: absolute !important;/);
			assert.match(declarations, /inset: 0 !important;/);
			assert.match(declarations, /width: 100% !important;/);
			assert.match(declarations, /height: 100% !important;/);
			assert.match(declarations, /margin: 0 !important;/);
		});
	});

	it('is the only stylesheet that lays out the header and the page beside it on wide screens', () => {
		const otherStylesheets = readdirSync(STYLESHEET_DIRECTORY).filter((file) => file.endsWith('.css') && file !== 'left-rail.css');
		const wideScreenRailSelectors = otherStylesheets.flatMap((file) => topLevelBlocks(readFileSync(new URL(file, STYLESHEET_DIRECTORY), 'utf8'))
			.filter((block) => /^@media\b.*min-width/.test(block.prelude))
			.flatMap((block) => selectorsIn(block.body))
			.filter((selector) => /#header|\.header-end|#content/.test(selector))
			.map((selector) => `${file}: ${selector}`));

		assert.deepEqual(wideScreenRailSelectors, []);
	});

	describe('pesquisa no aplicativo atual (Tarefas)', () => {
		const railRules = () => topLevelBlocks(STYLESHEET).find((block) => block.prelude === RAIL_MEDIA).body;
		const declarationsFor = (selectorPart) => topLevelBlocks(railRules())
			.filter((block) => block.prelude.includes(selectorPart))
			.map((block) => block.body.replace(/\s+/g, ' '))
			.join(' ');

		it('opens as a floating panel beside the rail, where the notifications panel opens', () => {
			const panel = declarationsFor('.local-unified-search--open');
			assert.match(panel, /position: fixed !important;/);
			assert.match(panel, /left: calc\(var\(--avuz-rail-width\) \+ var\(--avuz-rail-gap\)\) !important;/);
			assert.match(panel, /bottom: var\(--body-container-margin\) !important;/);
			assert.match(panel, /box-shadow:/);
		});

		it('keeps the search icon in its place on the rail while the panel is open', () => {
			assert.match(declarationsFor(':has(.local-unified-search--open) > .header-menu'), /display: flex !important;/);
		});

		it('puts "Pesquisar em qualquer lugar" on its own row instead of over the field', () => {
			assert.match(declarationsFor('.local-unified-search__global-search'), /position: static !important;/);
		});
	});

	it('keeps a hidden "Mais aplicativos" list hidden despite its flex layout', () => {
		const railRules = topLevelBlocks(STYLESHEET).find((block) => block.prelude === RAIL_MEDIA).body;

		assert.match(railRules, /\.avuz-rail__overflow\[hidden\]\s*\{\s*display:\s*none;/);
	});
});
