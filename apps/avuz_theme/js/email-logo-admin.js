/**
 * Administração › Personalização › "Logo dos e-mails" (Deck #516;
 * lib/Settings/EmailLogoAdmin.php, lib/Controller/EmailLogoController.php).
 *
 * Shows the logo at the top of this tenant's e-mails, at the size mail clients
 * get it; uploads a new one (PNG/JPEG, up to 1 MB) or goes back to the Avuz
 * Conecta logo. Every change is saved right away.
 */
(function () {
	"use strict";

	const url = () => OC.generateUrl("/apps/avuz_theme/email-logo");
	const headers = () => ({ requesttoken: OC.requestToken, Accept: "application/json" });
	const parse = (value) => {
		try {
			return JSON.parse(value || "null");
		} catch (error) {
			return null;
		}
	};

	function mount(root) {
		const avuzLogo = parse(root.dataset.avuzLogo);
		let tenantLogo = parse(root.dataset.tenantLogo);
		let busy = false;

		root.innerHTML = `
			<h2 class="avuz-elogo__title">Logo dos e-mails</h2>
			<p class="avuz-elogo__desc">Aparece no topo de todos os e-mails que esta conta envia: convites da agenda, compartilhamentos, redefinição de senha e assinaturas. Sem um logo próprio, os e-mails usam o logo do Avuz Conecta.</p>
			<div class="avuz-elogo__preview">
				<img alt="">
				<span class="avuz-elogo__caption"></span>
			</div>
			<div class="avuz-elogo__actions">
				<input type="file" accept="image/png,image/jpeg" hidden>
				<button type="button" class="avuz-elogo__btn avuz-elogo__primary avuz-elogo__upload">Enviar logo</button>
				<button type="button" class="avuz-elogo__btn avuz-elogo__reset">Usar o logo do Avuz Conecta</button>
			</div>
			<p class="avuz-elogo__hint">PNG ou JPEG, até 1 MB. O logo é reduzido para caber em 140 × 56 pixels.</p>
			<p class="avuz-elogo__note avuz-elogo__error" role="alert" hidden></p>`;

		const $ = (selector) => root.querySelector(selector);
		const image = $(".avuz-elogo__preview img");
		const caption = $(".avuz-elogo__caption");
		const input = $("input[type=file]");
		const upload = $(".avuz-elogo__upload");
		const reset = $(".avuz-elogo__reset");
		const error = $(".avuz-elogo__error");

		function render() {
			const shown = tenantLogo || avuzLogo;
			image.src = shown.url;
			image.width = shown.width;
			image.height = shown.height;
			image.alt = tenantLogo ? "Logo dos e-mails desta conta" : "Logo do Avuz Conecta";
			caption.textContent = tenantLogo ? "Logo desta conta" : "Logo do Avuz Conecta (padrão)";
			reset.hidden = !tenantLogo;
			root.toggleAttribute("aria-busy", busy);
			upload.disabled = busy;
			reset.disabled = busy;
		}

		function showError(message) {
			error.textContent = message || "";
			error.hidden = !message;
		}

		async function send(request) {
			busy = true;
			showError("");
			render();
			try {
				const response = await request();
				const body = await response.json().catch(() => ({}));
				if (!response.ok) {
					showError(body.message || "Não foi possível salvar o logo. Tente de novo.");
					return;
				}
				tenantLogo = body.logo || null;
			} catch (requestError) {
				showError("Não foi possível salvar o logo. Verifique a conexão e tente de novo.");
			} finally {
				busy = false;
				render();
			}
		}

		upload.addEventListener("click", () => input.click());

		input.addEventListener("change", () => {
			const file = input.files && input.files[0];
			input.value = "";
			if (!file) {
				return;
			}
			const form = new FormData();
			form.append("logo", file);
			send(() => fetch(url(), { method: "POST", headers: headers(), body: form }));
		});

		reset.addEventListener("click", () => {
			send(() => fetch(url(), { method: "DELETE", headers: headers() }));
		});

		render();
	}

	function start() {
		const root = document.getElementById("avuz-email-logo");
		if (root) {
			mount(root);
		}
	}

	if (document.readyState === "loading") {
		document.addEventListener("DOMContentLoaded", start);
	} else {
		start();
	}
})();
