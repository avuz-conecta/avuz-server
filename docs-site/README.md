# AvuzConecta Docs

The pt-BR help center for AvuzConecta, built with [Astro](https://astro.build)
+ [Starlight](https://starlight.astro.build). Task pages walk users through
real product flows (Drive, Talk, ...) with step-by-step instructions and a
short screen-capture video.

## Commands

Run from `docs-site/`:

| Command           | Action                                       |
| :----------------- | :-------------------------------------------- |
| `npm install`       | Install dependencies                          |
| `npm run dev`       | Start the local dev server at `localhost:4321` |
| `npm run build`     | Build the production site to `./dist/`        |
| `npm run preview`   | Preview the build locally                     |
| `npm test`          | Run the capture harness unit tests            |

## Content

Task pages live under `src/content/docs/<app>/<slug>.md`, one folder per app
(`drive`, `talk`, ...). **Don't hand-edit a generated page's steps or media** —
each one is generated from a Playwright flow that ran against staging. See
`capture/README.md` for the capture harness: how to add a new task page,
re-capture one after a UI change, and the hygiene rules that keep real
hostnames, versions, and client names out of the public site.

## Deploy

Static build served by nginx (`Dockerfile`, `nginx.conf`), deployed via
`portainer-docs-stack.yml` behind Nginx Proxy Manager. Not Cloudflare Pages.
