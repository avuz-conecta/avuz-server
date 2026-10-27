import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const SCRIPT = readFileSync(fileURLToPath(new URL('../../js/left-rail-model.js', import.meta.url)), 'utf8');
const ITEM_HEIGHT = 44;

/** Runs the script like the browser does and returns what it exposes. */
function loadRailModel() {
	const window = {};
	vm.runInNewContext(SCRIPT, { window });
	return window.AvuzLeftRail;
}

const { splitApps } = loadRailModel();

function apps(...ids) {
	return ids.map((id) => ({ id, name: id, active: false }));
}

function withActive(entries, activeId) {
	return entries.map((entry) => ({ ...entry, active: entry.id === activeId }));
}

/** App ids as an array of this realm (the script's arrays come from the vm context). */
const ids = (entries) => Array.from(entries, (entry) => entry.id);

describe('splitApps', () => {
	describe('when every app fits', () => {
		it('shows all apps in order and nothing behind "Mais aplicativos"', () => {
			const { visible, overflow } = splitApps(apps('dashboard', 'files', 'deck'), 3 * ITEM_HEIGHT, ITEM_HEIGHT);

			assert.deepEqual(ids(visible), ['dashboard', 'files', 'deck']);
			assert.deepEqual(ids(overflow), []);
		});
	});

	describe('when the apps outgrow the rail', () => {
		it('keeps one slot for "Mais aplicativos" and moves the rest there', () => {
			const { visible, overflow } = splitApps(apps('a', 'b', 'c', 'd', 'e'), 3 * ITEM_HEIGHT, ITEM_HEIGHT);

			assert.deepEqual(ids(visible), ['a', 'b']);
			assert.deepEqual(ids(overflow), ['c', 'd', 'e']);
		});

		it('ignores a partial slot', () => {
			const { visible } = splitApps(apps('a', 'b', 'c', 'd', 'e'), 3 * ITEM_HEIGHT + ITEM_HEIGHT / 2, ITEM_HEIGHT);

			assert.deepEqual(ids(visible), ['a', 'b']);
		});

		it('keeps the active app visible in the last visible slot', () => {
			const { visible, overflow } = splitApps(withActive(apps('a', 'b', 'c', 'd', 'e'), 'd'), 3 * ITEM_HEIGHT, ITEM_HEIGHT);

			assert.deepEqual(ids(visible), ['a', 'd']);
			assert.deepEqual(ids(overflow), ['b', 'c', 'e']);
		});

		it('leaves the order alone when the active app is already visible', () => {
			const { visible, overflow } = splitApps(withActive(apps('a', 'b', 'c', 'd'), 'a'), 3 * ITEM_HEIGHT, ITEM_HEIGHT);

			assert.deepEqual(ids(visible), ['a', 'b']);
			assert.deepEqual(ids(overflow), ['c', 'd']);
		});

		it('moves every app behind "Mais aplicativos" when only that slot fits', () => {
			const { visible, overflow } = splitApps(apps('a', 'b'), ITEM_HEIGHT, ITEM_HEIGHT);

			assert.deepEqual(ids(visible), []);
			assert.deepEqual(ids(overflow), ['a', 'b']);
		});
	});

	describe('with nothing to show', () => {
		it('returns empty lists for no apps', () => {
			const { visible, overflow } = splitApps([], 10 * ITEM_HEIGHT, ITEM_HEIGHT);

			assert.deepEqual([ids(visible), ids(overflow)], [[], []]);
		});

		it('keeps every app reachable behind "Mais aplicativos" when the rail has no room', () => {
			const { visible, overflow } = splitApps(apps('a'), 0, ITEM_HEIGHT);

			assert.deepEqual([ids(visible), ids(overflow)], [[], ['a']]);
		});
	});
});
