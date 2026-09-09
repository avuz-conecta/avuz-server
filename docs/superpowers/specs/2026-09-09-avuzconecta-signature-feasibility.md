# AvuzConecta E-Signature Module — Feasibility & Provider Intelligence

**Date:** 2026-09-09
**Status:** Information-gathering (no direction committed)
**Decision so far:** Wrap an existing provider and resell under the Avuz brand. Do **not** build a signing engine from scratch, and do **not** become a certificate authority.

---

## 1. Executive summary

Launching an online-signature module inside AvuzConecta is feasible. The only sane path for our position (a Nextcloud reseller, not a PKI operator) is to **wrap a Brazilian e-signature provider's API** behind a provider-abstraction layer and resell it to tenants under our brand.

Three findings decide everything:

1. **No accreditation needed.** Operating a signing *platform* requires **no ITI/ICP-Brasil accreditation**. Accreditation only applies to *issuing certificates* or anchoring the *qualified* tier. Wrapping a provider inherits their legal validity entirely.
2. **The everyday use case is legally solved without ICP-Brasil.** Private contracts (service agreements, NDAs, HR, proposals) mandate **no signature tier** under Brazilian law. Simple/advanced signatures are valid and enforceable — the STJ confirmed this in March 2026 (REsp 2.197.156).
3. **The whole business model is gated on one unknown.** **None** of the five providers publish reseller / wholesale / white-label commercial terms. Margin, resale rights, and rebranding are all quote-only. **A sales/channel call is step 0** — the economics cannot be modeled without it.

**Recommendation to explore first:** ZapSign (purpose-built reseller mechanics) and Clicksign (best drop-in white-label widget). The other three are documented here for completeness but are weaker fits for resell.

---

## 2. Legal framework (Brazil)

### 2.1 Governing law
- **MP 2.200-2/2001** — created ICP-Brasil. Art. 10 §1 gives ICP-Brasil-signed docs a presumption of authenticity. **Art. 10 §2** validates *any other* electronic authorship/integrity method **"desde que admitido pelas partes como válido"** — the legal anchor for non-ICP signatures.
- **Lei 14.063/2020** — defines the three tiers (art. 4) and governs their use with the public sector (art. 5). Does **not** restrict private-sector signing.
- **Decreto 10.543/2020** — sets the minimum tier for each type of interaction with the federal public administration.

### 2.2 The three tiers

| Tier | Definition | Identity assurance | ICP-Brasil cert? |
|---|---|---|---|
| **Simples** | Identifies signer + associates data to the signer | Basic (name, CPF, email/SMS confirmation) | No |
| **Avançada** | Non-ICP certificate *or* another authorship/integrity method, accepted by the parties | Strong link + tamper-evidence | No |
| **Qualificada** | ICP-Brasil digital certificate (e-CPF/e-CNPJ) | Highest; auto presumption of authenticity | **Yes** |

### 2.3 Which acts require which tier
- **Private contracts** (service agreements, NDAs, HR docs, proposals, commercial docs): **no tier mandated**. Código Civil art. 107 — form is free unless a law expressly requires otherwise. Simple/advanced are valid and enforceable.
- **Public-sector interactions**: tiered by risk per Decreto 10.543 (simples for low-risk, avançada for higher assurance).
- **Qualified (ICP-Brasil) mandatory** for: transfer/registration of **immovable property** (real estate), **public deeds** (escritura pública eletrônica — CNJ Prov. 100/2020), and specific public-sector acts where the law demands it.

### 2.4 Enforceability in court (private contracts)
- **CC art. 219** — declarations in signed documents are presumed true as to signatories (relative presumption).
- **STJ REsp 2.197.156** (3ª Turma, Rel. Min. Nancy Andrighi, 18/03/2026): an electronic signature is **valid even without ICP-Brasil certification** when the signer's conduct (data provided, selfie, geolocation, device use) tacitly admits the authentication method. Burden shifts to the challenger to show fraud.
- Lower courts have accepted platform-signed contracts as extrajudicial enforceable titles (*título executivo extrajudicial*); the usual friction is the CPC art. 784, III two-witness rule, not the signature medium.
- **Bottom line:** simple/advanced signatures hold up for our clients' real needs. Qualified only buys an *automatic* presumption; with simple/advanced the producer may need to present the audit trail if genuinely challenged.

