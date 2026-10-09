/*!
 * SPDX-FileCopyrightText: 2026 Avuz Conecta
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import type { IFileListFilterChip, IFileListFilterWithUi, INode } from '@nextcloud/files'

import svgHistory from '@mdi/svg/svg/history.svg?raw'
import { FileListFilter, getNavigation, registerFileListFilter, unregisterFileListFilter } from '@nextcloud/files'
import { t } from '@nextcloud/l10n'
import { defineCustomElement } from 'vue'
import { TRASHBIN_VIEW_ID } from '../files_views/trashbinView.ts'
import FileListFilterTrashbinAge from '../components/FileListFilter/FileListFilterTrashbinAge.vue'

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000

export interface ITrashbinAgePreset {
	id: string
	label: string
	/** Minimum age in days; a node matches when it was deleted at least this many days ago. `null` clears the filter ("Todos"). */
	minAgeDays: number | null
}

export const TRASHBIN_AGE_FILTER_ID = 'files_trashbin:age'

const tagName = 'files-trashbin-file-list-filter-age'

/**
 * Deletion time of a trashbin node in milliseconds, mirroring the Deleted column:
 * prefer the `trashbin-deletion-time` attribute (unix seconds), fall back to the node mtime.
 *
 * @param node The trashbin node to read the deletion time from
 */
function deletionTimeMs(node: INode): number {
	const seconds = Number(node.attributes?.['trashbin-deletion-time']) || ((node.mtime?.getTime() ?? 0) / 1000)
	return seconds * 1000
}

export class TrashbinAgeFilter extends FileListFilter implements IFileListFilterWithUi {
	private currentInstance?: { resetFilter: () => void }
	private currentPreset?: ITrashbinAgePreset

	public readonly displayName = t('files_trashbin', 'Excluído há')
	public readonly iconSvgInline = svgHistory
	public readonly tagName = tagName

	constructor() {
		super(TRASHBIN_AGE_FILTER_ID, 55)
	}

	public filter(nodes: INode[]): INode[] {
		if (!this.currentPreset || this.currentPreset.minAgeDays === null) {
			return nodes
		}

		// No-op outside the trashbin view.
		if (getNavigation().active?.id !== TRASHBIN_VIEW_ID) {
			return nodes
		}

		const cutoff = Date.now() - this.currentPreset.minAgeDays * MILLISECONDS_PER_DAY
		return nodes.filter((node) => deletionTimeMs(node) <= cutoff)
	}

	public reset(): void {
		this.dispatchEvent(new CustomEvent('reset'))
	}

	public get preset() {
		return this.currentPreset
	}

	/**
	 * Let the mounted component register itself so the filter can reset the
	 * component state when its chip is removed (e.g. the active-filters bar).
	 *
	 * @param instance The component exposing a `resetFilter` callback
	 */
	public registerInstance(instance: { resetFilter: () => void }) {
		this.currentInstance = instance
	}

	/**
	 * Drop the registered component instance on unmount.
	 *
	 * @param instance The previously registered component
	 */
	public unregisterInstance(instance: { resetFilter: () => void }) {
		if (this.currentInstance === instance) {
			this.currentInstance = undefined
		}
	}

	public setPreset(preset?: ITrashbinAgePreset) {
		this.currentPreset = preset?.minAgeDays === null ? undefined : preset
		this.filterUpdated()

		const chips: IFileListFilterChip[] = []
		const activePreset = this.currentPreset
		if (activePreset) {
			chips.push({
				icon: svgHistory,
				text: t('files_trashbin', 'Excluído há {days} dias', { days: activePreset.minAgeDays ?? 0 }),
				onclick: () => this.reset(),
			})
		} else {
			this.currentInstance?.resetFilter()
		}
		this.updateChips(chips)
	}
}

let filterInstance: TrashbinAgeFilter | undefined
let elementDefined = false
let registered = false

/**
 * Register the trashbin age filter (defining its web component once).
 * Safe to call repeatedly: it only registers while not already registered.
 */
export function registerTrashbinAgeFilter() {
	if (registered) {
		return
	}

	if (!elementDefined) {
		customElements.define(tagName, defineCustomElement(FileListFilterTrashbinAge, {
			shadowRoot: false,
		}))
		elementDefined = true
	}

	if (!filterInstance) {
		filterInstance = new TrashbinAgeFilter()
	}
	registerFileListFilter(filterInstance)
	registered = true
}

/**
 * Unregister the trashbin age filter, hiding it outside the trashbin view.
 * Safe to call repeatedly: it only unregisters while registered.
 */
export function unregisterTrashbinAgeFilter() {
	if (!registered) {
		return
	}

	filterInstance?.reset()
	unregisterFileListFilter(TRASHBIN_AGE_FILTER_ID)
	registered = false
}
