/**
 * Lucide Icons Integration
 * Replaces app menu icons with Lucide icons using data-lucide attributes
 * Also updates favicon to match current app's Lucide icon
 */

// Map of app hrefs to icon names (shared between icon replacement and favicon)
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
	deck: "square-kanban",
	forms: "layout-list",
	activity: "activity",
};

// Create a hidden container once for rendering favicons
let faviconRenderer = null;
function getFaviconRenderer() {
	if (!faviconRenderer) {
		faviconRenderer = document.createElement("div");
		faviconRenderer.id = "lucide-favicon-renderer";
		faviconRenderer.style.position = "absolute";
		faviconRenderer.style.left = "-9999px";
		faviconRenderer.style.top = "-9999px";
		document.body.appendChild(faviconRenderer);
	}
	return faviconRenderer;
}

/**
 * Generate SVG favicon from Lucide icon and set it
 */
function setLucideFavicon(iconName) {
	if (typeof lucide === "undefined" || !iconName) {
		return;
	}

	const renderer = getFaviconRenderer();

	// Set the icon to be rendered
	renderer.innerHTML = `<i data-lucide="${iconName}"></i>`;

	// Let Lucide render it
	lucide.createIcons();

	// Get the SVG from our specific renderer
	const svg = renderer.querySelector("svg");

	if (svg) {
		// Clone and modify for favicon
		const clone = svg.cloneNode(true);
		clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
		clone.setAttribute("width", "32");
		clone.setAttribute("height", "32");
		clone.setAttribute("stroke", "#2bb5e3"); // Use app brand color

		const svgString = new XMLSerializer().serializeToString(clone);
		const dataUrl = `data:image/svg+xml;base64,${btoa(svgString)}`;

		// Update all favicon links
		document.querySelectorAll('link[rel*="icon"]').forEach((link) => {
			link.href = dataUrl;
		});
	}

	// Clean up the renderer for the next use
	renderer.innerHTML = "";
}

/**
 * Detect current app from URL and set appropriate favicon
 */
function updateFaviconForCurrentApp() {
	const path = window.location.pathname;

	for (const [app, iconName] of Object.entries(iconMap)) {
		if (path.includes(`/apps/${app}`)) {
			setLucideFavicon(iconName);
			return;
		}
	}

	// Default favicon for non-app pages (e.g., dashboard)
	if (path === "/" || path.includes("/index.php")) {
		setLucideFavicon("layout-dashboard");
	}
}

function initializeLucideIcons() {
	// Wait for lucide library to be available
	if (typeof lucide === "undefined") {
		setTimeout(initializeLucideIcons, 50);
		return;
	}

	// Flag to prevent infinite observer loops
	let isProcessing = false;

	// Function to replace icons
	function replaceIcons() {
		if (isProcessing) return;
		isProcessing = true;

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

		// Reset flag after a delay
		setTimeout(() => {
			isProcessing = false;
		}, 100);
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

	// Function to replace contacts icon
	function replaceContactsIcon() {
		const iconContainer = document.querySelector(
			"#contactsmenu .contactsmenu__trigger-icon"
		);
		if (iconContainer && !iconContainer.hasAttribute("data-lucide")) {
			const svg = iconContainer.querySelector("svg");
			if (svg) svg.remove();
			iconContainer.setAttribute("data-lucide", "square-user");
			lucide.createIcons();
		}
	}

	// Watch for contacts menu to appear
	const headerObserver = new MutationObserver(() => {
		const contactsMenu = document.querySelector("#contactsmenu");
		if (contactsMenu) {
			replaceContactsIcon();
			// Keep watching in case it gets recreated
		}
	});

	// Start observing the header for contacts menu
	const header = document.querySelector("#header");
	if (header) {
		headerObserver.observe(header, {
			childList: true,
			subtree: true,
		});
	}

	// Also try immediately in case it's already there
	replaceContactsIcon();

	// --- Efficient SPA Navigation Detection & Favicon Update ---

	// Update favicon on initial load
	updateFaviconForCurrentApp();

	// Listen for popstate (browser back/forward)
	window.addEventListener("popstate", updateFaviconForCurrentApp);

	// Nextcloud's client-side router uses history.pushState(). We wrap it to
	// trigger our favicon update logic whenever the URL changes without a full
	// page reload. This is more efficient than a MutationObserver.
	const originalPushState = history.pushState;
	history.pushState = function (...args) {
		originalPushState.apply(this, args);
		updateFaviconForCurrentApp();
	};

	// Also wrap replaceState for completeness, as it can also change the URL
	const originalReplaceState = history.replaceState;
	history.replaceState = function (...args) {
		originalReplaceState.apply(this, args);
		updateFaviconForCurrentApp();
	};
}

// Start initialization
initializeLucideIcons();
