import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://ajuda.avuz.app',
  integrations: [
    starlight({
      title: 'AvuzConecta · Ajuda',
      favicon: '/favicon.png',
      customCss: ['./src/styles/avuz.css'],
      defaultLocale: 'root',
      locales: { root: { label: 'Português (Brasil)', lang: 'pt-BR' } },
      logo: { src: './src/assets/avuz-logo.png', replacesTitle: false },
      // Task pages are single-topic step lists with no subheadings, so the
      // right-hand "Nesta página" TOC only ever shows the page's own title —
      // identical on every page. Drop it (and reclaim the content width).
      tableOfContents: false,
      components: {
        Hero: './src/components/HomeHero.astro',
        SocialIcons: './src/components/SupportButton.astro',
      },
      head: [
        {
          // Starlight doesn't scroll its sidebar to the active page on load, so
          // with 9 sections the current one is often off-screen. Center the
          // active link inside the sidebar's own scroll container (never the
          // page — we adjust scrollTop directly, no scrollIntoView).
          tag: 'script',
          content: [
            'function centerActive() {',
            '  var active = document.querySelector("#starlight__sidebar a[aria-current=\\"page\\"]");',
            '  if (!active) return;',
            '  var pane = document.getElementById("starlight__sidebar");',
            '  if (!pane || pane.scrollHeight <= pane.clientHeight + 1) return;',
            '  var a = active.getBoundingClientRect();',
            '  var c = pane.getBoundingClientRect();',
            '  if (a.top >= c.top && a.bottom <= c.bottom) return;',
            '  pane.scrollTop += (a.top - c.top) - pane.clientHeight / 2 + a.height / 2;',
            '}',
            // Starlight restores a persisted sidebar scrollTop on load; arriving
            // from the home grid that saved value is 0, which parks the active
            // link off-screen. Re-center across a few frames so our write lands
            // after the restore (and re-corrects if it fires late).
            'function run(n) { centerActive(); if (n > 0) requestAnimationFrame(function () { run(n - 1); }); }',
            'window.addEventListener("load", function () { run(12); });',
          ].join('\n'),
        },
      ],
      sidebar: [
        { label: 'Agenda', items: [{ autogenerate: { directory: 'agenda' } }] },
        { label: 'Atividade', items: [{ autogenerate: { directory: 'atividade' } }] },
        { label: 'Contatos', items: [{ autogenerate: { directory: 'contatos' } }] },
        { label: 'Drive', items: [{ autogenerate: { directory: 'drive' } }] },
        { label: 'Formulários', items: [{ autogenerate: { directory: 'formularios' } }] },
        { label: 'Minha conta', items: [{ autogenerate: { directory: 'minha-conta' } }] },
        { label: 'Painel', items: [{ autogenerate: { directory: 'painel' } }] },
        { label: 'Talk', items: [{ autogenerate: { directory: 'talk' } }] },
        { label: 'Tarefas', items: [{ autogenerate: { directory: 'tarefas' } }] },
      ],
      pagefind: true,
    }),
  ],
});
