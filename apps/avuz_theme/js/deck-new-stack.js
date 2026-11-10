/**
 * Deck (Tarefas): "Nova lista" / "Editar lista" dialog
 *
 * The "Adicionar lista" button in the board header used to swap itself for a
 * small name field; the list colour could only be set afterwards from the
 * list's own menu. This intercepts it and opens a centred dialog (same look as
 * "Novo cartão"/"Novo painel") with the name and the colour.
 *
 * Creates with POST /stacks, sets the colour with PUT /stacks/{id}/color (the
 * same endpoint as the list menu) and commits the result to Deck's store
 * (addStack) so it shows on the board right away.
 *
 * The same dialog edits a list: clicking the list title (which used to turn
 * into a cramped inline field) or the pencil shown on hover opens it with the
 * name and colour filled in; saving uses Deck's updateStack/updateStackColor
 * store actions.
 * css/deck-board-actions.css styles it.
 */
(function () {
	"use strict";

	const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

	const COLORS = ["0082c9", "1f8a70", "31cc7c", "f1db50", "ff7a66", "e9322d", "c2185b", "8e44ad", "317ccc", "4d535c"];

	function deckStore() {
		const root = document.querySelector(".app-deck");
		for (let vm = root && root.__vue__; vm; vm = vm.$parent) {
			if (vm.$store) {
				return vm.$store;
			}
		}
		return null;
	}

	async function api(method, path, body) {
		const response = await fetch(OC.generateUrl("/apps/deck" + path), {
			method,
			headers: { requesttoken: OC.requestToken, Accept: "application/json", "Content-Type": "application/json" },
			body: body ? JSON.stringify(body) : undefined,
		});
		if (!response.ok) {
			let message = "";
			try {
				message = (await response.json()).message || "";
			} catch (e) {}
			throw new Error(message || "HTTP " + response.status);
		}
		return response.json();
	}

	// The Stack component behind a list element (has `stack` and canManage)
	function stackVm(node) {
		for (let el = node; el; el = el.parentElement) {
			for (let vm = el.__vue__; vm; vm = vm.$parent) {
				if (vm.stack && typeof vm.clickAddCard === "function") {
					return vm;
				}
			}
		}
		return null;
	}

	function openDialog(store, board, editing = null) {
		const initial = editing ? String(editing.color || "").toLowerCase() : "";
		const overlay = document.createElement("div");
		overlay.className = "avuz-nc-overlay";
		overlay.innerHTML = `
			<form class="avuz-nc avuz-ns" role="dialog" aria-modal="true" aria-labelledby="avuz-ns-title" novalidate>
				<header class="avuz-nc__head">
					<h2 id="avuz-ns-title">${editing ? "Editar lista" : "Nova lista"}</h2>
					<button type="button" class="avuz-nc__x" aria-label="Fechar">×</button>
				</header>
				<div class="avuz-nc__body">
					<textarea class="avuz-nc__title" name="title" rows="1" placeholder="Nome da lista" autocomplete="off" required></textarea>
					<div class="avuz-nc__field">
						<span>Cor</span>
						<div class="avuz-nb__colors" role="radiogroup" aria-label="Cor da lista">
							<button type="button" role="radio" class="avuz-nb__color avuz-ns__none" data-color="" aria-checked="${!initial}" aria-label="Sem cor" title="Sem cor"></button>
							${COLORS.map((c) => `<button type="button" role="radio" class="avuz-nb__color" data-color="${c}" style="--c:#${c}" aria-checked="${c === initial}" aria-label="#${c}"></button>`).join("")}
							<label class="avuz-nb__color avuz-nb__color--custom" title="Outra cor"><input type="color" value="#${initial || "0082c9"}" aria-label="Outra cor"></label>
						</div>
					</div>
					<div class="avuz-nc__field">
						<span>Prévia</span>
						<div class="avuz-ns__preview"><span></span></div>
					</div>
					<p class="avuz-nc__error" hidden></p>
				</div>
				<footer class="avuz-nc__foot">
					<span class="avuz-nc__hint">${editing ? "Enter para salvar" : "Enter para criar"}</span>
					<button type="button" class="avuz-nc__cancel">Cancelar</button>
					<button type="submit" class="avuz-nc__create">${editing ? "Salvar" : "Criar lista"}</button>
				</footer>
			</form>`;
		document.body.append(overlay);

		const form = overlay.querySelector("form");
		const title = form.querySelector(".avuz-nc__title");
		const error = form.querySelector(".avuz-nc__error");
		const preview = form.querySelector(".avuz-ns__preview");
		const close = () => {
			overlay.remove();
			document.removeEventListener("keydown", onKey, true);
		};
		const onKey = (e) => {
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopImmediatePropagation();
				close();
			}
		};
		document.addEventListener("keydown", onKey, true);
		overlay.addEventListener("mousedown", (e) => {
			if (e.target === overlay) {
				close();
			}
		});
		form.querySelector(".avuz-nc__x").addEventListener("click", close);
		form.querySelector(".avuz-nc__cancel").addEventListener("click", close);

		// Name: wraps and grows, Enter creates
		title.addEventListener("input", () => {
			if (/[\r\n]/.test(title.value)) {
				title.value = title.value.replace(/\s*[\r\n]+\s*/g, " ");
			}
			title.classList.remove("invalid");
			title.style.height = "auto";
			title.style.height = title.scrollHeight + "px";
			preview.firstElementChild.textContent = title.value.trim();
		});
		title.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				form.requestSubmit();
			}
		});

		// Colour: none, a swatch or a custom colour
		let color = "";
		const custom = form.querySelector(".avuz-nb__color--custom input");
		const setColor = (c) => {
			color = c.replace("#", "").toLowerCase();
			form.querySelectorAll(".avuz-nb__color[data-color]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.color === color)));
			custom.parentElement.classList.toggle("on", color !== "" && !COLORS.includes(color));
			if (color) {
				preview.style.setProperty("--c", "#" + color);
			} else {
				preview.style.removeProperty("--c");
			}
		};
		form.querySelectorAll(".avuz-nb__color[data-color]").forEach((b) => b.addEventListener("click", () => setColor(b.dataset.color)));
		custom.addEventListener("input", () => setColor(custom.value));
		if (editing) {
			title.value = editing.title;
			title.dispatchEvent(new Event("input"));
			setColor(initial);
		}

		form.addEventListener("submit", async (e) => {
			e.preventDefault();
			const name = title.value.trim();
			if (!name) {
				title.focus();
				title.classList.add("invalid");
				return;
			}
			const create = form.querySelector(".avuz-nc__create");
			create.disabled = true;
			create.textContent = editing ? "Salvando…" : "Criando…";
			error.hidden = true;

			if (editing) {
				try {
					if (name !== editing.title) {
						await store.dispatch("updateStack", { ...editing, title: name });
					}
					if (color !== initial) {
						await store.dispatch("updateStackColor", { stack: editing, color: color || null });
					}
					close();
				} catch (err) {
					console.error("[avuz] update list failed", err);
					error.textContent = "Não foi possível salvar a lista.";
					error.hidden = false;
					create.disabled = false;
					create.textContent = "Salvar";
				}
				return;
			}

			let stack;
			try {
				stack = await api("POST", "/stacks", { title: name, boardId: board.id, order: 999 });
			} catch (err) {
				console.error("[avuz] create list failed", err);
				error.textContent = "Não foi possível criar a lista. " + (err.message || "");
				error.hidden = false;
				create.disabled = false;
				create.textContent = "Criar lista";
				return;
			}
			let colorFailed = false;
			if (color) {
				try {
					stack = await api("PUT", `/stacks/${stack.id}/color`, { color });
				} catch (err) {
					console.error("[avuz] list colour failed", err);
					colorFailed = true;
				}
			}
			store.commit("addStack", stack);
			close();
			OC.Notification.showTemporary(colorFailed
				? `Lista “${name}” criada, mas não foi possível aplicar a cor.`
				: `Lista “${name}” criada.`, colorFailed ? { type: "error" } : undefined);
			// Bring the new list into view (it's added at the end)
			setTimeout(() => {
				const columns = document.querySelectorAll(".app-deck .stack");
				columns[columns.length - 1]?.scrollIntoView({ behavior: "smooth", inline: "end", block: "nearest" });
			}, 100);
		});

		setTimeout(() => {
			title.focus();
			title.select();
		}, 0);
	}

	// Edit: the list title (Deck would swap it for an inline field) or our pencil
	function editFrom(target) {
		const vm = stackVm(target);
		const store = deckStore();
		const board = store && store.state.currentBoard;
		if (!vm || !board) {
			return false;
		}
		openDialog(store, board, vm.stack);
		return true;
	}

	document.addEventListener("click", (event) => {
		const target = event.target.closest?.(".app-deck .stack__header h3.stack__title, .app-deck .stack__header .avuz-stack-edit");
		if (target && event.button === 0 && editFrom(target)) {
			event.preventDefault();
			event.stopImmediatePropagation();
		}
	}, true);
	document.addEventListener("keydown", (event) => {
		const target = event.target.closest?.(".app-deck .stack__header h3.stack__title");
		if (target && event.key === "Enter" && editFrom(target)) {
			event.preventDefault();
			event.stopImmediatePropagation();
		}
	}, true);

	// Pencil button on editable list headers (shown on hover, css/deck-board.css)
	let queued = false;
	new MutationObserver(() => {
		if (queued) {
			return;
		}
		queued = true;
		requestAnimationFrame(() => {
			queued = false;
			document.querySelectorAll(".app-deck .stack__header:has(> h3.stack__title):not(:has(> .avuz-stack-edit))").forEach((header) => {
				const pencil = document.createElement("button");
				pencil.type = "button";
				pencil.className = "avuz-stack-edit";
				pencil.title = "Editar lista";
				pencil.setAttribute("aria-label", "Editar lista");
				header.querySelector(":scope > h3.stack__title").after(pencil);
			});
		});
	}).observe(document.documentElement, { childList: true, subtree: true });

	// Intercept "Adicionar lista" in the board header
	document.addEventListener("click", (event) => {
		const button = event.target.closest?.(".app-deck #stack-add button");
		if (!button || event.button !== 0) {
			return;
		}
		const store = deckStore();
		const board = store && store.state.currentBoard;
		if (!board) {
			return; // fall back to Deck's inline field
		}
		event.preventDefault();
		event.stopImmediatePropagation();
		openDialog(store, board);
	}, true);
})();
