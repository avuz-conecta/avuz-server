export type Step = { readonly n: number; readonly text: string };

export type TaskDoc = {
  readonly title: string;
  readonly description: string;
  readonly app: string;
  readonly slug: string;
  readonly steps: readonly Step[];
  readonly media: string;
  readonly tip?: string;
  readonly order: number;
};

function yamlString(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

export function stepsToMarkdown(doc: TaskDoc, capturedForVersion: string): string {
  const frontmatter = [
    '---',
    `title: ${yamlString(doc.title)}`,
    `description: ${yamlString(doc.description)}`,
    'sidebar:',
    `  order: ${doc.order}`,
    `capturedForVersion: "${capturedForVersion}"`,
    '---',
  ].join('\n');

  const steps = doc.steps.map((step) => `${step.n}. ${step.text}`).join('\n');
  const video = `<video src="../../assets/${doc.app}/${doc.media}" muted autoplay loop playsinline controls></video>`;
  const tip = doc.tip ? `\n:::tip\n${doc.tip}\n:::\n` : '';

  return `${frontmatter}\n\n${steps}\n\n${video}\n${tip}`;
}
