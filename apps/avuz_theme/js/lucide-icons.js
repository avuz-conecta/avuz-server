/**
 * Lucide Icons Integration
 * Replaces app menu icons with Lucide icons using data-lucide attributes
 */

function initializeLucideIcons() {
	// Wait for lucide library to be available
	if (typeof lucide === "undefined") {
		setTimeout(initializeLucideIcons, 50);
		return;
	}

	// Map of app hrefs to icon names
	const iconMap = {
		dashboard: "layout-dashboard",
		files: "folder",
		calendar: "calendar",
		contacts: "users",
		mail: "mail",
		tasks: "check-circle",
		notes: "file-text",
		photos: "image",
		spreed: "message-circle",
		settings: "settings",
	};

	// Function to replace icons
	function replaceIcons() {
		const appLinks = document.querySelectorAll(".app-menu-entry__link");

		appLinks.forEach((link) => {
			const href = link.getAttribute("href") || "";
			const iconContainer = link.querySelector(".app-menu-entry__icon");

			if (!iconContainer) return;

			// Skip if already processed
			if (iconContainer.hasAttribute("data-lucide")) return;

			// Find matching icon
			for (const [app, iconName] of Object.entries(iconMap)) {
				if (href.includes(app)) {
					// Remove the original icon image
					const originalIcon = iconContainer.querySelector(
						".app-menu-icon__icon"
					);
					if (originalIcon) {
						originalIcon.remove();
					}

					// Add data-lucide attribute
					iconContainer.setAttribute("data-lucide", iconName);

					break;
				}
			}
		});

		// Initialize Lucide icons
		lucide.createIcons();
	}

	// Wait for app menu to appear in DOM
	function waitForAppMenu() {
		const appMenu = document.querySelector(".app-menu");

		if (!appMenu) {
			setTimeout(waitForAppMenu, 100);
			return;
		}

		// Initial replacement
		replaceIcons();

		// Watch for DOM changes (for SPA navigation)
		const observer = new MutationObserver(() => {
			replaceIcons();
		});

		observer.observe(appMenu, {
			childList: true,
			subtree: true,
		});
	}

	// Start waiting for app menu
	waitForAppMenu();
}

// Start initialization
initializeLucideIcons();
