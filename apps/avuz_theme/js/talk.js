/**
 * Talk — additions for the modern chat layout (css/talk.css)
 *
 * - "Reunião" button above the conversation list: does what Talk's own
 *   "Iniciar reunião agora" does (creates a public instant-meeting
 *   conversation and opens it with #direct-call, which shows the join-call
 *   dialog).
 * - Search behind a magnifier button next to "Reunião": opens the search field
 *   (with the filter) below, closes on Escape or when left empty.
 * - "Conversas" caption above the conversation list.
 * Talk re-renders its sidebar, so both are re-added when missing.
 */
(function () {
	"use strict";

	if (!/\/(apps\/spreed|call)(\/|$)/.test(location.pathname)) {
		return;
	}

	const OCS = { "OCS-APIRequest": "true", Accept: "application/json", "Content-Type": "application/json" };

	async function startMeeting(button) {
		button.disabled = true;
		try {
			const now = new Date();
			const name = "Reunião " + now.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
				+ " " + now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
			const response = await fetch(OC.linkToOCS("apps/spreed/api/v4", 2) + "room?format=json", {
				method: "POST",
				headers: { ...OCS, requesttoken: OC.requestToken },
				body: JSON.stringify({
					roomType: 3, // public
					roomName: name,
					objectType: "instant_meeting",
					objectId: String(Math.floor(Date.now() / 1000)),
				}),
			});
			if (!response.ok) {
				throw new Error(response.status);
			}
			const token = (await response.json()).ocs.data.token;
			window.location.href = OC.generateUrl("/call/" + token) + "#direct-call";
		} catch (error) {
			console.error("[avuz] could not start meeting", error);
			OC.Notification.showTemporary("Não foi possível iniciar a reunião.");
			button.disabled = false;
		}
	}

	const searchInput = (top) => top.querySelector(".conversations-search input");

	// The search field is hidden behind a magnifier button (css/talk.css)
	function setSearchOpen(top, open, focus = true) {
		top.classList.toggle("avuz-search-open", open);
		top.querySelector(".avuz-talk-search-toggle")?.setAttribute("aria-expanded", String(open));
		if (open && focus) {
			setTimeout(() => searchInput(top)?.focus(), 0);
		}
	}

	function ensure() {
		const top = document.querySelector(".app-talk .new-conversation");
		if (top && !top.querySelector(".avuz-talk-meet")) {
			const button = document.createElement("button");
			button.type = "button";
			button.className = "avuz-talk-meet";
			button.innerHTML = '<span class="avuz-talk-meet__icon" aria-hidden="true"></span>Reunião';
			button.title = "Iniciar uma reunião agora";
			button.addEventListener("click", () => startMeeting(button));
			top.prepend(button);
		}

		if (top && !top.querySelector(".avuz-talk-search-toggle")) {
			const toggle = document.createElement("button");
			toggle.type = "button";
			toggle.className = "avuz-talk-search-toggle";
			toggle.title = "Pesquisar conversas";
			toggle.setAttribute("aria-label", "Pesquisar conversas");
			toggle.setAttribute("aria-expanded", "false");
			toggle.innerHTML = '<span class="avuz-talk-search-toggle__icon" aria-hidden="true"></span>';
			toggle.addEventListener("click", () => setSearchOpen(top, !top.classList.contains("avuz-search-open")));
			top.append(toggle);
		}
		if (top && !top.dataset.avuzSearchBound) {
			top.dataset.avuzSearchBound = "1";
			// Close on Escape, or when focus leaves an empty field
			top.addEventListener("keydown", (event) => {
				if (event.key === "Escape" && top.classList.contains("avuz-search-open")) {
					setSearchOpen(top, false);
					top.querySelector(".avuz-talk-search-toggle")?.focus();
				}
			});
			top.addEventListener("focusout", () => {
				setTimeout(() => {
					const input = searchInput(top);
					if (!top.contains(document.activeElement) && input && !input.value) {
						setSearchOpen(top, false);
					}
				}, 150);
			});
		}
		// Keep it open while a search term is applied
		if (top && searchInput(top)?.value && !top.classList.contains("avuz-search-open")) {
			setSearchOpen(top, true, false);
		}

		const list = document.querySelector(".app-talk .app-navigation .app-navigation-list .scroller > ul, .app-talk .app-navigation .scroller ul");
		if (list && !list.querySelector(":scope > .avuz-talk-caption")) {
			const caption = document.createElement("li");
			caption.className = "avuz-talk-caption";
			caption.setAttribute("aria-hidden", "true");
			caption.textContent = "Conversas";
			list.prepend(caption);
		}
	}

	new MutationObserver(ensure).observe(document.documentElement, { childList: true, subtree: true });
	ensure();
})();
