import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  buildQuickAddInboxChoice,
  install,
  loadDefaultBundle,
  mergeCommunityPlugins,
  mergeQuickAddSettings,
  planInstall,
  restore,
  status,
  validateBundle,
  validateTargetPath,
} from './obsidian-host-plugins.mjs';

const temporaryRoots: string[] = [];

async function temporaryVault() {
  const root = await mkdtemp(join(tmpdir(), 'mcpvault-host-plugins-'));
  temporaryRoots.push(root);
  await mkdir(join(root, '.obsidian'), { recursive: true });
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(async (root) => {
    await import('node:fs/promises').then(({ rm }) => rm(root, { recursive: true, force: true }));
  }));
});

const bundle = {
  fingerprint: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  templates: [{ path: 'Templates/MCPVault/Inbox.md', content: '---\nnote_kind: fleeting\nlifecycle: inbox\ntitle: ""\ntags: []\nfileClass: Inbox\n---\n# {{VALUE:title}}\n\n{{VALUE:content}}\n' }],
  fileClasses: [{ path: 'Templates/MCPVault/FileClasses/Inbox.md', content: '---\ncontract_fingerprint: sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\nfields:\n  - name: title\n    type: Input\n    id: mcpvault-title\n    path: ""\n    options: {}\n  - name: tags\n    type: Multi\n    id: mcpvault-tags\n    path: ""\n    options:\n      sourceType: ValuesList\n      valuesList: {}\n---\n' }],
  fileClassesPath: 'Templates/MCPVault/FileClasses',
};

