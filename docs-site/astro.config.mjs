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
      logo: { src: './src/assets/house-logo.svg', replacesTitle: false },
      components: { Hero: './src/components/HomeHero.astro' },
      sidebar: [
        { label: 'Drive', items: [{ autogenerate: { directory: 'drive' } }] },
        { label: 'Talk', items: [{ autogenerate: { directory: 'talk' } }] },
        { label: 'Tarefas', items: [{ autogenerate: { directory: 'tarefas' } }] },
        { label: 'Agenda', items: [{ autogenerate: { directory: 'agenda' } }] },
      ],
      pagefind: true,
    }),
  ],
});
