/**
 * Lucide Favicon Integration
 * Updates browser tab favicon to match current app's Lucide icon
 * App menu icons are now handled via theme SVG overrides
 */

// Map of app paths to Lucide icon names
const iconMap = {
	dashboard: "layout-dashboard",
	files: "folder",
	calendar: "calendar",
	contacts: "users",
	mail: "mail",
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
		clone.setAttribute("stroke", "#2bb5e3");

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

	// Default favicon for dashboard/home
	if (path === "/" || path.includes("/index.php")) {
		setLucideFavicon("layout-dashboard");
	}
}

function initializeLucideFavicon() {
	// Wait for lucide library to be available
	if (typeof lucide === "undefined") {
		setTimeout(initializeLucideFavicon, 50);
		return;
	}

	// Update favicon on initial load
	updateFaviconForCurrentApp();

	// Listen for popstate (browser back/forward)
	window.addEventListener("popstate", updateFaviconForCurrentApp);

	// Wrap history.pushState to detect SPA navigation
	const originalPushState = history.pushState;
	history.pushState = function (...args) {
		originalPushState.apply(this, args);
		updateFaviconForCurrentApp();
	};

	// Wrap history.replaceState for completeness
	const originalReplaceState = history.replaceState;
	history.replaceState = function (...args) {
		originalReplaceState.apply(this, args);
		updateFaviconForCurrentApp();
	};
}

// Start initialization
initializeLucideFavicon();
