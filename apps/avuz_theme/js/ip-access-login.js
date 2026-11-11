/**
 * Login page: when the last login/session was refused by "Restrição de acesso
 * por IP" (lib/Service/IpAccess.php sets the avuz_ip_blocked cookie), show why
 * above the form instead of Nextcloud's generic "Login canceled by app".
 */
(function () {
	"use strict";

	const match = document.cookie.match(/(?:^|;\s*)avuz_ip_blocked=([^;]+)/);
	if (!match) {
		return;
	}
	const ip = decodeURIComponent(match[1]);
	document.cookie = "avuz_ip_blocked=; Max-Age=0; path=/; SameSite=Lax";

	const show = () => {
		const form = document.querySelector("form[name='login'], .login-form, #login form, main form");
		if (!form || document.querySelector(".avuz-ip-blocked")) {
			return !!form;
		}
		// Nextcloud's own generic message is replaced by ours
		document.querySelectorAll(".notecard--error, .login-form .warning, .login-form [role='alert']").forEach((el) => {
			if (/cancel|cancelad/i.test(el.textContent)) {
				el.remove();
			}
		});
		const note = document.createElement("div");
		note.className = "avuz-ip-blocked";
		note.setAttribute("role", "alert");
		note.style.cssText = "margin:0 0 14px;padding:12px 14px;border-radius:10px;background:#fdecea;color:#a12b22;font-size:14px;line-height:1.45;text-align:left";
		note.innerHTML = "<strong>Acesso bloqueado por IP.</strong><br>Sua conta só pode acessar o Avuz Conecta a partir de um endereço autorizado. Seu IP atual: <strong></strong>. Fale com o administrador.";
		note.querySelector("strong:last-of-type").textContent = ip;
		form.prepend(note);
		return true;
	};
	if (!show()) {
		const observer = new MutationObserver(() => show() && observer.disconnect());
		observer.observe(document.documentElement, { childList: true, subtree: true });
	}
})();
