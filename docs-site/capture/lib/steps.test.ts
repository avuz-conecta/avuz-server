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
    expect(md).toContain('title: Como compartilhar um arquivo');
    expect(md).toContain('capturedForVersion: "33.0.8"');
    expect(md).toContain('1. Passe o mouse no arquivo e clique em **Compartilhar**.');
    expect(md).toContain('2. Escolha **Link** ou digite um e-mail.');
    expect(md).toMatch(/!\[.*\]\(.*compartilhar-arquivo\.mp4\)|<video/);
    expect(md).toContain(':::tip');
    expect(md).toContain('Use link com senha');
  });
});