### 2.5 gov.br signature — not a route for us
gov.br has an advanced-signature API, but **only public bodies (Gestor Público) can onboard** to homologation/production. A private SaaS cannot self-onboard. Citizens can use the free web portal, but there is no private-company programmatic path without partnering with a government entity. **Rule it out** — use a commercial provider instead.

---

## 3. Strategic paths (why "wrap" wins)

| Path | Verdict | Why |
|---|---|---|
| **Become a provider / CA** (own ICP-Brasil trust anchor, like issuing certs) | ❌ Reject | Sala-cofre, HSMs, pre-op + annual audits, liability insurance, millions of BRL, 12+ months, ITI accreditation (DOC-ICP-03). No strategic reason. |
| **Build own "avançada" engine** | ⏸ Deferred | Technically feasible as pure software (no accreditation): SHA-256 hashing + PAdES/CAdES embed + auth layer + audit trail + optional RFC 3161 timestamp. Full margin/control, but we own legal-defensibility + support. Revisit only if wrap-volume justifies it. |
| **Wrap a provider API, white-label** | ✅ Chosen | Fastest to revenue, legal validity inherited, resell margin. All BR providers share the same `create → sign → webhook → retrieve` shape, so an abstraction layer is cheap and keeps swap open. |

---

## 4. Provider intelligence dossier

All five named providers researched against six dimensions. Prices are public retail/list values (to mark up against); **wholesale/reseller rates are quote-only for every provider.**

### 4.1 Master comparison

| Criterion | **ZapSign** | **Clicksign** | **Autentique** | **D4Sign** | **DocuSign BR** |
|---|---|---|---|---|---|
| API style | REST (JSON) | REST v3 (JSON:API) | **GraphQL only** | REST (token+cryptKey in query string) | REST (best docs) |
| Full lifecycle (create/sign/retrieve) | Yes | Yes | Yes | Yes | Yes |
| Webhooks | Yes (free, full lifecycle) | Yes (full event list) | Yes (HMAC-signed) | Yes (per-doc, 7 retries/27h) | Yes (Connect) |
| Embedded iframe widget | Yes (Widget, `postMessage`) | **Yes (official Widget, brand-free)** | **No** (link-based only) | Yes (EMBED iframe) | Yes (Focused View) |
| Brand fully hidden | Via API (verify iframe) | **Yes — "sem menções à Clicksign"** | DIY only, weak | Not documented | "custom branding," not full white-label |
| Formal reseller program | **Direct Reseller API + ZapSigner partner** | Clickpartner (page down; unverified) | None public | D4Sign Together (referral/discount) | ISV Embed + Reseller (gated) |
| Pricing model | Per-doc credits (~R$2.50/doc) | Per-doc within plans (~R$3–6.90 overage) | **Metered pay-per-use (cheapest, ~R$0.06/doc)** | Per-account/volume (from R$39.90/mo) | **Costliest, USD, per-seat + committed** |
| ICP-Brasil qualified | **Yes — is itself an AC**, issues e-CPF/e-CNPJ | Yes (A1/A3/cloud); **widget can't** | Supported (toggle), API-drivability unclear | **First-class** (A1/A3) | Supported, but **not a CA**; needs signer cert |
| Auth | Bearer token (static/dynamic) | `access_token` header | Bearer token | `tokenAPI`+`cryptKey` in **query string** ⚠ | **OAuth2 (JWT + Auth Code)** |
| Rate limit | **500 req/min** | ~5 req/s (50/10s) | ~60 req/min | **10 req/hour default** ⚠ | 3000/hr + 500/30s burst |
| Sandbox | Yes | Yes | Yes (free, `sandbox:true`) | Yes | Yes (free dev account) |

### 4.2 ZapSign — best resell mechanics
- **API:** REST/JSON, full lifecycle. Docs: developers.zapsign.com.br / docs.zapsign.com.br (PT/EN/ES). Go SDK.
- **Reseller:** **Direct Reseller (Revenda Direta) API** — a parent partner account manages child customer sub-accounts and can flip each customer's payment status (adimplente/inadimplente) programmatically. A genuine multi-account OEM structure. Plus the "ZapSigner" partner program (white-label account customization + support).
- **White-label:** asserted "without mentioning our brand" **via API**; iframe widget brand-removal depth is **not confirmed in the widget docs** → verify.
- **ICP-Brasil:** ZapSign is **itself an accredited AC** in the ICP-Brasil chain — issues e-CPF/e-CNPJ (A1/A3) via video validation and signs qualified in-house. Strongest cert story of the five.
- **Auth/limits:** Bearer token; **500 req/min**; free sandbox at sandbox.app.zapsign.com.br.
- **⚠ Verify:** (1) audit trail / *documento probante* retrievable via API (not documented); (2) how brand-free the iframe signing screen actually is; (3) `signed_file`/`original_file` URLs **expire in 60 min** — download to Nextcloud immediately; (4) times stored UTC+0.
- **Retail ref:** Free 5 docs/mo; Profissional R$29.90/mo; Completo R$79.90/mo (unlimited); ICP-Brasil = 5 credits/sig, facial recog = 15 credits.

