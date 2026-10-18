/**
 * SPDX-FileCopyrightText: 2026 Avuz Conecta
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { INode } from '@nextcloud/files'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const activeViewId = { current: 'trashbin' }

vi.mock('../components/FileListFilter/FileListFilterTrashbinAge.vue', () => ({ default: {} }))
vi.mock('../files_views/trashbinView.ts', () => ({ TRASHBIN_VIEW_ID: 'trashbin' }))
vi.mock('@nextcloud/files', async (importOriginal) => ({
	...(await importOriginal<typeof import('@nextcloud/files')>()),
	getNavigation: () => ({ active: { id: activeViewId.current } }),
}))

const { TrashbinAgeFilter } = await import('./TrashbinAgeFilter.ts')

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-10-08T12:00:00Z')

/**
 * Build a trashbin node deleted `daysAgo` days before NOW.
 *
 * @param id Unique identifier used as the node name
 * @param daysAgo Age of the deletion in days
 * @param useMtime Store the deletion time in `mtime` instead of the attribute
 */
function nodeDeletedDaysAgo(id: string, daysAgo: number, useMtime = false): INode {
	const deletedAtMs = NOW.getTime() - daysAgo * MILLISECONDS_PER_DAY
	if (useMtime) {
		return { name: id, mtime: new Date(deletedAtMs), attributes: {} } as unknown as INode
	}
	return { name: id, attributes: { 'trashbin-deletion-time': Math.floor(deletedAtMs / 1000) } } as unknown as INode
}

describe('files_trashbin: TrashbinAgeFilter', () => {
	beforeEach(() => {
		activeViewId.current = 'trashbin'
		vi.useFakeTimers()
		vi.setSystemTime(NOW)
	})
	afterEach(() => {
		vi.useRealTimers()
	})

	it('returns every node when no preset is selected', () => {
		const filter = new TrashbinAgeFilter()
		const nodes = [nodeDeletedDaysAgo('a', 1), nodeDeletedDaysAgo('b', 100)]
		expect(filter.filter(nodes)).toHaveLength(2)
	})

	it('returns every node for the "Todos" preset (minAgeDays null)', () => {
		const filter = new TrashbinAgeFilter()
		filter.setPreset({ id: 'todos', label: 'Todos', minAgeDays: null })
		const nodes = [nodeDeletedDaysAgo('a', 1), nodeDeletedDaysAgo('b', 100)]
		expect(filter.filter(nodes)).toHaveLength(2)
	})

	it('keeps only nodes deleted at least 15 days ago', () => {
		const filter = new TrashbinAgeFilter()
		filter.setPreset({ id: 'age-15', label: '15 dias', minAgeDays: 15 })
		const kept = filter.filter([
			nodeDeletedDaysAgo('fresh', 10),
			nodeDeletedDaysAgo('edge', 15),
			nodeDeletedDaysAgo('old', 40),
		])
		expect(kept.map((node) => node.name)).toEqual(['edge', 'old'])
	})

	it('narrows the set as the age threshold grows (30, 45 dias)', () => {
		const nodes = [
			nodeDeletedDaysAgo('d20', 20),
			nodeDeletedDaysAgo('d35', 35),
			nodeDeletedDaysAgo('d50', 50),
		]

		const filter30 = new TrashbinAgeFilter()
		filter30.setPreset({ id: 'age-30', label: '30 dias', minAgeDays: 30 })
		expect(filter30.filter(nodes).map((node) => node.name)).toEqual(['d35', 'd50'])

		const filter45 = new TrashbinAgeFilter()
		filter45.setPreset({ id: 'age-45', label: '45 dias', minAgeDays: 45 })
		expect(filter45.filter(nodes).map((node) => node.name)).toEqual(['d50'])
	})

	it('falls back to mtime when the deletion-time attribute is missing', () => {
		const filter = new TrashbinAgeFilter()
		filter.setPreset({ id: 'age-30', label: '30 dias', minAgeDays: 30 })
		const kept = filter.filter([
			nodeDeletedDaysAgo('fresh', 10, true),
			nodeDeletedDaysAgo('old', 40, true),
		])
		expect(kept.map((node) => node.name)).toEqual(['old'])
	})

	it('labels the active chip with the selected age', () => {
		const filter = new TrashbinAgeFilter()
		const updateChips = vi.spyOn(filter, 'updateChips')
		filter.setPreset({ id: 'age-15', label: '15 dias', minAgeDays: 15 })
		expect(updateChips).toHaveBeenLastCalledWith([
			expect.objectContaining({ text: 'Excluído há 15 dias' }),
		])
	})

	it('clears the chips for the "Todos" preset', () => {
		const filter = new TrashbinAgeFilter()
		const updateChips = vi.spyOn(filter, 'updateChips')
		filter.setPreset({ id: 'todos', label: 'Todos', minAgeDays: null })
		expect(updateChips).toHaveBeenLastCalledWith([])
	})

	it('no-ops outside the trashbin view', () => {
		activeViewId.current = 'files'
		const filter = new TrashbinAgeFilter()
		filter.setPreset({ id: 'age-30', label: '30 dias', minAgeDays: 30 })
		const nodes = [nodeDeletedDaysAgo('fresh', 1), nodeDeletedDaysAgo('old', 99)]
		expect(filter.filter(nodes)).toHaveLength(2)
	})
})
