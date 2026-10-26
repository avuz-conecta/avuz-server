import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const MATERIAL_VIEW_BOX = 'viewBox="0 -960 960 960"';

/** Core's user menu entries (NavigationManager) and the theme file imagePath() serves for each. */
const USER_MENU_ICONS = {
	'Aparência e acessibilidade': 'themes/avuz/apps/theming/img/accessibility-dark.svg',
	'Configurações pessoais': 'themes/avuz/apps/settings/img/personal.svg',
	'Configurações de administração': 'themes/avuz/apps/settings/img/admin.svg',
	Aplicativos: 'themes/avuz/apps/settings/img/apps.svg',
	Contas: 'themes/avuz/apps/settings/img/users.svg',
	Ajuda: 'themes/avuz/apps/settings/img/help.svg',
	Sair: 'themes/avuz/core/img/actions/logout.svg',
};

describe('user menu icons', () => {
	for (const [entry, themeFile] of Object.entries(USER_MENU_ICONS)) {
		it(`serves a Material glyph for "${entry}"`, () => {
			const path = `${REPO_ROOT}${themeFile}`;

			assert.ok(existsSync(path), `${themeFile} is missing`);
			assert.ok(readFileSync(path, 'utf8').includes(MATERIAL_VIEW_BOX));
		});
	}
});
