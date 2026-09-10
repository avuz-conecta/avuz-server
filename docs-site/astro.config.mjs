import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://ajuda.avuz.app',
  integrations: [
    starlight({
      title: 'AvuzConecta · Ajuda',
      defaultLocale: 'root',
      locales: { root: { label: 'Português (Brasil)', lang: 'pt-BR' } },
      logo: { src: './src/assets/house-logo.svg', replacesTitle: false },
      sidebar: [
        { label: 'Drive', items: [{ autogenerate: { directory: 'drive' } }] },
        { label: 'Talk', items: [{ autogenerate: { directory: 'talk' } }] },
      ],
      pagefind: true,
    }),
  ],
});
