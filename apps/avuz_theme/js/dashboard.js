/**
 * Dashboard: today's date under the greeting ("terça-feira, 21 de outubro"),
 * css/dashboard.css styles it.
 */
(function () {
	"use strict";

	if (!/\/apps\/dashboard(\/|$)/.test(location.pathname)) {
		return;
	}

	const add = () => {
		const greeting = document.querySelector("#app-dashboard > h2");
		if (!greeting || greeting.nextElementSibling?.classList.contains("avuz-dash-date")) {
			return;
		}
		const date = document.createElement("p");
		date.className = "avuz-dash-date";
		date.textContent = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
		greeting.after(date);
	};

	new MutationObserver(add).observe(document.documentElement, { childList: true, subtree: true });
	add();
})();