describe('obsidian host plugin installer', () => {
  test('accepts only a complete generated contract bundle', () => {
    expect(validateBundle(bundle)).toEqual(bundle);
    expect(() => validateBundle({ ...bundle, fingerprint: 'not-a-fingerprint' })).toThrow('fingerprint');
    expect(() => validateBundle({ ...bundle, templates: [] })).toThrow('templates');
    expect(() => validateBundle({ ...bundle, fileClassesPath: '../outside' })).toThrow('vault-relative');
    expect(() => validateBundle({ ...bundle, fileClassesPath: 'Templates/MCPVault/../outside' })).toThrow('vault-relative');
    expect(() => validateBundle({ ...bundle, templates: [{ ...bundle.templates[0]!, path: '.mcpvault/host-plugins/templates/Inbox.md' }] })).toThrow('Templates/MCPVault');
    expect(() => validateBundle({ ...bundle, templates: [{ ...bundle.templates[0]!, content: '# not an Inbox template\n' }] })).toThrow('title');
    expect(() => validateBundle({ ...bundle, templates: [{ ...bundle.templates[0]!, content: '---\ntitle: ""\ntags: []\n---\n# {{VALUE:title}}\n{{VALUE:content}}\n{{JS: dangerous}}' }] })).toThrow('executable');
    expect(() => validateBundle({ ...bundle, templates: [...bundle.templates, { path: 'Templates/MCPVault/Other.md', content: '{{MACRO: unsafe}}' }] })).toThrow('executable');
    expect(() => validateBundle({ ...bundle, fileClasses: [{ ...bundle.fileClasses[0]!, content: '---\nfields:\n  - name: title\n---\n' }] })).toThrow('tags');
  });

  test('loads the server-owned bundle from the built authoring exporter without duplicating its contract', async () => {
    await expect(loadDefaultBundle()).resolves.toMatchObject({
      templates: [{ path: 'Templates/MCPVault/Inbox.md' }],
      fileClassesPath: 'Templates/MCPVault/FileClasses',
      fileClasses: [{ path: 'Templates/MCPVault/FileClasses/Inbox.md' }],
    });
  });

  test('requires an exact opt-in vault target with an ordinary Obsidian directory', async () => {
    const vault = await temporaryVault();
    await expect(validateTargetPath(vault, vault)).resolves.toBe(resolve(vault));
    await expect(validateTargetPath(vault, `${vault}-other`)).rejects.toThrow('exact target');
    await expect(validateTargetPath('.', vault)).rejects.toThrow('absolute');
  });

  test('reports generated contract drift from current template and FileClass hashes without returning their contents', async () => {
    const vault = await temporaryVault();
    await mkdir(join(vault, 'Templates', 'MCPVault', 'FileClasses'), { recursive: true });
    await writeFile(join(vault, bundle.templates[0]!.path), bundle.templates[0]!.content, 'utf8');
    await writeFile(join(vault, bundle.fileClasses[0]!.path), bundle.fileClasses[0]!.content, 'utf8');
    await expect(status({ vaultPath: vault, expectedTarget: vault, bundle })).resolves.toMatchObject({ generatedContractMatches: true });
    await writeFile(join(vault, bundle.fileClasses[0]!.path), bundle.fileClasses[0]!.content.replace('contract_fingerprint:', 'contract_fingerprint: drifted-'), 'utf8');
    await expect(status({ vaultPath: vault, expectedTarget: vault, bundle })).resolves.toMatchObject({ generatedContractMatches: false });
  });

  test('builds a non-executing QuickAdd Template choice that always creates a separate Inbox note', () => {
    expect(buildQuickAddInboxChoice(bundle.templates[0]!.path)).toMatchObject({
      id: 'mcpvault-host-inbox',
      name: 'MCPVault: New Inbox note',
      type: 'Template',
      command: false,
      templatePath: bundle.templates[0]!.path,
      fileNameFormat: { enabled: true, format: '{{DATE:YYYYMMDD-HHmmssSSS}}' },
      folder: {
        enabled: true,
        folders: ['Inbox'],
        chooseWhenCreatingNote: false,
        createInSameFolderAsActiveFile: false,
        chooseFromSubfolders: false,
      },
      appendLink: false,
      copyLinkToClipboard: false,
      openFile: true,
      fileExistsBehavior: { kind: 'apply', mode: 'duplicateSuffix' },
    });
  });

  test('adds its QuickAdd choice without replacing existing choices or user settings', () => {
    const original = { choices: [{ id: 'user-choice', name: 'My choice', type: 'Capture' }], keepMe: true };
    const merged = mergeQuickAddSettings(original, buildQuickAddInboxChoice(bundle.templates[0]!.path));
    expect(merged).toMatchObject({ keepMe: true });
    expect(merged.choices).toHaveLength(2);
    expect(merged.choices[0]).toEqual(original.choices[0]);
    expect(() => mergeQuickAddSettings({ choices: [{ id: 'mcpvault-host-inbox', name: 'Custom', type: 'Capture' }] }, buildQuickAddInboxChoice(bundle.templates[0]!.path))).toThrow('existing QuickAdd choice');
  });

  test('merges only the authorized plugin IDs into Obsidian community enablement', () => {
    expect(mergeCommunityPlugins(['another-plugin', 'quickadd'])).toEqual(['another-plugin', 'quickadd', 'metadata-menu']);
    expect(() => mergeCommunityPlugins(['another-plugin', 7] as unknown as string[])).toThrow('strings');
  });

  test('plans recoverable backups for absent and present settings without writing host state', async () => {
    const vault = await temporaryVault();
    const quickAddSettings = join(vault, '.obsidian', 'plugins', 'quickadd', 'data.json');
    await mkdir(join(vault, '.obsidian', 'plugins', 'quickadd'), { recursive: true });
    await writeFile(quickAddSettings, JSON.stringify({ choices: [] }), 'utf8');

    const plan = await planInstall({ vaultPath: vault, expectedTarget: vault, bundle, dryRun: true });

    expect(plan.action).toBe('install');
    expect(plan.writes.map((entry) => entry.relativePath)).toEqual(expect.arrayContaining([
      '.obsidian/plugins/quickadd/data.json',
      '.obsidian/plugins/metadata-menu/data.json',
      '.obsidian/community-plugins.json',
      'Templates/MCPVault/Inbox.md',
      'Templates/MCPVault/FileClasses/Inbox.md',
    ]));
    expect(plan.backups.find((entry) => entry.relativePath === '.obsidian/plugins/quickadd/data.json')).toMatchObject({ existed: true });
    expect(plan.backups.find((entry) => entry.relativePath === '.obsidian/plugins/metadata-menu/data.json')).toMatchObject({ existed: false });
    await expect(readFile(quickAddSettings, 'utf8')).resolves.toBe(JSON.stringify({ choices: [] }));
  });

  test('refuses a non-owned visible generated template before any release download', async () => {
    const vault = await temporaryVault();
    const templatePath = join(vault, bundle.templates[0]!.path);
    await mkdir(join(templatePath, '..'), { recursive: true });
    await writeFile(templatePath, 'human authored template', 'utf8');
    await expect(planInstall({ vaultPath: vault, expectedTarget: vault, bundle })).rejects.toThrow('non-owned generated file');
  });

  test('records official release asset hashes and restores both present and absent host files', async () => {
    const vault = await temporaryVault();
    const quickAddSettings = join(vault, '.obsidian', 'plugins', 'quickadd', 'data.json');
    await mkdir(join(vault, '.obsidian', 'plugins', 'quickadd'), { recursive: true });
    await writeFile(quickAddSettings, JSON.stringify({ choices: [] }), 'utf8');
    await writeFile(join(vault, '.obsidian', 'community-plugins.json'), JSON.stringify(['another-plugin']), 'utf8');
    const fetchImpl = async (url: string) => {
      if (url.includes('/releases/latest')) {
        const repository = url.includes('/quickadd/') ? 'chhoumann/quickadd' : 'mdelobelle/metadatamenu';
        const id = repository === 'chhoumann/quickadd' ? 'quickadd' : 'metadata-menu';
        return new Response(JSON.stringify({
          tag_name: '1.2.3',
          html_url: `https://github.com/${repository}/releases/tag/1.2.3`,
          assets: ['main.js', 'manifest.json'].map((name) => ({ name, browser_download_url: `https://github.com/${repository}/releases/download/1.2.3/${name}` })),
        }), { status: 200 });
      }
      if (url.endsWith('/manifest.json')) {
        const id = url.includes('/quickadd/') ? 'quickadd' : 'metadata-menu';
        return new Response(JSON.stringify({ id, version: '1.2.3', minAppVersion: '1.0.0' }), { status: 200 });
      }
      return new Response(`official asset: ${url}`, { status: 200 });
    };

    const report = await install({ vaultPath: vault, expectedTarget: vault, bundle, fetchImpl });

    expect(report.downloads).toHaveLength(2);
    expect(report.downloads[0]!.assets[0]!.sha256).toMatch(/^[a-f0-9]{64}$/);
    const metadataSettings = JSON.parse(await readFile(join(vault, '.obsidian/plugins/metadata-menu/data.json'), 'utf8'));
    // Upstream concatenates classFilesPath + className and slices this prefix.
    expect(metadataSettings.classFilesPath).toBe('Templates/MCPVault/FileClasses/');
    expect(await readFile(join(vault, '.obsidian', 'community-plugins.json'), 'utf8')).toBe(JSON.stringify(['another-plugin', 'quickadd', 'metadata-menu'], null, 2) + '\n');
    await expect(status({ vaultPath: vault, expectedTarget: vault })).resolves.toMatchObject({
      plugins: [
        { id: 'quickadd', installed: true, enabled: true, configValid: true, manifestValid: true },
        { id: 'metadata-menu', installed: true, enabled: true, configValid: true, manifestValid: true },
      ],
    });
    await expect(readFile(join(vault, '.obsidian', 'plugins', 'quickadd', 'main.js'), 'utf8')).resolves.toContain('official asset');
    await writeFile(join(vault, bundle.templates[0]!.path), 'post-install user edit', 'utf8');
    await expect(restore({ vaultPath: vault, expectedTarget: vault, backup: report.backup })).resolves.toMatchObject({ conflicts: [{ relativePath: bundle.templates[0]!.path }] });
    await expect(readFile(join(vault, bundle.templates[0]!.path), 'utf8')).resolves.toBe('post-install user edit');
    await writeFile(join(vault, bundle.templates[0]!.path), bundle.templates[0]!.content, 'utf8');
    await restore({ vaultPath: vault, expectedTarget: vault, backup: report.backup });
    await expect(readFile(quickAddSettings, 'utf8')).resolves.toBe(JSON.stringify({ choices: [] }));
    await expect(readFile(join(vault, '.obsidian', 'plugins', 'quickadd', 'main.js'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(readFile(join(vault, bundle.templates[0]!.path), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  test('rejects release assets that are not exact official GitHub release downloads', async () => {
    const vault = await temporaryVault();
    const fetchImpl = async (url: string) => new Response(JSON.stringify({
      tag_name: '1.2.3',
      assets: ['main.js', 'manifest.json'].map((name) => ({ name, browser_download_url: `https://example.invalid/${name}` })),
    }), { status: url.includes('/releases/latest') ? 200 : 404 });
    await expect(install({ vaultPath: vault, expectedTarget: vault, bundle, fetchImpl })).rejects.toThrow('official release asset URL');
  });

  test('rejects a release asset larger than the 16 MiB download bound before buffering it', async () => {
    const vault = await temporaryVault();
    const fetchImpl = async (url: string) => {
      if (url.includes('/releases/latest')) {
        const repository = url.includes('/quickadd/') ? 'chhoumann/quickadd' : 'mdelobelle/metadatamenu';
        return new Response(JSON.stringify({
          tag_name: '1.2.3',
          assets: ['main.js', 'manifest.json'].map((name) => ({ name, browser_download_url: `https://github.com/${repository}/releases/download/1.2.3/${name}` })),
        }), { status: 200 });
      }
      return new Response('small body', { status: 200, headers: { 'content-length': '16777217' } });
    };
    await expect(install({ vaultPath: vault, expectedTarget: vault, bundle, fetchImpl })).rejects.toThrow('size limit');
  });
});
