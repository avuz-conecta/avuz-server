/**
 * Deck (Tarefas): modern board extras (css/deck-board.css)
 *
 * - Card counter next to each list title (data-avuz-count on the header),
 *   also on the "Próximos cartões" due-date columns.
 * - "Adicionar cartão" button at the bottom of each list; it clicks the
 *   list's own "+" so it opens the same "Novo cartão" dialog
 *   (js/deck-new-card.js).
 * - Progress bar on cards with subtasks (or description checklist items):
 *   "2/5" from Deck's own badge, shown as a bar above the card footer; the
 *   badge it came from is hidden (.avuz-progress-src).
 * Deck re-renders lists freely, so all of this is re-applied on DOM changes.
 */
(function () {
	"use strict";

	if (!/\/apps\/deck(\/|$)/.test(location.pathname)) {
		return;
	}

	let scheduled = false;

	function progress(card) {
		const badge = card.querySelector(".card-controls [data-cy-subtask-badge]")
			|| card.querySelector(".card-controls .icon-badge:has(.checkbox-marked-icon)");
		const match = badge && /(\d+)\s*\/\s*(\d+)/.exec(badge.textContent);
		let bar = card.querySelector(":scope > .avuz-progress");
		card.querySelectorAll(".avuz-progress-src").forEach((b) => b !== badge && b.classList.remove("avuz-progress-src"));
		if (!match || Number(match[2]) === 0) {
			bar?.remove();
			return;
		}
		const [done, total] = [Number(match[1]), Number(match[2])];
		badge.classList.add("avuz-progress-src");
		if (!bar) {
			bar = document.createElement("div");
			bar.className = "avuz-progress";
			bar.innerHTML = '<span class="avuz-progress__track"><i></i></span><span class="avuz-progress__text"></span>';
			const controls = card.querySelector(":scope > .card-controls");
			card.insertBefore(bar, controls || null);
		}
		const key = done + "/" + total;
		if (bar.dataset.key !== key) {
			bar.dataset.key = key;
			bar.classList.toggle("avuz-progress--done", done >= total);
			bar.querySelector("i").style.width = Math.min(100, Math.round((done / total) * 100)) + "%";
			bar.querySelector(".avuz-progress__text").textContent = key;
			bar.title = badge.hasAttribute("data-cy-subtask-badge") ? `${done} de ${total} subtarefas concluídas` : `${done} de ${total} itens concluídos`;
		}
	}

	function apply() {
		scheduled = false;
		document.querySelectorAll(".app-deck :is(.board, .overview) .card").forEach(progress);
		// "Próximos cartões": card counter on each due-date column
		document.querySelectorAll(".app-deck .overview .dashboard-column").forEach((column) => {
			const header = column.querySelector(":scope > .dashboard-column__header");
			const count = String(column.querySelectorAll(".dashboard-column__list .card").length);
			if (header && header.dataset.avuzCount !== count) {
				header.dataset.avuzCount = count;
			}
		});
		document.querySelectorAll(".app-deck .board .stack").forEach((stack) => {
			const header = stack.querySelector(":scope > .stack__header");
			if (!header) {
				return;
			}
			const count = String(stack.querySelectorAll(".dnd-container .card").length);
			if (header.dataset.avuzCount !== count) {
				header.dataset.avuzCount = count;
			}

			const plus = header.querySelector('[data-cy="action:add-card"]');
			let add = stack.querySelector(":scope > .avuz-stack-add");
			if (!plus) {
				add?.remove(); // no edit permission or archived view
				return;
			}
			if (!add) {
				add = document.createElement("button");
				add.type = "button";
				add.className = "avuz-stack-add";
				add.textContent = "Adicionar cartão";
				add.addEventListener("click", () => {
					stack.querySelector(':scope > .stack__header [data-cy="action:add-card"]')?.click();
				});
				stack.append(add);
			}
		});
	}

	new MutationObserver((records) => {
		// Ignore our own attribute/button changes
		const ours = (n) => n.classList?.contains("avuz-stack-add") || n.classList?.contains("avuz-progress") || n.parentElement?.closest?.(".avuz-progress");
		if (scheduled || records.every((r) => r.type === "attributes" || (r.type === "childList" && [...r.addedNodes, ...r.removedNodes].every(ours)) || (r.type === "characterData" && r.target.parentElement?.closest(".avuz-progress")))) {
			return;
		}
		scheduled = true;
		requestAnimationFrame(apply);
	}).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
	apply();
})();

