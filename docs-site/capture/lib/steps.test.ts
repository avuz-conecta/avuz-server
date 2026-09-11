import { describe, it, expect } from 'vitest';
import { stepsToMarkdown } from './steps';

describe('stepsToMarkdown', () => {
  it('renders frontmatter, numbered steps, media and tip from annotations', () => {
    const md = stepsToMarkdown(
      {
        title: 'Como compartilhar um arquivo',
        description: 'Envie um link ou convide alguém.',
        app: 'drive',
        slug: 'compartilhar-arquivo',
        order: 1,
        media: 'compartilhar-arquivo.mp4',
        tip: 'Use link com senha para dados sensíveis.',
        steps: [
          { n: 1, text: 'Passe o mouse no arquivo e clique em **Compartilhar**.' },
          { n: 2, text: 'Escolha **Link** ou digite um e-mail.' },
        ],
      },
      '33.0.8',
    );
    expect(md).toContain('title: "Como compartilhar um arquivo"');
    expect(md).toContain('capturedForVersion: "33.0.8"');
    expect(md).toContain('1. Passe o mouse no arquivo e clique em **Compartilhar**.');
    expect(md).toContain('2. Escolha **Link** ou digite um e-mail.');
    expect(md).toMatch(/!\[.*\]\(.*compartilhar-arquivo\.mp4\)|<video/);
    expect(md).toContain(':::tip');
    expect(md).toContain('Use link com senha');
  });

  it('quotes a title containing a colon so the YAML stays valid', () => {
    const md = stepsToMarkdown(
      {
        title: 'Como fazer: uma reunião',
        description: 'Descrição simples.',
        app: 'talk',
        slug: 'como-fazer-reuniao',
        order: 1,
        media: 'reuniao.mp4',
        steps: [{ n: 1, text: 'Clique em **Nova reunião**.' }],
      },
      '33.0.8',
    );
    expect(md).toContain('title: "Como fazer: uma reunião"');
    expect(md).not.toContain('title: Como fazer: uma reunião\n');
  });

  it('escapes embedded double quotes in the description', () => {
    const md = stepsToMarkdown(
      {
        title: 'Título simples',
        description: 'Ele disse "olá" a todos',
        app: 'talk',
        slug: 'titulo-simples',
        order: 1,
        media: 'video.mp4',
        steps: [{ n: 1, text: 'Passo único.' }],
      },
      '33.0.8',
    );
    expect(md).toContain('description: "Ele disse \\"olá\\" a todos"');
  });
});