### 4.3 Clicksign — best drop-in white-label UX
- **API:** REST v3.0 "Envelope" API, JSON:API. Docs: developers.clicksign.com (append `.md` to any doc URL; LLM index at `/llms.txt`).
- **White-label widget:** official **Widget Embedded** iframe — Clicksign's own help says *"totalmente personalizado com a sua marca, cores e remetente, sem menções à Clicksign."* Best branded in-app UX of the five. Open-source `clicksign/widget` repo.
- **Constraints:** widget requires the **Avançado (custom) plan** + sales contract; the **embedded widget cannot do ICP-Brasil qualified** signing (token/Pix auth only) — qualified needs the hosted/redirect flow.
- **Reseller:** Clickpartner program exists, but the official landing page was **unreachable during research** and resale/white-label terms rest on unverified third-party summaries → sales call required.
- **Auth/limits:** `access_token` header; **~5 req/s** (50/10s prod, 20/10s sandbox); free sandbox at sandbox.clicksign.com (widget enabled by default there).
- **Retail ref:** Start ~R$135/mo (overage to R$3/doc); Plus (to R$4.90/doc); Avançado = custom quote (unlocks widget + higher volume).

### 4.4 Autentique — cheapest, but wrong shape for resell
- **API:** **GraphQL only** (v2), `POST /v2/graphql`. Community SDKs (Node/PHP/.NET/Delphi). Altair explorer.
- **White-label:** **none.** No embedded-signing SDK, Autentique-branded hosted signing pages, no OEM program. Biggest gap for "hide the vendor."
- **Pricing:** cheapest by far, transparent metered — doc creation ~R$0.06, email sig ~R$0.013, WhatsApp ~R$0.12, SMS ~R$0.16. Plans are monthly minimums with overage.
- **ICP-Brasil:** supported via a qualified toggle; API-drivability of the toggle unclear.
- **Auth/limits:** Bearer token; ~60 req/min; free sandbox (`sandbox:true`, no credit burn); webhooks HMAC-SHA256.
- **Fit:** good low-cost *backend* only if we build our own signing UI on the API. Not a white-label/resell product.

### 4.5 D4Sign — strong ICP-Brasil, opaque resell, crippling default rate limit
- **API:** mature REST (docapi.d4sign.com.br). Official PHP SDK. First-class **ICP-Brasil endpoints** (A1 `.PFX` via API, A3 client-side).
- **⚠ Rate limit: 10 requests/hour** on default accounts — unusable for multi-tenant SaaS without a negotiated enterprise limit.
- **⚠ Auth:** `tokenAPI` + `cryptKey` **in the query string** — conflicts with our "never put secrets in URLs" rule; must be held server-side only, never exposed to browser/Nextcloud client code.
- **White-label:** EMBED iframe exists, but brand-hiding is **not documented**. Reseller program (D4Sign Together) reads as referral/discount, not confirmed resell-under-own-brand.
- **Webhooks:** solid (v1/v2 payloads, form-data, 7 retries over ~27h).
- **Fit:** pick only if ICP-Brasil qualified is the *primary* requirement and the rate limit + reseller terms can be negotiated.

### 4.6 DocuSign (Brazil) — wrong economics
- **API:** industry-leading Envelopes API, Connect webhooks, OAuth2 (JWT + Auth Code), Focused View embedded signing, free sandbox, 3000 calls/hr.
- **Reseller:** formal **ISV Embed** program (usage billing year 1 → committed volume after) + a Reseller track. Real but **fully quote/contract-gated**; no public BRL pricing.
- **Branding:** custom logo/colors, **not confirmed full white-label** ("powered by DocuSign" bias).
- **ICP-Brasil:** DocuSign is **not** an accredited CA; enables signing *with* a signer-supplied ICP-Brasil cert (standards-based flow) where legally required.
- **Pricing:** most expensive, **USD-denominated**, per-seat + committed volume. Wrong posture and wrong economics for reselling to Brazilian SMBs under our brand. **Not recommended.**