/* Filter popover: Deck paints each label as a coloured block (inline style);
   expose that colour so css/deck-board.css can show it as a dot on a chip. */
(function () {
	"use strict";

	new MutationObserver(() => {
		document.querySelectorAll(".v-popper__inner .filter .filter--item .label:not([data-avuz-dot])").forEach((label) => {
			label.dataset.avuzDot = "1";
			label.style.setProperty("--avuz-label-color", label.style.backgroundColor);
		});
	}).observe(document.documentElement, { childList: true, subtree: true });
})();

/* "Configurações de Tarefas" dialog: one section at a time (the left menu
   works as tabs instead of scrolling one long page), with a short description
   under each section title. Styled in css/deck-board.css (.avuz-settings). */
(function () {
	"use strict";

	if (!/\/apps\/deck(\/|$)/.test(location.pathname)) {
		return;
	}

	const DESCRIPTIONS = {
		"appearance-settings": "Escolha o que aparece nos cartões e onde os painéis são exibidos.",
		"admin-settings": "Defina quem pode criar painéis nesta instância.",
		"keyboard-shortcuts": "Atalhos para trabalhar mais rápido no quadro e nos cartões.",
	};

	function show(dialog, id) {
		dialog.querySelectorAll(".app-settings-section").forEach((section) => {
			section.classList.toggle("avuz-settings__active", section.id === "settings-section_" + id);
		});
		dialog.querySelectorAll(".navigation-list__link").forEach((link) => {
			const active = link.getAttribute("href") === "#settings-section_" + id;
			link.classList.toggle("navigation-list__link--active", active);
			link.setAttribute("aria-current", String(active));
		});
		dialog.querySelector(".app-settings__content")?.scrollTo(0, 0);
	}

	function setup(dialog) {
		if (dialog.classList.contains("avuz-settings")) {
			return;
		}
		dialog.classList.add("avuz-settings");
		dialog.querySelectorAll(".app-settings-section").forEach((section) => {
			const key = section.id.replace("settings-section_", "");
			section.dataset.avuzKey = key;
			const description = section.querySelector(".app-settings-section__description");
			if (description && !description.textContent.trim() && DESCRIPTIONS[key]) {
				description.textContent = DESCRIPTIONS[key];
			}
		});
		dialog.querySelectorAll(".navigation-list__link").forEach((link) => {
			link.dataset.avuzKey = (link.getAttribute("href") || "").replace("#settings-section_", "");
			// shorter menu label, the section keeps its full title
			const text = link.querySelector(".navigation-list__link-text");
			if (link.dataset.avuzKey === "admin-settings" && text) {
				text.textContent = "Administração";
			}
		});
		dialog.addEventListener("click", (event) => {
			const link = event.target.closest(".navigation-list__link");
			if (link && dialog.contains(link)) {
				event.preventDefault();
				event.stopImmediatePropagation();
				show(dialog, link.dataset.avuzKey);
			}
		}, true);
		const first = dialog.querySelector(".navigation-list__link");
		if (first) {
			show(dialog, first.dataset.avuzKey);
		}
	}

	new MutationObserver(() => {
		document.querySelectorAll(".app-settings:not(.avuz-settings)").forEach((dialog) => {
			if (dialog.querySelector(".navigation-list__link") && dialog.querySelector(".app-settings-section")) {
				setup(dialog);
			}
		});
	}).observe(document.body, { childList: true, subtree: true });
})();
