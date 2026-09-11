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
      components: { Hero: './src/components/HomeHero.astro' },
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
