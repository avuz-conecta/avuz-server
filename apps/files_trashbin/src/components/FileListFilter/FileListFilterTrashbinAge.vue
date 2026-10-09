<!--
  - SPDX-FileCopyrightText: 2026 Avuz Conecta
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->
<template>
	<div>
		<NcButton
			alignment="start"
			:pressed="!selectedOption"
			variant="tertiary"
			wide
			@update:pressed="$event && onReset()">
			{{ t('files_trashbin', 'Todos') }}
		</NcButton>
		<NcButton
			v-for="preset of agePresets"
			:key="preset.id"
			alignment="start"
			:pressed="preset === selectedOption"
			variant="tertiary"
			wide
			@update:pressed="$event ? (selectedOption = preset) : onReset()">
			{{ preset.label }}
		</NcButton>
	</div>
</template>

<script setup lang="ts">
import type { ITrashbinAgePreset, TrashbinAgeFilter } from '../../filters/TrashbinAgeFilter.ts'

import { t } from '@nextcloud/l10n'
import { onMounted, onUnmounted, ref, watch } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'

const props = defineProps<{
	filter: TrashbinAgeFilter
}>()

const selectedOption = ref<ITrashbinAgePreset>()
watch(selectedOption, (preset) => {
	props.filter.setPreset(preset ?? undefined)
})

onMounted(() => {
	selectedOption.value = props.filter.preset && agePresets.find((preset) => preset.id === props.filter.preset!.id)
	props.filter.addEventListener('reset', onReset)
})
onUnmounted(() => {
	props.filter.removeEventListener('reset', onReset)
})

/**
 * Handler for resetting the filter ("Todos").
 */
function onReset() {
	selectedOption.value = undefined
}
</script>

<script lang="ts">
/**
 * Available age presets: deleted at least N days ago.
 */
const agePresets: ITrashbinAgePreset[] = [
	{
		id: 'age-15',
		label: t('files_trashbin', '15 dias'),
		minAgeDays: 15,
	},
	{
		id: 'age-30',
		label: t('files_trashbin', '30 dias'),
		minAgeDays: 30,
	},
	{
		id: 'age-45',
		label: t('files_trashbin', '45 dias'),
		minAgeDays: 45,
	},
]
</script>
