/**
 * Administração › Segurança › "Restrição de acesso por IP"
 * (lib/Settings/IpAccessAdmin.php, lib/Controller/IpAccessController.php).
 *
 * On/off switch, the allowlist (IP or CIDR range + description), "Seu IP
 * atual" with "Adicionar meu IP". Every change is saved right away. Admins
 * are never blocked, so this cannot lock the admin out.
 */
(function () {
	"use strict";

	const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
	const url = () => OC.generateUrl("/apps/avuz_theme/ip-access");
	const headers = () => ({ requesttoken: OC.requestToken, Accept: "application/json", "Content-Type": "application/json" });

	function mount(root) {
		let state = { enabled: false, rules: [], currentIp: "", currentIpAllowed: false };
		let busy = false;

		// Same structure as the native NcSettingsSection blocks on this page
		// (title, description, switch), so it reads as one more section.
		root.innerHTML = `
			<h2 class="avuz-ipa__title">Restrição de acesso por IP</h2>
			<p class="avuz-ipa__desc">Usuários só entram de um IP/faixa autorizado. Administradores acessam de qualquer lugar. A regra vale para o navegador, os aplicativos de celular e de computador e a sincronização (WebDAV/CalDAV/CardDAV).</p>
			<label class="avuz-ipa__switch">
				<input type="checkbox" role="switch">
				<span class="avuz-ipa__track" aria-hidden="true"></span>
				<span>Ativar a restrição de acesso por IP</span>
			</label>
			<p class="avuz-ipa__note avuz-ipa__warn" role="note" hidden></p>
			<div class="avuz-ipa__body">
				<h3>IPs e faixas autorizados</h3>
				<p class="avuz-ipa__me">
					<span>Seu IP atual: <strong class="avuz-ipa__ip">…</strong></span>
					<button type="button" class="avuz-ipa__btn avuz-ipa__addme">Adicionar meu IP</button>
				</p>
				<ul class="avuz-ipa__list"></ul>
				<p class="avuz-ipa__empty">Nenhum IP/faixa cadastrado ainda.</p>
				<form class="avuz-ipa__add">
					<input name="range" placeholder="IP ou faixa (ex.: 200.150.30.42 ou 200.150.30.0/24)" autocomplete="off" aria-label="IP ou faixa">
					<input name="description" placeholder="Descrição (opcional, ex.: Escritório)" autocomplete="off" aria-label="Descrição">
					<button type="submit" class="avuz-ipa__btn avuz-ipa__primary" disabled>Adicionar</button>
				</form>
				<p class="avuz-ipa__hint">Aceita IPv4/IPv6 e faixas no formato CIDR.</p>
				<p class="avuz-ipa__note avuz-ipa__error" role="alert" hidden></p>
			</div>`;

		const $ = (s) => root.querySelector(s);
		const toggle = $(".avuz-ipa__switch input");
		const form = $(".avuz-ipa__add");
		const error = $(".avuz-ipa__error");

		function render() {
			toggle.checked = state.enabled;
			$(".avuz-ipa__ip").textContent = state.currentIp || "—";
			$(".avuz-ipa__addme").hidden = !state.currentIp || state.currentIpAllowed;
			$(".avuz-ipa__empty").hidden = state.rules.length > 0;
			$(".avuz-ipa__list").innerHTML = state.rules.map((r, i) => `
				<li>
					<code>${esc(r.range)}</code>
					<span>${esc(r.description) || '<em>Sem descrição</em>'}</span>
					<button type="button" class="avuz-ipa__remove" data-i="${i}" aria-label="Remover ${esc(r.range)}" title="Remover">×</button>
				</li>`).join("");
			const warn = $(".avuz-ipa__warn");
			if (state.enabled && state.rules.length === 0) {
				warn.textContent = "A restrição está ativa sem nenhum IP cadastrado: apenas administradores conseguem entrar.";
				warn.hidden = false;
			} else {
				warn.hidden = true;
			}
		}

		async function save(next) {
			if (busy) {
				return false;
			}
			busy = true;
			error.hidden = true;
			try {
				const response = await fetch(url(), { method: "PUT", headers: headers(), body: JSON.stringify(next) });
				const data = await response.json().catch(() => ({}));
				if (!response.ok) {
					throw new Error(data.message || "Não foi possível salvar.");
				}
				state = data;
				render();
				return true;
			} catch (e) {
				error.textContent = e.message;
				error.hidden = false;
				render();
				return false;
			} finally {
				busy = false;
			}
		}

		toggle.addEventListener("change", () => save({ enabled: toggle.checked, rules: state.rules }));
		$(".avuz-ipa__addme").addEventListener("click", () => save({ enabled: state.enabled, rules: [...state.rules, { range: state.currentIp, description: "Adicionado pelo administrador" }] }));
		$(".avuz-ipa__list").addEventListener("click", (e) => {
			const b = e.target.closest(".avuz-ipa__remove");
			if (b) {
				save({ enabled: state.enabled, rules: state.rules.filter((_, i) => i !== Number(b.dataset.i)) });
			}
		});
		form.range.addEventListener("input", () => {
			form.querySelector("button").disabled = !form.range.value.trim();
		});
		form.addEventListener("submit", async (e) => {
			e.preventDefault();
			const range = form.range.value.trim();
			if (!range) {
				return;
			}
			if (await save({ enabled: state.enabled, rules: [...state.rules, { range, description: form.description.value.trim() }] })) {
				form.reset();
				form.querySelector("button").disabled = true;
				form.range.focus();
			}
		});

		fetch(url(), { headers: headers() }).then((r) => r.json()).then((data) => {
			state = data;
			render();
		});
	}

	const start = () => {
		const root = document.getElementById("avuz-ip-access");
		if (root && !root.dataset.mounted) {
			root.dataset.mounted = "1";
			mount(root);
		}
	};
	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", start);
	} else {
		start();
	}
})();
