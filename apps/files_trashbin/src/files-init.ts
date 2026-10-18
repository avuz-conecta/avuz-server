/**
 * SPDX-FileCopyrightText: 2023 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

import { subscribe } from '@nextcloud/event-bus'
import { getNavigation, registerFileAction, registerFileListAction } from '@nextcloud/files'
import { registerTrashbinAgeFilter, unregisterTrashbinAgeFilter } from './filters/TrashbinAgeFilter.ts'
import { restoreAction } from './files_actions/restoreAction.ts'
import { emptyTrashAction } from './files_listActions/emptyTrashAction.ts'
import { TRASHBIN_VIEW_ID, trashbinView } from './files_views/trashbinView.ts'

import './trashbin.scss'

const Navigation = getNavigation()
Navigation.register(trashbinView)

registerFileListAction(emptyTrashAction)
registerFileAction(restoreAction)

/**
 * Show the age filter only while the trashbin view is active.
 *
 * @param viewId The id of the now-active view
 */
function syncTrashbinAgeFilter(viewId?: string) {
	if (viewId === TRASHBIN_VIEW_ID) {
		registerTrashbinAgeFilter()
	} else {
		unregisterTrashbinAgeFilter()
	}
}

syncTrashbinAgeFilter(Navigation.active?.id)
subscribe('files:navigation:changed', () => syncTrashbinAgeFilter(Navigation.active?.id))
