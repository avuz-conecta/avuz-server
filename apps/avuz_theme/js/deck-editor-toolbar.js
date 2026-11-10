/**
 * Deck (Tarefas): richer toolbar for the card description editor
 *
 * The description is Nextcloud Text (Markdown, Tiptap). Its own menu bar
 * groups most actions into small menus ("Tт", lists, blocks) and has no
 * horizontal rule, so it feels poor. This replaces it, in card descriptions
 * only, with a toolbar in the Avuz webmail editor style where every Markdown
 * feature is one click away. Buttons call the Tiptap editor directly
 * (ProseMirror DOM node .editor), so the stored Markdown is unchanged and
 * stays compatible with the Deck apps and other clients.
 *
 * A "tela cheia" button turns the editor into a Word-like document view
 * (title + Concluir on top, ribbon toolbar, white page over grey); Esc or
 * Concluir leaves it. Fonts, sizes, colours and alignment are not offered:
 * Markdown cannot store them. css/deck-editor-toolbar.css styles all of it.
 */
(function () {
	"use strict";

	// --- icons (thin stroke, like the webmail editor) -------------------------
	const svg = (body, extra = "") => `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${body}</svg>`;
	const I = {
		undo: svg('<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>'),
		redo: svg('<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3l3 2.7"/>'),
		bold: svg('<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>', ' stroke-width="2.2"'),
		italic: svg('<path d="M19 4h-9M14 20H5M15 4 9 20"/>'),
		underline: svg('<path d="M6 4v6a6 6 0 0 0 12 0V4M4 20h16"/>'),
		strike: svg('<path d="M16 4H9a3 3 0 0 0-2.83 4"/><path d="M14 12a4 4 0 0 1 0 8H6"/><path d="M4 12h16"/>'),
		code: svg('<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>'),
		bullet: svg('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>'),
		ordered: svg('<path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>'),
		task: svg('<rect x="3" y="5" width="6" height="6" rx="1"/><path d="m3 17 2 2 4-4M13 6h8M13 12h8M13 18h8"/>'),
		indent: svg('<path d="m3 8 4 4-4 4M21 12H11M21 6H11M21 18H11"/>'),
		outdent: svg('<path d="m7 8-4 4 4 4M21 12H11M21 6H11M21 18H11"/>'),
		quote: svg('<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.76-2-2-2H4c-1.25 0-2 .75-2 2v6c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 0-1 1v3c0 1 0 1 1 1z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.76-2-2-2h-4c-1.25 0-2 .75-2 2v6c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>'),
		codeBlock: svg('<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"/><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"/>'),
		callout: svg('<circle cx="12" cy="12" r="9"/><path d="M12 8h.01M11 12h1v4h1"/>'),
		details: svg('<path d="m6 9 6 6 6-6"/><path d="M4 4h16"/>'),
		table: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>'),
		hr: svg('<path d="M3 12h18M8 7h8M8 17h8"/>'),
		link: svg('<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>'),
		attach: svg('<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>'),
		emoji: svg('<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>'),
		expand: svg('<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>'),
		collapse: svg('<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>'),
		chevron: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>',
	};

	const EMOJIS = ["😀", "😃", "😄", "😁", "😊", "🙂", "😉", "😍", "🤔", "😅", "😂", "😎", "😢", "😡", "👍", "👎", "👏", "🙏", "💪", "👀", "✅", "❌", "⚠️", "❗", "❓", "⭐", "🔥", "🎉", "🚀", "💡", "📌", "📎", "📅", "⏰", "📝", "📞", "💬", "🔒", "🔧", "💰"];

	// --- helpers ----------------------------------------------------------------

	// Deck's Description component, or a stand-in object set by another of our
	// dialogs on its editor host (el.__avuzDescription, e.g. "Novo cartão":
	// { card: { title, isTemplate }, canEdit, showAttachmentModal })
	function findDescription(node) {
		const host = node.closest?.("[data-avuz-rte-host]");
		if (host && host.__avuzDescription) {
			return host.__avuzDescription;
		}
		for (let el = node; el; el = el.parentElement) {
			for (let vm = el.__vue__; vm; vm = vm.$parent) {
				if (typeof vm.addAttachment === "function" && vm.editor && vm.card) {
					return vm;
				}
			}
		}
		return null;
	}

	function button(label, icon, extraClass = "") {
		const b = document.createElement("button");
		b.type = "button";
		b.className = "avuz-rte-btn " + extraClass;
		b.innerHTML = icon;
		b.title = label;
		b.setAttribute("aria-label", label);
		// Keep the selection in the text while clicking the bar
		b.addEventListener("mousedown", (e) => e.preventDefault());
		return b;
	}

	const sep = () => {
		const s = document.createElement("span");
		s.className = "avuz-rte-sep";
		return s;
	};

	function closeMenus(bar, except) {
		bar.querySelectorAll(".avuz-rte-pop").forEach((p) => {
			if (p !== except) {
				p.hidden = true;
			}
		});
	}

	/** Button with a small popover (callouts, link, emoji) */
	function popover(bar, label, icon, build) {
		const wrap = document.createElement("span");
		wrap.className = "avuz-rte-menu";
		const b = button(label, icon + I.chevron, "with-chevron");
		const pop = document.createElement("div");
		pop.className = "avuz-rte-pop";
		pop.hidden = true;
		build(pop, () => { pop.hidden = true; });
		b.addEventListener("click", () => {
			closeMenus(bar, pop);
			pop.hidden = !pop.hidden;
			if (!pop.hidden) {
				pop.querySelector("input")?.focus();
			}
		});
		wrap.append(b, pop);
		return wrap;
	}

	// --- document mode ("like Word") ---------------------------------------------
	// The editor block goes full screen: header (card title + Concluir), the
	// toolbar as a ribbon, and the text on a centred white page over grey.

	function setDocMode(editorEl, editor, description, on) {
		editorEl.classList.toggle("avuz-doc-mode", on);
		document.documentElement.classList.toggle("avuz-doc-open", on);
		const head = editorEl.querySelector(".avuz-doc-head");
		if (head) {
			head.querySelector(".avuz-doc-title").textContent = (typeof description.card.title === "function" ? description.card.title() : description.card.title) || "Novo cartão";
		}
		const toggle = editorEl.querySelector(".avuz-rte-doc-toggle");
		if (toggle) {
			toggle.innerHTML = on ? I.collapse : I.expand;
			toggle.title = on ? "Sair da tela cheia (Esc)" : "Editar em tela cheia";
			toggle.setAttribute("aria-label", toggle.title);
			toggle.classList.toggle("active", on);
		}
		editor.commands.focus();
	}

	function buildDocHead(editorEl, editor, description) {
		const head = document.createElement("div");
		head.className = "avuz-doc-head";
		head.innerHTML = '<div class="avuz-doc-meta"><div class="avuz-doc-title"></div><div class="avuz-doc-sub">Descrição do cartão · salva automaticamente</div></div><button type="button" class="avuz-doc-done">Concluir</button>';
		head.querySelector(".avuz-doc-done").addEventListener("click", () => setDocMode(editorEl, editor, description, false));
		return head;
	}

	// --- toolbar ----------------------------------------------------------------

	function buildToolbar(editor, description, editorEl) {
		const bar = document.createElement("div");
		bar.className = "avuz-rte-toolbar";
		bar.setAttribute("role", "toolbar");
		bar.setAttribute("aria-label", "Formatação");
		const run = (fn) => () => { fn(editor.chain().focus()).run(); };
		const states = []; // [button, isActive()] pairs refreshed on every transaction

		const add = (label, icon, action, isActive, can) => {
			const b = button(label, icon);
			b.addEventListener("click", action);
			bar.append(b);
			states.push([b, isActive, can]);
			return b;
		};

		add("Desfazer (Ctrl+Z)", I.undo, run((c) => c.undo()), null, () => editor.can().undo());
		add("Refazer (Ctrl+Shift+Z)", I.redo, run((c) => c.redo()), null, () => editor.can().redo());
		bar.append(sep());

		// Paragraph style
		const style = document.createElement("select");
		style.className = "avuz-rte-select";
		style.title = "Estilo do parágrafo";
		style.setAttribute("aria-label", "Estilo do parágrafo");
		style.innerHTML = '<option value="p">Texto normal</option><option value="1">Título 1</option><option value="2">Título 2</option><option value="3">Título 3</option><option value="4">Título 4</option>';
		style.addEventListener("change", () => {
			const chain = editor.chain().focus();
			(style.value === "p" ? chain.setParagraph() : chain.setHeading({ level: Number(style.value) })).run();
		});
		bar.append(style, sep());

		add("Negrito (Ctrl+B)", I.bold, run((c) => c.toggleBold()), () => editor.isActive("bold"));
		add("Itálico (Ctrl+I)", I.italic, run((c) => c.toggleItalic()), () => editor.isActive("italic"));
		add("Sublinhado (Ctrl+U)", I.underline, run((c) => c.toggleUnderline()), () => editor.isActive("underline"));
		add("Tachado", I.strike, run((c) => c.toggleStrike()), () => editor.isActive("strike"));
		add("Código", I.code, run((c) => c.toggleCode()), () => editor.isActive("code"));
		bar.append(sep());

		add("Lista com marcadores", I.bullet, run((c) => c.toggleBulletList()), () => editor.isActive("bulletList"));
		add("Lista numerada", I.ordered, run((c) => c.toggleOrderedList()), () => editor.isActive("orderedList"));
		add("Lista de tarefas", I.task, run((c) => c.toggleTaskList()), () => editor.isActive("taskList"));
		const listItem = () => (editor.isActive("taskItem") ? "taskItem" : "listItem");
		add("Aumentar recuo", I.indent, run((c) => c.sinkListItem(listItem())), null, () => editor.can().sinkListItem(listItem()));
		add("Diminuir recuo", I.outdent, run((c) => c.liftListItem(listItem())), null, () => editor.can().liftListItem(listItem()));
		bar.append(sep());

		add("Citação", I.quote, run((c) => c.toggleBlockquote()), () => editor.isActive("blockquote"));
		add("Bloco de código", I.codeBlock, run((c) => c.toggleCodeBlock()), () => editor.isActive("codeBlock"));
		bar.append(popover(bar, "Aviso", I.callout, (pop, close) => {
			[["info", "Informação"], ["success", "Sucesso"], ["warn", "Atenção"], ["error", "Perigo"]].forEach(([type, text]) => {
				const item = document.createElement("button");
				item.type = "button";
				item.className = "avuz-rte-item avuz-rte-callout-" + type;
				item.innerHTML = `<span class="dot"></span>${text}`;
				item.addEventListener("mousedown", (e) => e.preventDefault());
				item.addEventListener("click", () => { editor.chain().focus().toggleCallout({ type }).run(); close(); });
				pop.append(item);
			});
		}));
		add("Seção recolhível", I.details, run((c) => c.toggleDetails()), () => editor.isActive("details"));
		add("Tabela", I.table, run((c) => c.insertTable()), () => editor.isActive("table"));
		add("Linha horizontal", I.hr, run((c) => c.setHorizontalRule()));
		bar.append(sep());

		bar.append(popover(bar, "Link", I.link, (pop, close) => {
			pop.classList.add("avuz-rte-link");
			pop.innerHTML = '<input type="url" placeholder="https://…" aria-label="Endereço do link"><button type="button" class="avuz-rte-apply">Aplicar</button><button type="button" class="avuz-rte-remove">Remover</button>';
			const input = pop.querySelector("input");
			const apply = () => {
				const href = input.value.trim();
				const chain = editor.chain().focus().extendMarkRange("link");
				(href ? chain.setLink({ href: /^[a-z]+:/i.test(href) ? href : "https://" + href }) : chain.unsetLink()).run();
				close();
			};
			pop.querySelector(".avuz-rte-apply").addEventListener("click", apply);
			pop.querySelector(".avuz-rte-remove").addEventListener("click", () => { editor.chain().focus().extendMarkRange("link").unsetLink().run(); close(); });
			input.addEventListener("keydown", (e) => {
				if (e.key === "Enter") { e.preventDefault(); apply(); }
				if (e.key === "Escape") { close(); editor.commands.focus(); }
			});
			// Prefill with the current link when opening
			const observer = new MutationObserver(() => {
				if (!pop.hidden) {
					input.value = editor.getAttributes("link").href || "";
				}
			});
			observer.observe(pop, { attributes: true, attributeFilter: ["hidden"] });
		}));

		const attach = button("Anexar arquivo", I.attach);
		attach.addEventListener("click", () => description.showAttachmentModal());
		if (description.card.isTemplate) {
			attach.disabled = true;
		}
		bar.append(attach);

		bar.append(popover(bar, "Emoji", I.emoji, (pop, close) => {
			pop.classList.add("avuz-rte-emoji");
			EMOJIS.forEach((emoji) => {
				const e = document.createElement("button");
				e.type = "button";
				e.textContent = emoji;
				e.addEventListener("mousedown", (ev) => ev.preventDefault());
				e.addEventListener("click", () => { editor.chain().focus().insertContent(emoji).run(); close(); });
				pop.append(e);
			});
		}));

		// Full-screen document mode, pushed to the far right of the bar
		const spacer = document.createElement("span");
		spacer.className = "avuz-rte-spacer";
		const docToggle = button("Editar em tela cheia", I.expand, "avuz-rte-doc-toggle");
		docToggle.addEventListener("click", () => setDocMode(editorEl, editor, description, !editorEl.classList.contains("avuz-doc-mode")));
		bar.append(spacer, docToggle);

		// Reflect the selection: active marks/nodes, heading level, undo/redo
		const refresh = () => {
			for (const [b, isActive, can] of states) {
				if (isActive) {
					const on = !!isActive();
					b.classList.toggle("active", on);
					b.setAttribute("aria-pressed", String(on));
				}
				if (can) {
					b.disabled = !can();
				}
			}
			let level = "p";
			for (const l of [1, 2, 3, 4]) {
				if (editor.isActive("heading", { level: l })) {
					level = String(l);
				}
			}
			style.value = level;
		};
		editor.on("transaction", refresh);
		editor.on("selectionUpdate", refresh);
		refresh();

		document.addEventListener("mousedown", (e) => {
			if (!bar.contains(e.target)) {
				closeMenus(bar);
			}
		});

		return bar;
	}

	function enhance() {
		document.querySelectorAll(".ProseMirror").forEach((pm) => {
			const editorEl = pm.closest(".editor");
			const editor = pm.editor;
			if (!editorEl || !editor || editorEl.classList.contains("avuz-rte-on")) {
				return;
			}
			const description = findDescription(pm);
			if (!description || !description.canEdit) {
				return;
			}
			const menubar = editorEl.querySelector(".text-menubar");
			const bar = buildToolbar(editor, description, editorEl);
			if (menubar) {
				menubar.before(bar);
			} else {
				editorEl.prepend(bar);
			}
			bar.before(buildDocHead(editorEl, editor, description));
			editorEl.classList.add("avuz-rte-on");
		});
	}

	// Esc leaves document mode first (instead of closing the whole card)
	document.addEventListener("keydown", (event) => {
		if (event.key !== "Escape") {
			return;
		}
		const open = document.querySelector(".editor.avuz-doc-mode");
		if (!open || event.target.closest?.(".avuz-rte-pop")) {
			return;
		}
		event.preventDefault();
		event.stopImmediatePropagation();
		const pm = open.querySelector(".ProseMirror");
		const description = pm && findDescription(pm);
		if (pm?.editor && description) {
			setDocMode(open, pm.editor, description, false);
		}
	}, true);

	new MutationObserver(enhance).observe(document.documentElement, { childList: true, subtree: true });
	enhance();
})();
