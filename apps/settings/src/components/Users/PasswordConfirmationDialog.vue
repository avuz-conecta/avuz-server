<!--
  - SPDX-FileCopyrightText: 2026 Avuz Conecta
  - SPDX-License-Identifier: AGPL-3.0-or-later
-->

<template>
	<NcDialog
		:open="open"
		:name="t('settings', 'Confirm new password')"
		is-form
		size="small"
		@submit="onSubmit"
		@update:open="onUpdateOpen">
		<NcPasswordField
			v-model="confirmation"
			data-cy-user-list-input-password-confirmation
			:label="t('settings', 'Confirm new password')"
			:error="mismatch"
			:helper-text="mismatch ? t('settings', 'Passwords do not match.') : ''"
			maxlength="469"
			autocomplete="new-password"
			autocapitalize="off"
			required
			spellcheck="false" />

		<template #actions>
			<NcButton variant="tertiary" @click="onUpdateOpen(false)">
				{{ t('settings', 'Cancel') }}
			</NcButton>
			<NcButton
				data-cy-user-list-submit-password-confirmation
				type="submit"
				variant="primary">
				{{ t('settings', 'Change password') }}
			</NcButton>
		</template>
	</NcDialog>
</template>

<script lang="ts">
import { translate as t } from '@nextcloud/l10n'
import { defineComponent } from 'vue'
import NcButton from '@nextcloud/vue/components/NcButton'
import NcDialog from '@nextcloud/vue/components/NcDialog'
import NcPasswordField from '@nextcloud/vue/components/NcPasswordField'

export default defineComponent({
	name: 'PasswordConfirmationDialog',

	components: {
		NcButton,
		NcDialog,
		NcPasswordField,
	},

	props: {
		password: {
			type: String,
			required: true,
		},

		open: {
			type: Boolean,
			required: true,
		},
	},

	emits: {
		'update:open': (open: boolean) => typeof open === 'boolean',
		confirm: () => true,
	},

	data() {
		return {
			confirmation: '',
		}
	},

	computed: {
		mismatch(): boolean {
			return this.confirmation !== '' && this.confirmation !== this.password
		},
	},

	methods: {
		t,
		onSubmit(): void {
			if (this.confirmation !== this.password) {
				return
			}
			this.$emit('confirm')
			this.onUpdateOpen(false)
		},

		onUpdateOpen(value: boolean): void {
			this.$emit('update:open', value)
		},
	},
})
</script>
