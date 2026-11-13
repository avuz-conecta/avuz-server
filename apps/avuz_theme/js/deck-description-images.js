/**
 * Deck (Tarefas): images in card descriptions
 *
 * 1. Paste screenshots into a card description.
 * The description editor is Nextcloud Text embedded through
 * OCA.Text.createEditor, which only wires "insert file" to Deck's
 * attachment picker — pasting an image does nothing. Here a pasted image is
 * uploaded as a card attachment (same endpoint and `type: file` as Deck's own
 * upload button) and then inserted at the cursor with Deck's own
 * Description.addAttachment(), exactly like picking it from the attachment
 * modal. Text pastes are left alone.
 *
 * 2. Show images in the description at all. Text only creates its
 * AttachmentResolver for file-backed editors (`if (this.fileId)` in
 * MarkdownContentEditor), so in Deck's description every image node's
 * mounted() throws on a null resolver and stays as a spinner forever — also
 * for images inserted through Deck's own attachment button. Deck only ever
 * inserts same-instance URLs (/core/preview, /apps/deck/cards/...), so such
 * stuck nodes get that URL as their resolved attachment and are told to load.
 *
 * 3. Resize images. Markdown has no image size, so the chosen width is kept
 * in the image URL itself as an extra `avuzw` query parameter (ignored by the
 * server, saved with the description). A corner handle on the image sets it
 * by dragging; css/deck-description-images.css styles the handle.
 */
