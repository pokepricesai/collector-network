import 'server-only';

// MTGPrices publishing adapter. Commits a markdown file with YAML
// frontmatter into mtgprices-web via the GitHub Contents API, which
// triggers the project's Vercel git-auto-deploy. No manual git
// commands, no payload copying.
//
// Required env (hub project, server-only):
//   MTGPRICES_GITHUB_TOKEN       — fine-grained PAT, Contents: write
//                                  on pokepricesai/mtgprices-web only.
//   MTGPRICES_GITHUB_REPO        — e.g. "pokepricesai/mtgprices-web"
//                                  (defaults if unset).
//   MTGPRICES_GITHUB_BRANCH      — "main" (defaults).

import { htmlToMarkdown, emitYamlFrontmatter } from './html-convert';

export interface MtgpricesPublishInput {
  slug: string;
  title: string;
  description: string | null;
  bodyHtml: string;
  bodyMarkdownFallback: string | null;
  author: string;
  category: string;              // "Market" | "Collecting" | ...
  publishedAtIso: string;
  heroImageUrl: string | null;
}

export interface MtgpricesPublishResult {
  ok: boolean;
  commitSha?: string;
  publicUrl?: string;
  filename?: string;
  error?: string;
}

const DEFAULT_REPO = 'pokepricesai/mtgprices-web';
const DEFAULT_BRANCH = 'main';
const PUBLIC_INSIGHTS_BASE = 'https://www.mtgprices.ai/insights';

export async function publishToMtgPrices(input: MtgpricesPublishInput): Promise<MtgpricesPublishResult> {
  const token = process.env['MTGPRICES_GITHUB_TOKEN'];
  if (!token) {
    return { ok: false, error: 'MTGPRICES_GITHUB_TOKEN not set (expect fine-grained PAT with Contents: write on mtgprices-web)' };
  }
  const repo = process.env['MTGPRICES_GITHUB_REPO'] ?? DEFAULT_REPO;
  const branch = process.env['MTGPRICES_GITHUB_BRANCH'] ?? DEFAULT_BRANCH;

  // Build the file body: strict YAML frontmatter + markdown.
  const markdownBody = (input.bodyHtml.replace(/<[^>]+>/g, '').trim().length > 0)
    ? htmlToMarkdown(input.bodyHtml)
    : (input.bodyMarkdownFallback ?? '');
  if (!markdownBody.trim()) return { ok: false, error: 'article body is empty' };

  const frontmatter = emitYamlFrontmatter({
    slug: input.slug,
    title: input.title,
    description: input.description ?? '',
    author: input.author,
    category: input.category || 'Market',
    publishedAt: input.publishedAtIso.slice(0, 10),
    heroImage: input.heroImageUrl ?? null,
  });
  const fileBody = `${frontmatter}${markdownBody}\n`;
  const filename = `src/content/insights/${input.slug}.md`;

  // GitHub Contents API: PUT /repos/{owner}/{repo}/contents/{path}
  // creates or updates. Updates require the current sha of the file;
  // fetch it first (404 is fine → first-time create).
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'collector-network-hub',
  };
  const url = `https://api.github.com/repos/${repo}/contents/${filename}?ref=${branch}`;
  let existingSha: string | undefined;
  const probe = await fetch(url, { headers });
  if (probe.ok) {
    const probeJson = await probe.json().catch(() => null) as { sha?: string } | null;
    existingSha = probeJson?.sha;
  } else if (probe.status !== 404) {
    const body = await probe.text().catch(() => '');
    return { ok: false, error: `GitHub probe ${probe.status}: ${body.slice(0, 200)}` };
  }

  const putBody: Record<string, unknown> = {
    message: existingSha
      ? `chore(insights): update "${input.title}" via Collector Network`
      : `feat(insights): publish "${input.title}" via Collector Network`,
    content: Buffer.from(fileBody, 'utf8').toString('base64'),
    branch,
  };
  if (existingSha) putBody['sha'] = existingSha;

  const put = await fetch(`https://api.github.com/repos/${repo}/contents/${filename}`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify(putBody),
  });
  if (!put.ok) {
    const body = await put.text().catch(() => '');
    return { ok: false, error: `GitHub PUT ${put.status}: ${body.slice(0, 400)}` };
  }
  const putJson = await put.json().catch(() => null) as { commit?: { sha?: string } } | null;
  const commitSha = putJson?.commit?.sha;

  return {
    ok: true,
    commitSha,
    publicUrl: `${PUBLIC_INSIGHTS_BASE}/${input.slug}`,
    filename,
  };
}
