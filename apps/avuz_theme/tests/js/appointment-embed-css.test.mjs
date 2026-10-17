import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const STYLESHEET = readFileSync(fileURLToPath(new URL('../../css/appointment-embed.css', import.meta.url)), 'utf8');
const PREHIDE_STYLESHEET = readFileSync(fileURLToPath(new URL('../../css/appointment-embed-prehide.css', import.meta.url)), 'utf8');
const EMBED_SCOPE = 'html.avuz-embed';
const PREHIDE_SCOPE = 'html:not(.avuz-embed-checked)';
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

/** Declarations of the rule whose selector is exactly `selector`. */
function ruleBody(css, selector) {
	const rules = [...declarationsOf(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)];
	const rule = rules.find((match) => match[1].trim() === selector);
	return rule ? rule[2] : '';
}

/** Selectors outside @keyframes blocks (their from/to steps are not selectors). */
function prehideSelectorsOf(css) {
	return selectorsOf(declarationsOf(css).replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, ''));
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

describe('appointment-embed-prehide.css', () => {
	it('scopes every selector to the unchecked page', () => {
		const unscoped = prehideSelectorsOf(PREHIDE_STYLESHEET).filter((selector) => !selector.startsWith(PREHIDE_SCOPE));

		assert.deepEqual(unscoped, []);
	});

	it('hides the body until the check ran', () => {
		assert.match(ruleBody(PREHIDE_STYLESHEET, `${PREHIDE_SCOPE} body`), /visibility:\s*hidden;/);
	});

	describe('root background (paints the canvas, which a hidden body does not cover)', () => {
		it('paints the root white until the check ran', () => {
			assert.match(ruleBody(PREHIDE_STYLESHEET, PREHIDE_SCOPE), /background-color:\s*#fff;/);
		});

		it('keeps it overridable, so the fallback reveal can hand the canvas back', () => {
			assert.doesNotMatch(ruleBody(PREHIDE_STYLESHEET, PREHIDE_SCOPE), /!important/);
		});
	});

	it('reveals the body and the canvas after a few seconds should the script never run', () => {
		assert.match(ruleBody(PREHIDE_STYLESHEET, `${PREHIDE_SCOPE} body`), /animation:\s*avuz-embed-reveal 0s 3s forwards;/);
		assert.match(ruleBody(PREHIDE_STYLESHEET, PREHIDE_SCOPE), /animation:\s*avuz-embed-reveal-canvas 0s 3s forwards;/);
		assert.match(PREHIDE_STYLESHEET, /@keyframes avuz-embed-reveal-canvas\s*\{\s*to\s*\{\s*background-color:\s*transparent;/);
	});

	it('never sizes anything from the viewport height', () => {
		assert.doesNotMatch(declarationsOf(PREHIDE_STYLESHEET), VIEWPORT_HEIGHT_UNIT);
	});
});
