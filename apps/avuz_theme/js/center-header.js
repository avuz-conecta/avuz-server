/**
 * Center header app menu by matching logo and header-end widths
 */
(function () {
	"use strict";

	function centerAppMenu() {
		const header = document.getElementById("header");
		if (!header) {
			// Header not ready yet, try again soon
			setTimeout(centerAppMenu, 50);
			return;
		}

		const headerEnd = header.querySelector(".header-end");
		const nextcloudLogo = header.querySelector("#nextcloud");
		const appMenu = header.querySelector(".app-menu");

		if (!headerEnd || !nextcloudLogo || !appMenu) {
			// Elements not ready yet, try again soon
			setTimeout(centerAppMenu, 50);
			return;
		}

		// Use requestAnimationFrame to ensure layout is complete
		requestAnimationFrame(() => {
			// Get the width of header-end after layout
			const headerEndWidth = headerEnd.offsetWidth;

			// Set the same width to the logo container
			nextcloudLogo.style.width = headerEndWidth + "px";
			nextcloudLogo.style.flexShrink = "0";

			// Show the app menu with fade-in effect
			appMenu.classList.add("centered");
		});
	}

	// Run immediately - script executes on every page load/navigation
	centerAppMenu();

	// Re-run on window resize
	window.addEventListener("resize", centerAppMenu);
})();
