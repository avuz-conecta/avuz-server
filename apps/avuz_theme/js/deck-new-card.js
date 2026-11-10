/**
 * Deck (Tarefas): "Novo cartão" dialog
 *
 * The "+" on a list header used to open a tiny title field at the bottom of
 * the list; labels, people and dates could only be set afterwards, inside the
 * card. This intercepts that button and opens a centred dialog to create the
 * card with everything at once: title, list, description, subtasks,
 * attachments, labels, assignees, start and due dates.
 *
 * Uses Deck's own Vuex store, so the card appears on the board right away:
 * addCard (the create endpoint accepts description, dates, labels and users
 * in one call), then the full card is fetched and committed with updateCard
 * so its labels and assignees show without a reload. Subtasks go into a
 * "Subtarefas" group (createSubtaskGroup/createSubtask) and files are uploaded
 * with createAttachment (type "file", like Deck's Anexos tab).
 * css/deck-new-card.css styles the dialog.
 */
(function () {
	"use strict";

	const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

	function deckStore() {
		const root = document.querySelector(".app-deck");
		for (let vm = root && root.__vue__; vm; vm = vm.$parent) {
			if (vm.$store) {
				return vm.$store;
			}
		}
		return null;
	}

	function stackOf(node) {
		for (let el = node; el; el = el.parentElement) {
			for (let vm = el.__vue__; vm; vm = vm.$parent) {
				if (vm.stack && typeof vm.clickAddCard === "function") {
					return vm.stack;
				}
			}
		}
		return null;
	}

	function initials(name) {
		const parts = String(name || "?").trim().split(/\s+/);
		return ((parts[0]?.[0] || "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
	}

	function fileSize(bytes) {
		const units = ["B", "KB", "MB", "GB"];
		let i = 0;
		for (; bytes >= 1024 && i < units.length - 1; i++) {
			bytes /= 1024;
		}
		return (i ? bytes.toFixed(1).replace(".0", "") : bytes) + " " + units[i];
	}

	// "2026-10-20T14:30" (datetime-local) -> ISO for Deck, or null
	const toIso = (value) => (value ? new Date(value).toISOString() : null);

	function openDialog(store, stack) {
		const board = store.state.currentBoard || store.getters.currentBoard;
		if (!board) {
			return;
		}
		const stacks = store.getters.stacksByBoard(board.id) || [];
		const labels = store.getters.currentBoardLabels || [];
		const people = store.getters.assignables || [];

		const overlay = document.createElement("div");
		overlay.className = "avuz-nc-overlay";
		overlay.innerHTML = `
			<form class="avuz-nc" role="dialog" aria-modal="true" aria-labelledby="avuz-nc-title" novalidate>
				<header class="avuz-nc__head">
					<h2 id="avuz-nc-title">Novo cartão</h2>
					<button type="button" class="avuz-nc__x" aria-label="Fechar">×</button>
				</header>
				<div class="avuz-nc__body">
					<textarea class="avuz-nc__title" name="title" rows="1" placeholder="Título do cartão" autocomplete="off" required></textarea>
					<div class="avuz-nc__row">
						<label class="avuz-nc__field">
							<span>Lista</span>
							<select name="stack">${stacks.map((s) => `<option value="${s.id}"${s.id === stack.id ? " selected" : ""}>${esc(s.title)}</option>`).join("")}</select>
						</label>
						<label class="avuz-nc__field">
							<span>Início</span>
							<input type="datetime-local" name="start">
						</label>
						<label class="avuz-nc__field">
							<span>Vencimento</span>
							<input type="datetime-local" name="due">
						</label>
					</div>
					<div class="avuz-nc__field">
						<span>Descrição</span>
						<div class="avuz-nc__editor" data-avuz-rte-host>
						<textarea name="description" rows="6" placeholder="Detalhes, contexto, links… (aceita formatação Markdown: **negrito**, - listas, - [ ] tarefas)"></textarea>
						</div>
					</div>
					<div class="avuz-nc__field">
						<span>Subtarefas</span>
						<ul class="avuz-nc__subtasks"></ul>
						<input class="avuz-nc__subtask-new" placeholder="Adicionar subtarefa e pressionar Enter" aria-label="Nova subtarefa" autocomplete="off">
					</div>
					<div class="avuz-nc__field">
						<span>Anexos</span>
						<label class="avuz-nc__drop">
							<input type="file" multiple hidden>
							<b>Escolher arquivos</b> ou arraste-os para cá
						</label>
						<ul class="avuz-nc__files"></ul>
					</div>
					<div class="avuz-nc__field">
						<span>Etiquetas</span>
						<div class="avuz-nc__chips" data-kind="labels">
							${labels.length ? labels.map((l) => `<button type="button" class="avuz-nc__chip avuz-nc__label" data-id="${l.id}" style="--c:#${esc(l.color)}" aria-pressed="false"><i></i>${esc(l.title)}</button>`).join("") : '<em class="avuz-nc__none">Este painel não tem etiquetas.</em>'}
						</div>
					</div>
					<div class="avuz-nc__field">
						<span>Responsáveis</span>
						${people.length > 8 ? '<input class="avuz-nc__filter" placeholder="Filtrar pessoas…" aria-label="Filtrar pessoas">' : ""}
						<div class="avuz-nc__chips" data-kind="people">
							${people.length ? people.map((u) => `<button type="button" class="avuz-nc__chip avuz-nc__person" data-id="${esc(u.uid)}" data-type="${u.type}" aria-pressed="false"><b>${esc(initials(u.displayname))}</b>${esc(u.displayname)}${u.type === 1 ? " <small>grupo</small>" : u.type === 7 ? " <small>equipe</small>" : ""}</button>`).join("") : '<em class="avuz-nc__none">Compartilhe o painel para atribuir pessoas.</em>'}
						</div>
					</div>
					<p class="avuz-nc__error" hidden></p>
				</div>
				<footer class="avuz-nc__foot">
					<span class="avuz-nc__hint">Ctrl+Enter para criar</span>
					<button type="button" class="avuz-nc__cancel">Cancelar</button>
					<button type="submit" class="avuz-nc__create">Criar cartão</button>
				</footer>
			</form>`;
		document.body.append(overlay);

		const form = overlay.querySelector("form");
		let richEditor = null;
		let descriptionMarkdown = "";
		const descriptionValue = () => (richEditor ? descriptionMarkdown : form.elements.description?.value || "");
		const focusDescription = () => {
			const pm = overlay.querySelector(".avuz-nc__editor .ProseMirror");
			(pm || form.elements.description)?.focus();
		};
		const title = form.querySelector(".avuz-nc__title");
		const error = form.querySelector(".avuz-nc__error");
		const close = () => {
			richEditor?.destroy();
			overlay.remove();
			document.removeEventListener("keydown", onKey, true);
		};
		const onKey = (e) => {
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopImmediatePropagation();
				close();
			} else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				form.requestSubmit();
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

		// Title wraps and grows with the text; it stays a single line of text:
		// Enter jumps to the description, pasted line breaks become spaces.
		const growTitle = () => {
			title.style.height = "auto";
			title.style.height = title.scrollHeight + "px";
		};
		title.addEventListener("input", () => {
			if (/[\r\n]/.test(title.value)) {
				const pos = title.selectionStart;
				title.value = title.value.replace(/\s*[\r\n]+\s*/g, " ");
				title.setSelectionRange(pos, pos);
			}
			title.classList.remove("invalid");
			growTitle();
		});
		title.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
				e.preventDefault();
				focusDescription();
			}
		});

		// Subtasks: typed one by one, Enter adds, × removes, text stays editable
		const subtaskList = form.querySelector(".avuz-nc__subtasks");
		const subtaskNew = form.querySelector(".avuz-nc__subtask-new");
		const addSubtask = (text) => {
			const li = document.createElement("li");
			li.innerHTML = '<i aria-hidden="true"></i><input aria-label="Subtarefa"><button type="button" aria-label="Remover subtarefa">×</button>';
			li.querySelector("input").value = text;
			li.querySelector("input").addEventListener("keydown", (e) => {
				if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
					e.preventDefault();
					subtaskNew.focus();
				}
			});
			li.querySelector("button").addEventListener("click", () => li.remove());
			subtaskList.append(li);
		};
		subtaskNew.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
				e.preventDefault();
				const text = subtaskNew.value.trim();
				if (text) {
					addSubtask(text);
					subtaskNew.value = "";
				}
			}
		});
		// Pasting several lines adds one subtask per line
		subtaskNew.addEventListener("paste", (e) => {
			const lines = (e.clipboardData?.getData("text") || "").split(/\r?\n/).map((l) => l.replace(/^\s*(?:[-*•]|\[[ x]\])\s*/i, "").trim()).filter(Boolean);
			if (lines.length > 1) {
				e.preventDefault();
				lines.forEach(addSubtask);
			}
		});
		const subtaskTitles = () => [
			...[...subtaskList.querySelectorAll("input")].map((i) => i.value.trim()),
			subtaskNew.value.trim(), // typed but Enter not pressed yet
		].filter(Boolean);

		// Attachments: picker, drag and drop, or pasting files into the dialog
		const files = [];
		const fileList = form.querySelector(".avuz-nc__files");
		const drop = form.querySelector(".avuz-nc__drop");
		const picker = drop.querySelector("input");
		const renderFiles = () => {
			fileList.innerHTML = files.map((f, i) => `<li><i aria-hidden="true"></i><span>${esc(f.name)}</span><small>${fileSize(f.size)}</small><button type="button" data-i="${i}" aria-label="Remover ${esc(f.name)}">×</button></li>`).join("");
		};
		const addFiles = (list) => {
			files.push(...[...list].filter((f) => f.size > 0 || f.type));
			renderFiles();
		};
		fileList.addEventListener("click", (e) => {
			const button = e.target.closest("button[data-i]");
			if (button) {
				files.splice(Number(button.dataset.i), 1);
				renderFiles();
			}
		});
		picker.addEventListener("change", () => {
			addFiles(picker.files);
			picker.value = "";
		});
		form.addEventListener("dragover", (e) => {
			if ([...(e.dataTransfer?.types || [])].includes("Files")) {
				e.preventDefault();
				drop.classList.add("over");
			}
		});
		form.addEventListener("dragleave", (e) => {
			if (!form.contains(e.relatedTarget)) {
				drop.classList.remove("over");
			}
		});
		form.addEventListener("drop", (e) => {
			if (e.dataTransfer?.files?.length) {
				e.preventDefault();
				drop.classList.remove("over");
				addFiles(e.dataTransfer.files);
			}
		});
		form.addEventListener("paste", (e) => {
			const pasted = [...(e.clipboardData?.files || [])];
			if (pasted.length) {
				e.preventDefault();
				addFiles(pasted.map((f, i) => (f.name && f.name !== "image.png") ? f
					: new File([f], `print-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}${i ? "-" + i : ""}.${(f.type.split("/")[1] || "png").replace("jpeg", "jpg")}`, { type: f.type })));
			}
		});

		// Description: the same rich editor as inside a card (Nextcloud Text +
		// our toolbar from js/deck-editor-toolbar.js, which finds the stand-in
		// "description" object on the host); the textarea is the fallback when
		// Text is not available.
		const editorHost = form.querySelector(".avuz-nc__editor");
		if (window.OCA?.Text?.createEditor) {
			const mount = document.createElement("div");
			editorHost.__avuzDescription = {
				card: { title: () => title.value.trim(), isTemplate: false },
				canEdit: true,
				showAttachmentModal: () => picker.click(),
			};
			window.OCA.Text.createEditor({
				el: mount,
				content: "",
				readOnly: false,
				onUpdate: ({ markdown }) => {
					descriptionMarkdown = markdown;
				},
				onFileInsert: () => picker.click(),
			}).then((editor) => {
				if (!overlay.isConnected) {
					editor.destroy();
					return;
				}
				richEditor = editor;
				form.elements.description.remove();
				editorHost.append(mount);
				editorHost.classList.add("avuz-nc__editor--rich");
			}).catch((err) => console.error("[avuz] description editor unavailable", err));
			// Pasted files go to the attachments list, not into the text
			editorHost.addEventListener("paste", (e) => {
				const pasted = [...(e.clipboardData?.files || [])];
				if (pasted.length) {
					e.preventDefault();
					e.stopPropagation();
					addFiles(pasted);
				}
			}, true);
		}

		form.querySelectorAll(".avuz-nc__chip").forEach((chip) => {
			chip.addEventListener("click", () => {
				chip.setAttribute("aria-pressed", String(chip.getAttribute("aria-pressed") !== "true"));
			});
		});
		const filter = form.querySelector(".avuz-nc__filter");
		filter?.addEventListener("input", () => {
			const q = filter.value.trim().toLowerCase();
			form.querySelectorAll(".avuz-nc__person").forEach((chip) => {
				chip.hidden = q && !chip.textContent.toLowerCase().includes(q);
			});
		});

		form.addEventListener("submit", async (e) => {
			e.preventDefault();
			const name = title.value.trim();
			if (!name) {
				title.focus();
				title.classList.add("invalid");
				return;
			}
			const start = form.elements.start.value;
			const due = form.elements.due.value;
			if (start && due && new Date(start) > new Date(due)) {
				error.textContent = "A data de início é depois do vencimento.";
				error.hidden = false;
				return;
			}
			const create = form.querySelector(".avuz-nc__create");
			create.disabled = true;
			create.textContent = "Criando…";
			error.hidden = true;

			const stackId = Number(form.elements.stack.value);
			const payload = {
				title: name,
				stackId,
				boardId: board.id,
				type: "plain",
				description: descriptionValue(),
				duedate: toIso(due),
				startdate: toIso(start),
				labels: [...form.querySelectorAll('.avuz-nc__label[aria-pressed="true"]')].map((c) => Number(c.dataset.id)),
				users: [...form.querySelectorAll('.avuz-nc__person[aria-pressed="true"]')].map((c) => ({ id: c.dataset.id, type: Number(c.dataset.type) })),
			};
			try {
				const card = await store.dispatch("addCard", payload);
				const failed = [];

				const subtasks = subtaskTitles();
				if (subtasks.length) {
					create.textContent = "Adicionando subtarefas…";
					try {
						const group = await store.dispatch("createSubtaskGroup", { cardId: card.id, title: "Subtarefas" });
						for (const text of subtasks) {
							await store.dispatch("createSubtask", { groupId: group.id, title: text });
						}
					} catch (err) {
						console.error("[avuz] create subtasks failed", err);
						failed.push("subtarefas");
					}
				}

				for (const [i, file] of files.entries()) {
					create.textContent = `Enviando anexo ${i + 1} de ${files.length}…`;
					const body = new FormData();
					body.append("cardId", card.id);
					body.append("type", "file");
					body.append("file", file);
					try {
						await store.dispatch("createAttachment", { cardId: card.id, formData: body });
					} catch (err) {
						console.error("[avuz] upload failed", file.name, err);
						failed.push(file.name);
					}
				}

				// The create response has no labels/assignees yet: refresh the card
				const full = await fetch(OC.generateUrl(`/apps/deck/cards/${card.id}`), {
					headers: { requesttoken: OC.requestToken, Accept: "application/json" },
				}).then((r) => (r.ok ? r.json() : null));
				if (full) {
					store.commit("updateCard", full);
				}
				close();
				if (failed.length) {
					OC.Notification.showTemporary(`Cartão “${name}” criado, mas não foi possível adicionar: ${failed.join(", ")}.`, { type: "error" });
				} else {
					OC.Notification.showTemporary(`Cartão “${name}” criado.`);
				}
			} catch (err) {
				console.error("[avuz] create card failed", err);
				error.textContent = "Não foi possível criar o cartão. " + (err?.response?.data?.message || "");
				error.hidden = false;
				create.disabled = false;
				create.textContent = "Criar cartão";
			}
		});

		setTimeout(() => title.focus(), 0);
	}

	// Intercept the "+" (Adicionar cartão) on list headers
	document.addEventListener("click", (event) => {
		const button = event.target.closest?.('.stack__header [data-cy="action:add-card"], .stack__header button[aria-label="Adicionar cartão"]');
		if (!button || event.button !== 0) {
			return;
		}
		const store = deckStore();
		const stack = stackOf(button);
		if (!store || !stack) {
			return; // fall back to Deck's inline field
		}
		event.preventDefault();
		event.stopImmediatePropagation();
		openDialog(store, stack);
	}, true);
})();
