# Changes from the original apps

Where Avuz Conecta changes the behavior of an upstream Nextcloud app, why, and
how to rebuild it. The full machine-readable list is `customizations.json`.

## Contacts 8.4.1 — WhatsApp button next to phone numbers (card 266)

- **What:** in view mode, every phone number in the contact details shows a
  WhatsApp icon button (first, before Copy and Call). Click opens
  `https://wa.me/<digits>` in a new tab. A number without `+`/`00` and with
  10-11 digits gets the Brazilian `55`; under 8 digits, Fax/Pager/Car types
  and edit mode show no button. Label: "Conversar no WhatsApp".
- **Why:** users start WhatsApp chats with contacts straight from Avuz Conecta.
- **Files:** `docker/overlays/contacts/` (source patch, rebuilt `js/` + `css/`
  that changed, README), `themes/avuz/apps/contacts/l10n/pt_BR.json`
  (label), Dockerfile (version guard + copy), `docker/entrypoint.sh` (sentinel
  `AVUZ-WHATSAPP-PHONE-V1`, `contacts` in `AVUZ_OWNED_APPS`,
  `reapply_avuz_contacts_overlay`).
- **Design:** Designer spec `~/work/avuz/reports/266-spec/SPEC.md` (final).
  Styles live in one CSS block in `PropertyText.vue`, marked `AVUZ-266`.
- **Rebuild:** on every contacts upgrade, follow
  `docker/overlays/contacts/README.md`. The build clock must be pinned to the
  release date, or the bundle won't match upstream.