(function () {
	"use strict";

	// Deck is a Vue 2 app: walk from the pasted-into node to the Description
	// component (it owns the editor and addAttachment()).
	function findDescription(node) {
		for (let el = node; el; el = el.parentElement) {
			for (let vm = el.__vue__; vm; vm = vm.$parent) {
				if (typeof vm.addAttachment === "function" && vm.editor && vm.card) {
					return vm;
				}
			}
		}
		return null;
	}

	function pastedImages(event) {
		const items = event.clipboardData ? Array.from(event.clipboardData.items) : [];
		return items
			.filter((item) => item.kind === "file" && item.type.startsWith("image/"))
			.map((item) => item.getAsFile())
			.filter(Boolean);
	}

	function screenshotName(file, index) {
		const pad = (n) => String(n).padStart(2, "0");
		const d = new Date();
		const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
		const ext = (file.type.split("/")[1] || "png").replace("jpeg", "jpg");
		return `print-${stamp}${index ? "-" + (index + 1) : ""}.${ext}`;
	}

	async function upload(cardId, file) {
		const body = new FormData();
		body.append("cardId", cardId);
		body.append("type", "file");
		body.append("file", file);
		const response = await fetch(OC.generateUrl(`/apps/deck/cards/${cardId}/attachment`), {
			method: "POST",
			headers: { requesttoken: OC.requestToken },
			body,
		});
		const data = await response.json().catch(() => ({}));
		if (!response.ok) {
			throw new Error(data.message || response.statusText);
		}
		return data;
	}

	window.addEventListener(
		"paste",
		async (event) => {
			const images = pastedImages(event);
			if (images.length === 0) {
				return;
			}
			// The card opens in a modal teleported to <body>, outside .app-deck,
			// so match the Deck Description component itself instead.
			const description = findDescription(event.target);
			if (!description || description.card.isTemplate || !description.canEdit) {
				return;
			}

			// Keep Text from handling (and dropping) the image itself
			event.preventDefault();
			event.stopImmediatePropagation();

			const cardId = description.card.id;
			for (const [index, image] of images.entries()) {
				const file = new File([image], screenshotName(image, index), { type: image.type });
				try {
					const attachment = await upload(cardId, file);
					// Keep the Anexos tab and the card's attachment counter in sync
					description.$store.commit("createAttachment", { cardId, attachment });
					description.$store.commit("cardIncreaseAttachmentCount", cardId);
					description.addAttachment(attachment);
				} catch (error) {
					console.error("[avuz] pasted image upload failed", error);
					OC.Notification.showTemporary(t("deck", "Failed to upload {name}", { name: file.name }) + " — " + error.message);
				}
			}
		},
		true,
	);
	// --- 2. Unstick image nodes in Deck descriptions -------------------------

	// The figure's DOM node belongs to Text's NodeViewWrapper; the ImageView
	// component (src, loadPreview, ...) is up its $parent chain.
	function imageViewOf(figure) {
		const wrapper = figure.closest("[data-node-view-wrapper]") || figure.parentElement;
		for (let vm = wrapper && wrapper.__vue__; vm; vm = vm.$parent) {
			if (typeof vm.loadPreview === "function") {
				return vm;
			}
		}
		return null;
	}

	const checked = new WeakSet();

	function unstickImage(figure) {
		if (checked.has(figure)) {
			return;
		}
		checked.add(figure);
		const vm = imageViewOf(figure);
		if (!vm || vm.__avuzUnstuck || !vm.src) {
			return;
		}
		const src = vm.src;
		// "Novo cartão" (js/deck-new-card.js) shows a pasted image from a local
		// copy until the card exists
		const localPaste = src.startsWith("blob:") && figure.closest(".avuz-nc__editor");
		if (!localPaste && !findDescription(figure)) {
			return; // a file-backed Text editor elsewhere resolves its own images
		}
		if (!localPaste && !src.startsWith("/") && !src.startsWith(window.location.origin)) {
			return; // only same-instance URLs, as inserted by Deck
		}
		vm.__avuzUnstuck = true;
		vm.attachment = {
			isImage: true,
			name: decodeURIComponent(src.split("?")[0].split("/").pop()),
			previewUrl: src,
			fullUrl: src,
		};
		vm.loadPreview().catch((error) => vm.onImageLoadFailure(error));
	}

	// --- 3. Resize images ----------------------------------------------------

	const WIDTH_PARAM = "avuzw";
	const MIN_WIDTH = 80;

	function widthFromSrc(src) {
		const width = parseInt(new URL(src, window.location.origin).searchParams.get(WIDTH_PARAM), 10);
		return width > 0 ? width : null;
	}

	function srcWithWidth(src, width) {
		const url = new URL(src, window.location.origin);
		url.searchParams.set(WIDTH_PARAM, String(width));
		// Keep Deck's relative form (/core/preview?...) when it was relative
		return src.startsWith("/") ? url.pathname + url.search + url.hash : url.href;
	}

	const notDeck = new WeakSet();

	function setupResize(figure) {
		if (notDeck.has(figure)) {
			return;
		}
		const vm = imageViewOf(figure);
		const img = figure.querySelector("img.image__main");
		const media = img && img.closest(".media");
		if (!vm || !vm.src || !media) {
			return;
		}
		const description = findDescription(figure);
		if (!description) {
			notDeck.add(figure);
			return;
		}

		// Apply the saved width (also in read-only descriptions)
		// (only touch the DOM when something changes: this runs from a
		// MutationObserver that also watches class changes)
		const saved = widthFromSrc(vm.src);
		const wanted = saved ? saved + "px" : "";
		if (img.style.width !== wanted && !media.classList.contains("avuz-resizing")) {
			img.style.width = wanted;
		}
		if (!media.classList.contains("avuz-resizable")) {
			media.classList.add("avuz-resizable");
		}

		if (!description.canEdit || media.querySelector(".avuz-resize-handle")) {
			return;
		}
		const handle = document.createElement("span");
		handle.className = "avuz-resize-handle";
		handle.title = t("avuz_theme", "Arraste para redimensionar");
		handle.setAttribute("contenteditable", "false");
		media.appendChild(handle);

		handle.addEventListener("pointerdown", (event) => {
			event.preventDefault();
			event.stopPropagation();
			handle.setPointerCapture(event.pointerId);
			const startX = event.clientX;
			const startWidth = img.getBoundingClientRect().width;
			const maxWidth = figure.getBoundingClientRect().width;
			media.classList.add("avuz-resizing");
			let width = startWidth;

			const onMove = (moveEvent) => {
				width = Math.round(Math.min(maxWidth, Math.max(MIN_WIDTH, startWidth + moveEvent.clientX - startX)));
				img.style.width = width + "px";
				media.dataset.avuzWidth = width + " px";
			};
			const onUp = () => {
				handle.removeEventListener("pointermove", onMove);
				handle.removeEventListener("pointerup", onUp);
				handle.removeEventListener("pointercancel", onUp);
				media.classList.remove("avuz-resizing");
				delete media.dataset.avuzWidth;
				if (width !== Math.round(startWidth)) {
					// Updates the node → Text serializes → Deck saves the description
					vm.src = srcWithWidth(vm.src, width);
				}
			};
			handle.addEventListener("pointermove", onMove);
			handle.addEventListener("pointerup", onUp);
			handle.addEventListener("pointercancel", onUp);
		});
	}

	function unstickAll() {
		document
			.querySelectorAll("figure.image-view.icon-loading")
			.forEach(unstickImage);
		document
			.querySelectorAll("figure.image-view:not(.icon-loading) img.image__main")
			.forEach((img) => setupResize(img.closest("figure.image-view")));
	}

	// childList: nodes added; class: an image node finishing loading only
	// drops its `icon-loading` class
	new MutationObserver(unstickAll).observe(document.body, {
		childList: true,
		subtree: true,
		attributes: true,
		attributeFilter: ["class"],
	});
})();
