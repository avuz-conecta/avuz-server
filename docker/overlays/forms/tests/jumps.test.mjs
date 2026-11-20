/**
 * SPDX-FileCopyrightText: 2026 Nextcloud GmbH and Nextcloud contributors
 * SPDX-License-Identifier: AGPL-3.0-or-later
 */

// Run: npm run test:jumps (node 24; --experimental-transform-types for the enums of Constants.ts)

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { getVisibleQuestions } from '../../src/utils/Jumps.ts'

const JUMP_PATHS = JSON.parse(
	readFileSync(new URL('../fixtures/jump-paths.json', import.meta.url), 'utf8'),
)

describe('getVisibleQuestions walks the same path as SubmissionService', () => {
	for (const jumpPath of JUMP_PATHS) {
		it(jumpPath.name, () => {
			assert.deepEqual(
				getVisibleQuestions(jumpPath.questions, jumpPath.answers).map(
					(question) => question.id,
				),
				jumpPath.visible,
			)
		})
	}
})