---

## 5. The commercial blocker — questions for each vendor's sales team

Every viability number is quote-gated. Before any build decision, get answers to:

1. **Resale rights:** Can we resell your service to *our* clients and bill them ourselves? Under what contract (OEM / reseller / ISV)?
2. **White-label depth:** Can the signer-facing experience (email, signing page/iframe, completed-doc PDF, audit-trail report) carry **only the Avuz/AvuzConecta brand**, with zero vendor mentions?
3. **Wholesale price:** Per-document (and per-ICP-Brasil-signature) wholesale rate at our expected volume. Minimum monthly commitment?
4. **Multi-tenant structure:** Can one parent account provision/segregate many tenant sub-accounts, each with isolated documents and billing? (ZapSign's Direct Reseller API is the reference here.)
5. **Rate limit** negotiated ceiling for multi-tenant scale.
6. **Audit trail via API:** Is the legally-defensible audit-trail / *documento probante* PDF retrievable programmatically (to archive into Nextcloud Files)?
7. **Data residency / LGPD** terms and DPA.
8. **SLA / support** tier for a partner.

---

## 6. Recommended architecture (when we proceed)

Provider-agnostic by design so the sales-call outcome picks the concrete adapter:

- **Nextcloud app** (`avuz_sign` or similar) providing the tenant-facing UI: pick a file from Drive → add signers → send → track status → receive signed PDF + audit trail back into Nextcloud Files.
- **Server-side proxy / sidecar** holds all provider API credentials. Credentials **never** reach the browser (several providers use static tokens or query-string keys). Mirrors the existing `conecta-mcp` per-tenant sidecar pattern.
- **Provider-abstraction interface** over the common lifecycle: `createEnvelope → addSigners → send → (webhook) → fetchSigned + fetchAuditTrail`. One adapter per provider; start with one, swap without touching the app.
- **Webhook receiver** maps provider events → in-app signature status; on completion, downloads signed PDF + audit trail (mind ZapSign's 60-min URL expiry) into the tenant's Nextcloud storage.
- **Per-tenant config**: which provider, credentials, branding, allowed signature tiers.

## 7. Monetization models (to validate against wholesale pricing)
- **Bundled add-on** in the tenant's AvuzConecta subscription (flat monthly, includes N docs/mo).
- **Per-document markup** (resale price − wholesale = margin).
- **Seat add-on** (per user enabled for signing).
- ICP-Brasil qualified signatures billed as a premium line item (they cost more wholesale).

---

## 8. Open items / next steps
1. **Sales/channel calls** with ZapSign and Clicksign (primary), D4Sign (if ICP-Brasil qualified becomes primary). Use the §5 question list.
2. Confirm the two ZapSign unknowns (iframe brand-hiding, audit-trail API) and the two Clicksign constraints (widget plan gate, no-qualified-in-widget).
3. Model margin once wholesale numbers land.
4. Decide provider → then move to a design spec + implementation plan for the wrapper.

---

## 9. Sources
**Legal:** Lei 14.063/2020, MP 2.200-2/2001 art. 10 §2, Decreto 10.543/2020 (planalto.gov.br); CC arts. 107/219; STJ REsp 2.197.156 (stj.jus.br, 18/03/2026); IRIB (real-estate qualified requirement); ITI validator (validar.iti.gov.br); gov.br signature API manual (manual-integracao-assinatura-eletronica.servicos.gov.br).
**ICP-Brasil accreditation:** gov.br/iti FAQ; Resolução 178 / DOC-ICP-03; DOC-ICP-08 (audit); DOC-ICP-11/12 (timestamping).
**Providers:** ZapSign (docs.zapsign.com.br, zapsign.com.br/parcerias, certificados.zapsign.com.br); Clicksign (developers.clicksign.com, ajuda.clicksign.com/article/694-widget-embedded, clicksign.com/preco); Autentique (docs.autentique.com.br/api); D4Sign (docapi.d4sign.com.br, landing.d4sign.com.br/parcerias); DocuSign (developers.docusign.com, docusign.com/partners/isv-embed).

> Commercial/reseller economics for **all** providers are quote-only and were not publicly available. Retail prices above are list values for markup reference. Verify statutory wording directly on planalto.gov.br for any formal/legal filing.
