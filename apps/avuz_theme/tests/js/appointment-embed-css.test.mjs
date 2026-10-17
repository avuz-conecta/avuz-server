import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const STYLESHEET = readFileSync(fileURLToPath(new URL('../../css/appointment-embed.css', import.meta.url)), 'utf8');
const EMBED_SCOPE = 'html.avuz-embed';
const VIEWPORT_HEIGHT_UNIT = /\d(?:d|s|l)?vh\b/;

/** Every selector of every style rule, @media blocks included. */
function selectorsOf(css) {
	const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
	const preludes = [...withoutComments.matchAll(/([^{}]+)\{/g)].map((match) => match[1].trim());
	return preludes
		.filter((prelude) => !prelude.startsWith('@'))
		.flatMap((prelude) => prelude.split(','))
		.map((selector) => selector.trim());
}

function declarationsOf(css) {
	return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

describe('appointment-embed.css', () => {
	it('scopes every selector to html.avuz-embed', () => {
		const unscoped = selectorsOf(STYLESHEET).filter((selector) => !selector.startsWith(EMBED_SCOPE));

		assert.deepEqual(unscoped, []);
	});

	it('has rules', () => {
		assert.ok(selectorsOf(STYLESHEET).length > 50);
	});

	it('never sizes anything from the viewport height', () => {
		assert.doesNotMatch(declarationsOf(STYLESHEET), VIEWPORT_HEIGHT_UNIT);
	});
});
