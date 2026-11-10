/**
 * Deck (Tarefas): "Novo painel" dialog
 *
 * "Adicionar painel" in the navigation used to turn into a small title field;
 * sharing, labels and lists could only be set up afterwards in the board
 * details. This intercepts it and opens a centred dialog (same look as the
 * "Novo cartão" dialog, css/deck-new-card.css + css/deck-new-board.css) to set
 * everything at once: title, colour, folder, initial lists, labels and the
 * people/groups/teams to share with and their permissions.
 *
 * Creation uses Deck's own endpoints: POST /boards (Deck adds its 4 default
 * labels; the ones left unselected are deleted), /labels, /stacks and
 * /boards/{id}/acl. The full board is then committed to Deck's store
 * (addBoard) and opened.
 */
(function () {
	"use strict";

	const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

	const COLORS = ["0082c9", "1f8a70", "31cc7c", "f1db50", "ff7a66", "e9322d", "c2185b", "8e44ad", "317ccc", "4d535c"];
	// Deck creates these on every new board (BoardService::create)
	const DEFAULT_LABELS = [
		{ color: "31CC7C", title: "Terminado" },
		{ color: "317CCC", title: "Para revisão" },
		{ color: "FF7A66", title: "Ação necessária" },
		{ color: "F1DB50", title: "Depois" },
	];
	const DEFAULT_LISTS = ["A fazer", "Em andamento", "Concluído"];
	const SHARE_KIND = { 0: "", 1: "grupo", 7: "equipe" };

	function deckRoot() {
		const root = document.querySelector(".app-deck");
		for (let vm = root && root.__vue__; vm; vm = vm.$parent) {
			if (vm.$store) {
				return vm;
			}
		}
		return null;
	}

	function initials(name) {
		const parts = String(name || "?").trim().split(/\s+/);
		return ((parts[0]?.[0] || "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
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
		return response.status === 204 ? null : response.json();
	}

	async function searchSharees(term) {
		const params = new URLSearchParams({ search: term, format: "json", perPage: term ? "20" : "50", itemType: "0,1,4,7", lookup: "false" });
		const response = await fetch(OC.linkToOCS("apps/files_sharing/api/v1", 2) + "sharees?" + params, {
			headers: { "OCS-APIRequest": "true", Accept: "application/json" },
		});
		const data = (await response.json()).ocs.data;
		const me = OC.getCurrentUser().uid;
		const seen = new Set();
		return [...data.exact.users, ...data.exact.groups, ...data.exact.circles, ...data.users, ...data.groups, ...data.circles]
			.map((r) => ({ type: r.value.shareType, id: r.value.shareWith, name: r.label, sub: r.shareWithDisplayNameUnique || "" }))
			.filter((r) => [0, 1, 7].includes(r.type) && !(r.type === 0 && r.id === me))
			.filter((r) => !seen.has(r.type + ":" + r.id) && seen.add(r.type + ":" + r.id));
	}

	function openDialog(root) {
		const store = root.$store;
		const folders = store.state.folders || [];
		const color = COLORS[Math.floor(Math.random() * COLORS.length)];

		const overlay = document.createElement("div");
		overlay.className = "avuz-nc-overlay";
		overlay.innerHTML = `
			<form class="avuz-nc avuz-nb" role="dialog" aria-modal="true" aria-labelledby="avuz-nb-title" novalidate>
				<header class="avuz-nc__head">
					<h2 id="avuz-nb-title">Novo painel</h2>
					<button type="button" class="avuz-nc__x" aria-label="Fechar">×</button>
				</header>
				<div class="avuz-nc__body">
					<div class="avuz-nb__titlerow">
						<span class="avuz-nb__dot" style="--c:#${color}"></span>
						<textarea class="avuz-nc__title" name="title" rows="1" placeholder="Nome do painel" autocomplete="off" required></textarea>
					</div>
					<div class="avuz-nc__field">
						<span>Cor</span>
						<div class="avuz-nb__colors" role="radiogroup" aria-label="Cor do painel">
							${COLORS.map((c) => `<button type="button" role="radio" class="avuz-nb__color" data-color="${c}" style="--c:#${c}" aria-checked="${c === color}" aria-label="#${c}"></button>`).join("")}
							<label class="avuz-nb__color avuz-nb__color--custom" title="Outra cor"><input type="color" value="#${color}" aria-label="Outra cor"></label>
						</div>
					</div>
					${folders.length ? `
					<label class="avuz-nc__field">
						<span>Pasta</span>
						<select name="folder"><option value="">Sem pasta</option>${folders.map((f) => `<option value="${f.id}">${esc(f.title || f.name)}</option>`).join("")}</select>
					</label>` : ""}
					<div class="avuz-nc__field">
						<span>Listas</span>
						<ul class="avuz-nc__subtasks avuz-nb__lists"></ul>
						<input class="avuz-nc__subtask-new avuz-nb__list-new" placeholder="Adicionar lista e pressionar Enter" aria-label="Nova lista" autocomplete="off">
					</div>
					<div class="avuz-nc__field">
						<span>Etiquetas</span>
						<div class="avuz-nc__chips avuz-nb__labels">
							${DEFAULT_LABELS.map((l) => `<button type="button" class="avuz-nc__chip avuz-nc__label" data-default="${l.color}" style="--c:#${l.color}" aria-pressed="true"><i></i>${esc(l.title)}</button>`).join("")}
						</div>
						<div class="avuz-nb__newlabel">
							<input type="color" value="#8e44ad" aria-label="Cor da etiqueta">
							<input class="avuz-nc__filter" placeholder="Nova etiqueta (ex.: Urgente)" aria-label="Nova etiqueta" autocomplete="off">
							<button type="button" class="avuz-nb__add">Adicionar</button>
						</div>
					</div>
					<div class="avuz-nc__field">
						<span>Compartilhar com</span>
						<div class="avuz-nb__search">
							<input class="avuz-nc__filter" placeholder="Buscar pessoas, grupos ou equipes…" aria-label="Buscar pessoas, grupos ou equipes" autocomplete="off">
							<ul class="avuz-nb__results" role="listbox" hidden></ul>
						</div>
						<ul class="avuz-nb__shares"></ul>
					</div>
					<p class="avuz-nc__error" hidden></p>
				</div>
				<footer class="avuz-nc__foot">
					<span class="avuz-nc__hint">Ctrl+Enter para criar</span>
					<button type="button" class="avuz-nc__cancel">Cancelar</button>
					<button type="submit" class="avuz-nc__create">Criar painel</button>
				</footer>
			</form>`;
		document.body.append(overlay);

		const form = overlay.querySelector("form");
		const title = form.querySelector(".avuz-nc__title");
		const error = form.querySelector(".avuz-nc__error");
		const close = () => {
			overlay.remove();
			document.removeEventListener("keydown", onKey, true);
		};
		const onKey = (e) => {
			if (e.key === "Escape") {
				e.preventDefault();
				e.stopImmediatePropagation();
				if (!results.hidden) {
					results.hidden = true;
				} else {
					close();
				}
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
		// Plain Enter in a single-line field must not submit the form
		form.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && e.target.matches("input:not([type=color])")) {
				e.preventDefault();
			}
		});

		// Title: wraps and grows, stays one line of text
		const growTitle = () => {
			title.style.height = "auto";
			title.style.height = title.scrollHeight + "px";
		};
		title.addEventListener("input", () => {
			if (/[\r\n]/.test(title.value)) {
				title.value = title.value.replace(/\s*[\r\n]+\s*/g, " ");
			}
			title.classList.remove("invalid");
			growTitle();
		});
		title.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
				e.preventDefault();
			}
		});

		// Colour: swatches or a custom colour
		let boardColor = color;
		const dot = form.querySelector(".avuz-nb__dot");
		const customColor = form.querySelector(".avuz-nb__color--custom input");
		const setColor = (c) => {
			boardColor = c.replace("#", "").toLowerCase();
			dot.style.setProperty("--c", "#" + boardColor);
			form.querySelectorAll(".avuz-nb__color[data-color]").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.color === boardColor)));
			customColor.parentElement.classList.toggle("on", !COLORS.includes(boardColor));
		};
		form.querySelectorAll(".avuz-nb__color[data-color]").forEach((b) => b.addEventListener("click", () => setColor(b.dataset.color)));
		customColor.addEventListener("input", () => setColor(customColor.value));

		// Lists: editable rows, Enter adds, × removes
		const lists = form.querySelector(".avuz-nb__lists");
		const listNew = form.querySelector(".avuz-nb__list-new");
		const addList = (text) => {
			const li = document.createElement("li");
			li.innerHTML = '<i class="avuz-nb__grip" aria-hidden="true"></i><input aria-label="Lista"><button type="button" aria-label="Remover lista">×</button>';
			li.querySelector("input").value = text;
			li.querySelector("button").addEventListener("click", () => li.remove());
			lists.append(li);
		};
		DEFAULT_LISTS.forEach(addList);
		listNew.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && listNew.value.trim()) {
				addList(listNew.value.trim());
				listNew.value = "";
			}
		});
		const listTitles = () => [...lists.querySelectorAll("input"), listNew].map((i) => i.value.trim()).filter(Boolean);

		// Labels: Deck's defaults can be switched off, new ones added
		const labelBox = form.querySelector(".avuz-nb__labels");
		const [labelColor, labelName] = form.querySelectorAll(".avuz-nb__newlabel input");
		const addLabel = () => {
			const name = labelName.value.trim();
			if (!name) {
				labelName.focus();
				return;
			}
			const c = labelColor.value.replace("#", "");
			const chip = document.createElement("span");
			chip.className = "avuz-nb__custom";
			chip.style.setProperty("--c", "#" + c);
			chip.dataset.color = c;
			chip.dataset.title = name;
			chip.innerHTML = `<i></i>${esc(name)}<button type="button" aria-label="Remover etiqueta ${esc(name)}">×</button>`;
			chip.querySelector("button").addEventListener("click", () => chip.remove());
			labelBox.append(chip);
			labelName.value = "";
			labelName.focus();
		};
		form.querySelector(".avuz-nb__add").addEventListener("click", addLabel);
		labelName.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				addLabel();
			}
		});
		labelBox.querySelectorAll(".avuz-nc__label").forEach((chip) => {
			chip.addEventListener("click", () => chip.setAttribute("aria-pressed", String(chip.getAttribute("aria-pressed") !== "true")));
		});

		// Sharing: search users/groups/teams, then set permissions per person
		const search = form.querySelector(".avuz-nb__search input");
		const results = form.querySelector(".avuz-nb__results");
		const shares = form.querySelector(".avuz-nb__shares");
		const chosen = new Map();
		let searchSeq = 0;
		let timer;
		let shown = [];
		let active = 0;
		const highlight = (i) => {
			const options = results.querySelectorAll("li[data-i]");
			active = Math.max(0, Math.min(i, options.length - 1));
			options.forEach((li, n) => li.classList.toggle("active", n === active));
			options[active]?.scrollIntoView({ block: "nearest" });
		};
		const pick = (r) => {
			addShare(r);
			search.value = "";
			search.focus();
			refresh(); // keep the list open to add more people
		};
		const renderResults = (items, term) => {
			shown = items.filter((r) => !chosen.has(r.type + ":" + r.id));
			results.innerHTML = (term ? "" : '<li class="head">Seus contatos</li>') + (shown.length
				? shown.map((r, i) => `<li role="option" data-i="${i}"><b>${esc(initials(r.name))}</b><span>${esc(r.name)}${SHARE_KIND[r.type] ? ` <small>${SHARE_KIND[r.type]}</small>` : ""}</span>${r.sub && r.sub !== r.name ? `<em>${esc(r.sub)}</em>` : ""}</li>`).join("")
				: `<li class="none">${term ? "Ninguém encontrado" : "Nenhum contato disponível"}</li>`);
			results.hidden = false;
			results.querySelectorAll("li[data-i]").forEach((li) => {
				li.addEventListener("mousedown", (e) => {
					e.preventDefault();
					pick(shown[Number(li.dataset.i)]);
				});
				li.addEventListener("mousemove", () => highlight(Number(li.dataset.i)));
			});
			highlight(0);
			results.closest(".avuz-nb__search").scrollIntoView({ block: "nearest" });
		};
		// Empty field: list the contacts (users, groups, teams) right away;
		// typing narrows it down
		const refresh = (delay = 0) => {
			clearTimeout(timer);
			timer = setTimeout(async () => {
				const seq = ++searchSeq;
				const term = search.value.trim();
				try {
					const items = await searchSharees(term);
					if (seq === searchSeq && document.activeElement === search) {
						renderResults(items, term);
					}
				} catch (err) {
					console.error("[avuz] sharee search failed", err);
				}
			}, delay);
		};
		search.addEventListener("focus", () => refresh());
		search.addEventListener("click", () => results.hidden && refresh());
		search.addEventListener("input", () => refresh(200));
		search.addEventListener("keydown", (e) => {
			if (e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				if (results.hidden) {
					refresh();
				} else {
					highlight(active + (e.key === "ArrowDown" ? 1 : -1));
				}
			} else if (e.key === "Enter" && !results.hidden && shown[active]) {
				pick(shown[active]);
			}
		});
		search.addEventListener("blur", () => setTimeout(() => (results.hidden = true), 150));

		const PERMS = [
			["edit", "Editar", true],
			["share", "Compartilhar", false],
			["manage", "Gerenciar", false],
			["onlyAssigned", "Só cartões atribuídos", false],
		];
		function addShare(r) {
			const key = r.type + ":" + r.id;
			const share = { ...r, edit: true, share: false, manage: false, onlyAssigned: false };
			chosen.set(key, share);
			const li = document.createElement("li");
			li.innerHTML = `
				<b>${esc(initials(r.name))}</b>
				<span class="avuz-nb__who">${esc(r.name)}${SHARE_KIND[r.type] ? ` <small>${SHARE_KIND[r.type]}</small>` : ""}</span>
				<span class="avuz-nb__perms">${PERMS.map(([k, label, on]) => `<button type="button" class="avuz-nb__perm" data-k="${k}" aria-pressed="${on}">${label}</button>`).join("")}</span>
				<button type="button" class="avuz-nb__remove" aria-label="Remover ${esc(r.name)}">×</button>`;
			li.querySelectorAll(".avuz-nb__perm").forEach((b) => {
				b.addEventListener("click", () => {
					share[b.dataset.k] = !share[b.dataset.k];
					// Managing implies editing and sharing, like Deck's sharing tab
					if (b.dataset.k === "manage" && share.manage) {
						share.edit = share.share = true;
					}
					li.querySelectorAll(".avuz-nb__perm").forEach((p) => p.setAttribute("aria-pressed", String(share[p.dataset.k])));
				});
			});
			li.querySelector(".avuz-nb__remove").addEventListener("click", () => {
				chosen.delete(key);
				li.remove();
			});
			shares.append(li);
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
			error.hidden = true;
			const failed = [];
			const step = (text) => (create.textContent = text);

			let board;
			try {
				step("Criando painel…");
				const folderId = Number(form.elements.folder?.value || 0);
				board = folderId
					? await store.dispatch("createBoardInFolder", { title: name, color: boardColor, folderId })
					: await api("POST", "/boards", { title: name, color: boardColor });
			} catch (err) {
				console.error("[avuz] create board failed", err);
				error.textContent = "Não foi possível criar o painel. " + (err.message || "");
				error.hidden = false;
				create.disabled = false;
				create.textContent = "Criar painel";
				return;
			}

			step("Configurando etiquetas…");
			const off = [...labelBox.querySelectorAll('.avuz-nc__label[aria-pressed="false"]')].map((c) => c.dataset.default.toUpperCase());
			for (const label of board.labels || []) {
				if (off.includes(String(label.color).toUpperCase())) {
					await api("DELETE", `/labels/${label.id}`).catch(() => failed.push(`remover “${label.title}”`));
				}
			}
			for (const chip of labelBox.querySelectorAll(".avuz-nb__custom")) {
				await api("POST", "/labels", { title: chip.dataset.title, color: chip.dataset.color, boardId: board.id }).catch(() => failed.push(`etiqueta “${chip.dataset.title}”`));
			}

			step("Criando listas…");
			for (const [order, text] of listTitles().entries()) {
				await api("POST", "/stacks", { title: text, boardId: board.id, order }).catch(() => failed.push(`lista “${text}”`));
			}

			if (chosen.size) {
				step("Compartilhando…");
			}
			for (const s of chosen.values()) {
				await api("POST", `/boards/${board.id}/acl`, {
					type: s.type,
					participant: s.id,
					permissionEdit: s.edit,
					permissionShare: s.share,
					permissionManage: s.manage,
					cardsOnlyAssigned: s.onlyAssigned,
				}).catch(() => failed.push(`compartilhar com ${s.name}`));
			}

			try {
				store.commit("addBoard", await api("GET", `/boards/${board.id}`));
			} catch (err) {
				store.commit("addBoard", board);
			}
			close();
			root.$router.push({ name: "board", params: { id: board.id } }).catch(() => {});
			if (failed.length) {
				OC.Notification.showTemporary(`Painel “${name}” criado, mas falhou: ${failed.join(", ")}.`, { type: "error" });
			} else {
				OC.Notification.showTemporary(`Painel “${name}” criado.`);
			}
		});

		setTimeout(() => title.focus(), 0);
	}

	// Intercept "Adicionar painel" in the navigation (not the one inside folders)
	document.addEventListener("click", (event) => {
		const link = event.target.closest?.('.app-navigation a.app-navigation-entry-link[title="Adicionar painel"], .app-navigation a.app-navigation-entry-link[title="Add board"]');
		if (!link || event.button !== 0 || !/\/apps\/deck(\/|$)/.test(location.pathname)) {
			return;
		}
		const root = deckRoot();
		if (!root || !root.$router) {
			return; // fall back to Deck's inline field
		}
		event.preventDefault();
		event.stopImmediatePropagation();
		openDialog(root);
	}, true);
})();
