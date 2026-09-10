import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKUP_ROOT = '.obsidian/mcpvault-host-plugins/backups';
const QUICKADD_ID = 'quickadd';
const METADATA_MENU_ID = 'metadata-menu';
const QUICKADD_CHOICE_ID = 'mcpvault-host-inbox';
const TEMPLATE_ROOT = 'Templates/MCPVault';
const FILE_CLASSES_PATH = 'Templates/MCPVault/FileClasses';
const MAX_TEMPLATES = 8;
const MAX_FILE_CLASSES = 8;
const MAX_BUNDLE_FILE_BYTES = 64 * 1024;
const MAX_BUNDLE_BYTES = 256 * 1024;
const MAX_RELEASE_METADATA_BYTES = 1024 * 1024;
const MAX_RELEASE_ASSET_BYTES = 16 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const COMMUNITY_PLUGINS_PATH = '.obsidian/community-plugins.json';
const PLUGINS = [
  { id: QUICKADD_ID, repository: 'chhoumann/quickadd' },
  { id: METADATA_MENU_ID, repository: 'mdelobelle/metadatamenu' },
];

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function asObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value;
}

function assertVaultRelative(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty vault-relative path`);
  if (value.replaceAll('\\', '/').split('/').includes('..')) throw new Error(`${label} must be a vault-relative path`);
  const normalized = normalize(value.replaceAll('\\', '/'));
  if (isAbsolute(value) || normalized === '..' || normalized.startsWith(`..${sep}`) || normalized.includes(`..${sep}`)) {
    throw new Error(`${label} must be a vault-relative path`);
  }
  return normalized.replaceAll('\\', '/');
}

function assertBundleFile(value, label) {
  const file = asObject(value, label);
  const path = assertVaultRelative(file.path, `${label}.path`);
  if (!path.endsWith('.md')) throw new Error(`${label}.path must name a Markdown file`);
  if (typeof file.content !== 'string' || !file.content) throw new Error(`${label}.content must be non-empty text`);
  if (Buffer.byteLength(file.content, 'utf8') > MAX_BUNDLE_FILE_BYTES) throw new Error(`${label}.content exceeds the bundle file size limit`);
  return { path, content: file.content };
}

function assertManagedTemplatePath(path, label) {
  if (!path.startsWith(`${TEMPLATE_ROOT}/`)) throw new Error(`${label} must be inside ${TEMPLATE_ROOT}/`);
}

function fieldHasType(content, name, type) {
  return new RegExp(`name:\\s*["']?${name}\\b[\\s\\S]{0,512}?type:\\s*${type}\\b`, 'i').test(content);
}

/** Validates, but deliberately does not interpret, the server-owned property contract. */
export function validateBundle(value) {
  const bundle = asObject(value, 'bundle');
  if (typeof bundle.fingerprint !== 'string' || !/^sha256:[a-f0-9]{64}$/i.test(bundle.fingerprint)) {
    throw new Error('bundle fingerprint must be sha256:<64 hexadecimal characters>');
  }
  if (!Array.isArray(bundle.templates) || bundle.templates.length === 0 || bundle.templates.length > MAX_TEMPLATES) throw new Error(`bundle.templates must contain 1-${MAX_TEMPLATES} templates`);
  if (!Array.isArray(bundle.fileClasses) || bundle.fileClasses.length === 0 || bundle.fileClasses.length > MAX_FILE_CLASSES) throw new Error(`bundle.fileClasses must contain 1-${MAX_FILE_CLASSES} file classes`);
  const fileClassesPath = assertVaultRelative(bundle.fileClassesPath, 'bundle.fileClassesPath');
  if (fileClassesPath !== FILE_CLASSES_PATH) throw new Error(`bundle.fileClassesPath must be ${FILE_CLASSES_PATH}`);
  const templates = bundle.templates.map((entry, index) => assertBundleFile(entry, `bundle.templates[${index}]`));
  const fileClasses = bundle.fileClasses.map((entry, index) => assertBundleFile(entry, `bundle.fileClasses[${index}]`));
  if ([...templates, ...fileClasses].reduce((total, entry) => total + Buffer.byteLength(entry.content, 'utf8'), 0) > MAX_BUNDLE_BYTES) {
    throw new Error('bundle content exceeds the total size limit');
  }
  for (const template of templates) {
    assertManagedTemplatePath(template.path, 'template path');
    if (/\{\{\s*(?:js|macro)\b|<%|\btp\.|\bdataview\b|\bdv\s*\./i.test(template.content)) {
      throw new Error('templates must not contain executable syntax');
    }
  }
  const inboxTemplate = templates[0];
  if (!/^title:\s*["']{2}\s*$/im.test(inboxTemplate.content) || !/^tags:\s*/im.test(inboxTemplate.content) || !/^fileClass:\s*Inbox\s*$/im.test(inboxTemplate.content) || !/^#\s+\{\{VALUE:title\}\}/m.test(inboxTemplate.content) || !/\{\{VALUE:content\}\}/.test(inboxTemplate.content)) {
    throw new Error('the QuickAdd Inbox template must contain an empty title, tags, fileClass, title heading, and content prompt');
  }
  for (const fileClass of fileClasses) {
    if (!fileClass.path.startsWith(`${FILE_CLASSES_PATH}/`)) throw new Error(`file class path must be inside ${FILE_CLASSES_PATH}/`);
    if (!fieldHasType(fileClass.content, 'title', 'Input') || !fieldHasType(fileClass.content, 'tags', 'Multi')) {
      throw new Error('each Metadata Menu file class must define title as Input and tags as Multi');
    }
    if (!new RegExp(`contract_fingerprint:\\s*${bundle.fingerprint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'im').test(fileClass.content)) {
      throw new Error('each Metadata Menu file class must carry the bundle contract_fingerprint');
    }
    if (/name:\s*["']?(?:scope|auth(?:entication|orization)?|review|proof)\b/i.test(fileClass.content)) {
      throw new Error('Metadata Menu file classes must not define scope, auth, review, or proof fields');
    }
    if (/\bdataview\b|\bdv\s*\.|dvQueryString/i.test(fileClass.content)) throw new Error('Metadata Menu file classes must not require Dataview');
  }
  const names = [...templates, ...fileClasses].map((entry) => entry.path.toLocaleLowerCase());
  if (new Set(names).size !== names.length) throw new Error('bundle paths must be unique');
  const classRoot = fileClassesPath.replace(/\/$/, '');
  if (!fileClasses.every((entry) => entry.path === classRoot || entry.path.startsWith(`${classRoot}/`))) {
    throw new Error('every file class must be inside bundle.fileClassesPath');
  }
  return value;
}

/** Uses the built server exporter as the single authoritative contract source. */
export async function loadDefaultBundle() {
  let authoringAssist;
  try {
    authoringAssist = await import(new URL('../dist/src/authoring-assist.js', import.meta.url));
  } catch {
    throw new Error('could not load built dist/src/authoring-assist.js; provide --bundle for an explicit generated contract');
  }
  if (typeof authoringAssist.hostPluginBundle !== 'function') throw new Error('built authoring-assist module does not export hostPluginBundle()');
  return validateBundle(authoringAssist.hostPluginBundle());
}

function assertCanonicalPathSpelling(value) {
  if (typeof value !== 'string' || !isAbsolute(value)) throw new Error('target and confirmed target must be absolute paths');
  // Check the original spelling: resolve/join erase traversal across a junction.
  if (value.split(/[\\/]/).some(part => part === '..' || part === '.') || /[\x00-\x1f]/.test(value)) {
    throw new Error('use canonical paths without traversal components');
  }
  if (/^(?:[\\/]{2}[?.][\\/]|[\\/]\?\?[\\/])/.test(value)) {
    throw new Error('use canonical paths without Windows device namespace aliases');
  }
}

async function assertOrdinaryPath(absolutePath, expectedType) {
  assertCanonicalPathSpelling(absolutePath);
  const absolute = resolve(absolutePath);
  let cursor = parse(absolute).root;
  const remaining = absolute.slice(cursor.length).split(sep).filter(Boolean);
  for (const part of remaining) {
    cursor = join(cursor, part);
    const stat = await lstat(cursor);
    if (stat.isSymbolicLink()) throw new Error(`refusing symlink path: ${cursor}`);
    if (cursor !== absolute && !stat.isDirectory()) throw new Error(`path ancestor is not a directory: ${cursor}`);
    if (cursor === absolute && expectedType === 'directory' && !stat.isDirectory()) throw new Error(`not a directory: ${cursor}`);
    if (cursor === absolute && expectedType === 'file' && !stat.isFile()) throw new Error(`not a file: ${cursor}`);
  }
  return absolute;
}

/** Confines every mutating action to a user-supplied, exact, pre-existing vault. */
export async function validateTargetPath(targetPath, expectedTarget) {
  if (typeof expectedTarget !== 'string' || !expectedTarget) throw new Error('an explicit confirmed target path is required');
  assertCanonicalPathSpelling(targetPath);
  assertCanonicalPathSpelling(expectedTarget);
  const target = resolve(targetPath);
  const expected = resolve(expectedTarget);
  if (target !== expected) throw new Error('target must match the exact target path');
  await assertOrdinaryPath(targetPath, 'directory');
  await assertOrdinaryPath(expectedTarget, 'directory');
  const canonicalTarget = await realpath(target);
  const canonicalExpected = await realpath(expected);
  if (canonicalTarget !== canonicalExpected) throw new Error('target must match the exact target realpath');
  await assertOrdinaryPath(canonicalTarget, 'directory');
  await assertOrdinaryPath(join(canonicalTarget, '.obsidian'), 'directory');
  return canonicalTarget;
}

export function buildQuickAddInboxChoice(templatePath) {
  return {
    id: QUICKADD_CHOICE_ID,
    name: 'MCPVault: New Inbox note',
    type: 'Template',
    command: false,
    templatePath: assertVaultRelative(templatePath, 'template path'),
    fileNameFormat: { enabled: true, format: '{{DATE:YYYYMMDD-HHmmssSSS}}' },
    discoverExistingNotesBeforeCreate: false,
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
    fileOpening: { location: 'tab', direction: 'vertical', mode: 'default', focus: true },
    fileExistsBehavior: { kind: 'apply', mode: 'duplicateSuffix' },
  };
}

export function mergeQuickAddSettings(settings, choice) {
  const next = structuredClone(asObject(settings, 'QuickAdd settings'));
  if (next.choices === undefined) next.choices = [];
  if (!Array.isArray(next.choices)) throw new Error('QuickAdd settings.choices must be an array');
  const existing = next.choices.find((entry) => entry && (entry.id === choice.id || entry.name === choice.name));
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(choice)) throw new Error('existing QuickAdd choice belongs to a user or differs from this installer');
    return next;
  }
  next.choices.push(choice);
  return next;
}

/** Preserves the user's enabled plugin ordering and adds only the two authorized IDs. */
export function mergeCommunityPlugins(pluginIds) {
  if (!Array.isArray(pluginIds) || pluginIds.some((id) => typeof id !== 'string')) throw new Error('community-plugins.json must be an array of strings');
  const next = [...pluginIds];
  for (const plugin of PLUGINS) if (!next.includes(plugin.id)) next.push(plugin.id);
  return next;
}

function mergeMetadataMenuSettings(settings, fileClassesPath) {
  const next = structuredClone(asObject(settings, 'Metadata Menu settings'));
  const configured = next.classFilesPath;
  if (configured !== undefined && configured !== null && configured !== fileClassesPath && configured !== `${fileClassesPath}/`) {
    throw new Error('Metadata Menu already uses a different classFilesPath; refusing to replace user settings');
  }
  // Metadata Menu concatenates this value with the class basename directly.
  next.classFilesPath = `${fileClassesPath}/`;
  // These defaults apply only to an absent plugin settings file. Existing choices stay intact.
  if (next.frontmatterOnly === undefined) next.frontmatterOnly = true;
  if (next.chooseFileClassAtFileCreation === undefined) next.chooseFileClassAtFileCreation = false;
  if (next.autoInsertFieldsAtFileClassInsertion === undefined) next.autoInsertFieldsAtFileClassInsertion = false;
  return next;
}

async function readOptionalFile(absolutePath) {
  try {
    await assertOrdinaryPath(absolutePath, 'file');
    return await readFile(absolutePath);
  } catch (error) {
    if (error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}

async function readSettingsSnapshot(vaultPath, relativePath) {
  const content = await readOptionalFile(join(vaultPath, relativePath));
  if (content === undefined) return { settings: {}, sha256: undefined };
  try {
    return { settings: asObject(JSON.parse(content.toString('utf8')), `${relativePath} JSON`), sha256: sha256(content) };
  } catch {
    throw new Error(`${relativePath} is not valid JSON; refusing to overwrite it`);
  }
}

async function readCommunityPluginsSnapshot(vaultPath) {
  const content = await readOptionalFile(join(vaultPath, COMMUNITY_PLUGINS_PATH));
  if (content === undefined) return { pluginIds: mergeCommunityPlugins([]), sha256: undefined };
  try {
    return { pluginIds: mergeCommunityPlugins(JSON.parse(content.toString('utf8'))), sha256: sha256(content) };
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${COMMUNITY_PLUGINS_PATH} is not valid JSON; refusing to overwrite it`);
    throw error;
  }
}

function textCandidate(relativePath, content, source = undefined) {
  const bytes = Buffer.from(content, 'utf8');
  return { relativePath: assertVaultRelative(relativePath, 'write path'), bytes, sha256: sha256(bytes), source };
}

function publicEntry(candidate) {
  return { relativePath: candidate.relativePath, sha256: candidate.sha256, bytes: candidate.bytes.length, ...(candidate.source ? { source: candidate.source } : {}) };
}

async function prepareInstall(options) {
  const vaultPath = await validateTargetPath(options.vaultPath, options.expectedTarget);
  const bundle = validateBundle(options.bundle);
  const quickAddPath = `.obsidian/plugins/${QUICKADD_ID}/data.json`;
  const metadataMenuPath = `.obsidian/plugins/${METADATA_MENU_ID}/data.json`;
  const [quickAddSnapshot, metadataMenuSnapshot, communityPluginsSnapshot] = await Promise.all([
    readSettingsSnapshot(vaultPath, quickAddPath),
    readSettingsSnapshot(vaultPath, metadataMenuPath),
    readCommunityPluginsSnapshot(vaultPath),
  ]);
  const quickAdd = mergeQuickAddSettings(quickAddSnapshot.settings, buildQuickAddInboxChoice(bundle.templates[0].path));
  const metadataMenu = mergeMetadataMenuSettings(metadataMenuSnapshot.settings, bundle.fileClassesPath);
  const desired = [
    { ...textCandidate(COMMUNITY_PLUGINS_PATH, `${JSON.stringify(communityPluginsSnapshot.pluginIds, null, 2)}\n`), expectedSha256: communityPluginsSnapshot.sha256 },
    { ...textCandidate(quickAddPath, `${JSON.stringify(quickAdd, null, 2)}\n`), expectedSha256: quickAddSnapshot.sha256 },
    { ...textCandidate(metadataMenuPath, `${JSON.stringify(metadataMenu, null, 2)}\n`), expectedSha256: metadataMenuSnapshot.sha256 },
    ...bundle.templates.map((entry) => textCandidate(entry.path, entry.content)),
    ...bundle.fileClasses.map((entry) => textCandidate(entry.path, entry.content)),
  ];
  const writes = [];
  for (const candidate of desired) {
    const existing = await readOptionalFile(join(vaultPath, candidate.relativePath));
    const actualSha256 = existing ? sha256(existing) : undefined;
    if (Object.hasOwn(candidate, 'expectedSha256') && (candidate.expectedSha256 !== undefined ? actualSha256 !== candidate.expectedSha256 : actualSha256 !== undefined)) {
      throw new Error(`host file changed during install planning: ${candidate.relativePath}`);
    }
    if (existing?.equals(candidate.bytes)) continue;
    if ((candidate.relativePath.startsWith(`${TEMPLATE_ROOT}/`)) && existing) {
      const owner = await findGeneratedOwnership(vaultPath, candidate.relativePath, sha256(existing));
      if (!owner) throw new Error(`refusing to overwrite a non-owned generated file: ${candidate.relativePath}`);
    }
    writes.push({ ...candidate, expectedSha256: actualSha256 });
  }
  return { vaultPath, bundle, writes };
}

/** Read-only preflight: reports hashes and paths but never serializes existing host configuration. */
export async function planInstall(options) {
  const prepared = await prepareInstall(options);
  return {
    action: 'install',
    fingerprint: prepared.bundle.fingerprint,
    writes: prepared.writes.map(publicEntry),
    backups: prepared.writes.map((candidate) => ({ relativePath: candidate.relativePath, existed: candidate.expectedSha256 !== undefined, ...(candidate.expectedSha256 ? { sha256: candidate.expectedSha256 } : {}) })),
  };
}

async function mkdirSafe(absoluteDirectory) {
  const absolute = resolve(absoluteDirectory);
  let cursor = parse(absolute).root;
  for (const part of absolute.slice(cursor.length).split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    try {
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error(`refusing unsafe directory path: ${cursor}`);
    } catch (error) {
      if (!error || error.code !== 'ENOENT') throw error;
      await mkdir(cursor);
      const created = await lstat(cursor);
      if (created.isSymbolicLink() || !created.isDirectory()) throw new Error(`refusing unsafe created directory: ${cursor}`);
    }
  }
}

async function writeAtomic(absolutePath, bytes) {
  await mkdirSafe(dirname(absolutePath));
  const temporaryPath = `${absolutePath}.mcpvault-${randomUUID()}.tmp`;
  await writeFile(temporaryPath, bytes, { flag: 'wx' });
  await rename(temporaryPath, absolutePath);
}

function releaseAssetUrl(plugin, tag, name) {
  return `https://github.com/${plugin.repository}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;
}

function assertOfficialReleaseAssetUrl(plugin, tag, asset) {
  if (!asset || typeof asset.name !== 'string' || asset.browser_download_url !== releaseAssetUrl(plugin, tag, asset.name)) {
    throw new Error(`official release asset URL is invalid for ${plugin.id}`);
  }
}

function isOfficialRedirectUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'].includes(url.hostname);
  } catch {
    return false;
  }
}

async function readBoundedResponse(response, maximumBytes, label) {
  const contentLength = response.headers.get('content-length');
  if (contentLength && Number.isSafeInteger(Number(contentLength)) && Number(contentLength) > maximumBytes) throw new Error(`${label} exceeds the size limit`);
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error(`${label} exceeds the size limit`);
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, total);
}

async function fetchOfficial(fetchImpl, url, label) {
  const signal = AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS);
  const response = await fetchImpl(url, {
    signal,
    redirect: 'follow',
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'mcpvault-host-plugin-installer' },
  });
  if (!response.ok) throw new Error(`could not download ${label} (${response.status})`);
  // Node fetch follows redirects by default. The exact GitHub release URL is
  // checked before fetch; this verifies the final host after that redirect.
  if (response.url) {
    const metadataRequest = url.startsWith('https://api.github.com/');
    if ((metadataRequest && new URL(response.url).hostname !== 'api.github.com') || (!metadataRequest && !isOfficialRedirectUrl(response.url))) {
      throw new Error(`redirected ${label} to a non-GitHub host`);
    }
  }
  return response;
}

function validatePluginManifest(plugin, releaseTag, bytes) {
  let manifest;
  try { manifest = asObject(JSON.parse(bytes.toString('utf8')), `${plugin.id} manifest`); } catch { throw new Error(`official ${plugin.id} manifest.json is invalid`); }
  if (manifest.id !== plugin.id || typeof manifest.version !== 'string' || !manifest.version || typeof manifest.minAppVersion !== 'string' || !manifest.minAppVersion) {
    throw new Error(`official ${plugin.id} manifest has an unexpected id, version, or minAppVersion`);
  }
  if (manifest.version.replace(/^v/, '') !== releaseTag.replace(/^v/, '')) throw new Error(`official ${plugin.id} manifest version does not match the release tag`);
  return { id: manifest.id, version: manifest.version, minAppVersion: manifest.minAppVersion };
}

async function downloadRelease(plugin, fetchImpl) {
  const apiUrl = `https://api.github.com/repos/${plugin.repository}/releases/latest`;
  const releaseResponse = await fetchOfficial(fetchImpl, apiUrl, `official ${plugin.id} release metadata`);
  let release;
  try { release = JSON.parse((await readBoundedResponse(releaseResponse, MAX_RELEASE_METADATA_BYTES, `official ${plugin.id} release metadata`)).toString('utf8')); } catch (error) { if (error instanceof SyntaxError) throw new Error(`official ${plugin.id} release metadata is invalid JSON`); throw error; }
  if (!release || typeof release.tag_name !== 'string' || !Array.isArray(release.assets)) throw new Error(`official ${plugin.id} release metadata is incomplete`);
  const required = ['main.js', 'manifest.json'];
  const selected = required.map((name) => release.assets.find((asset) => asset?.name === name));
  if (selected.some((asset) => !asset?.browser_download_url)) throw new Error(`official ${plugin.id} release is missing a required asset`);
  const styles = release.assets.find((asset) => asset?.name === 'styles.css');
  if (styles?.browser_download_url) selected.push(styles);
  const assets = [];
  for (const asset of selected) {
    assertOfficialReleaseAssetUrl(plugin, release.tag_name, asset);
    const response = await fetchOfficial(fetchImpl, asset.browser_download_url, `official ${plugin.id} asset ${asset.name}`);
    const bytes = await readBoundedResponse(response, MAX_RELEASE_ASSET_BYTES, `official ${plugin.id} asset ${asset.name}`);
    assets.push({ name: asset.name, source: asset.browser_download_url, bytes, sha256: sha256(bytes) });
  }
  const manifestAsset = assets.find((asset) => asset.name === 'manifest.json');
  const manifest = validatePluginManifest(plugin, release.tag_name, manifestAsset.bytes);
  return { id: plugin.id, repository: plugin.repository, version: manifest.version, minAppVersion: manifest.minAppVersion, source: release.html_url ?? apiUrl, assets };
}

async function currentHash(vaultPath, relativePath) {
  const bytes = await readOptionalFile(join(vaultPath, relativePath));
  return bytes === undefined ? undefined : sha256(bytes);
}

async function assertExpectedHash(vaultPath, candidate) {
  const actual = await currentHash(vaultPath, candidate.relativePath);
  if (actual !== candidate.expectedSha256) throw new Error(`host file changed before write: ${candidate.relativePath}`);
}

async function createBackup(vaultPath, writes, bundleFingerprint, downloads) {
  const id = `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${randomUUID()}`;
  const root = join(vaultPath, BACKUP_ROOT, id);
  await mkdirSafe(join(root, 'files'));
  const entries = [];
  for (const candidate of writes) {
    await assertExpectedHash(vaultPath, candidate);
    const source = await readOptionalFile(join(vaultPath, candidate.relativePath));
    const backup = { relativePath: candidate.relativePath, existed: source !== undefined, installedSha256: candidate.sha256 };
    if (source) {
      backup.originalSha256 = sha256(source);
      backup.backupPath = `files/${sha256(candidate.relativePath)}.bak`;
      await writeAtomic(join(root, backup.backupPath), source);
    }
    entries.push(backup);
  }
  const manifest = {
    format: 2,
    createdAt: new Date().toISOString(),
    bundleFingerprint,
    files: entries,
    downloads: downloads.map((download) => ({
      id: download.id,
      repository: download.repository,
      version: download.version,
      minAppVersion: download.minAppVersion,
      source: download.source,
      assets: download.assets.map(({ name, source, sha256: digest, bytes }) => ({ name, source, sha256: digest, bytes: bytes.length })),
    })),
  };
  await writeAtomic(join(root, 'manifest.json'), Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`));
  return { id, relativePath: `${BACKUP_ROOT}/${id}`, manifest };
}

async function prepareDownloadedWrites(vaultPath, downloads) {
  const writes = [];
  for (const download of downloads) {
    for (const asset of download.assets) {
      const relativePath = `.obsidian/plugins/${download.id}/${asset.name}`;
      const existing = await readOptionalFile(join(vaultPath, relativePath));
      if (existing?.equals(asset.bytes)) continue;
      writes.push({ relativePath, bytes: asset.bytes, sha256: asset.sha256, source: asset.source, expectedSha256: existing ? sha256(existing) : undefined });
    }
  }
  return writes;
}

async function backupDirectories(vaultPath) {
  try {
    return (await readdir(join(vaultPath, BACKUP_ROOT), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
      .reverse();
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

async function findGeneratedOwnership(vaultPath, relativePath, currentSha256) {
  for (const directory of await backupDirectories(vaultPath)) {
    const manifestPath = join(vaultPath, BACKUP_ROOT, directory, 'manifest.json');
    const bytes = await readOptionalFile(manifestPath);
    if (!bytes || bytes.length > MAX_RELEASE_METADATA_BYTES) continue;
    try {
      const manifest = asObject(JSON.parse(bytes.toString('utf8')), 'backup manifest');
      const entry = Array.isArray(manifest.files) && manifest.files.find((file) => file?.relativePath === relativePath);
      if (manifest.format === 2 && entry?.installedSha256 === currentSha256) return { backup: directory };
    } catch {
      // A damaged historical backup must never authorize replacing a visible file.
    }
  }
  return undefined;
}

async function restoreManifest(vaultPath, backupRoot, manifest) {
  const conflicts = [];
  let restored = 0;
  for (const entry of manifest.files) {
    const relativePath = assertRestorePath(asObject(entry, 'backup entry').relativePath);
    const target = join(vaultPath, relativePath);
    const actual = await currentHash(vaultPath, relativePath);
    const original = entry.existed ? entry.originalSha256 : undefined;
    if (actual === original) continue;
    if (actual !== entry.installedSha256) {
      conflicts.push({ relativePath });
      continue;
    }
    if (entry.existed) {
      const backupFile = assertVaultRelative(entry.backupPath, 'backup entry path');
      const bytes = await readOptionalFile(join(backupRoot, backupFile));
      if (!bytes || sha256(bytes) !== entry.originalSha256) throw new Error(`backup content is invalid for ${relativePath}`);
      await writeAtomic(target, bytes);
    } else {
      await rm(target, { force: true });
    }
    restored += 1;
  }
  return { restored, conflicts };
}

async function generatedContractMatches(vaultPath, bundle) {
  const validated = validateBundle(bundle);
  for (const entry of [...validated.templates, ...validated.fileClasses]) {
    const current = await readOptionalFile(join(vaultPath, entry.path));
    if (!current || sha256(current) !== sha256(Buffer.from(entry.content, 'utf8'))) return false;
  }
  // FileClass validation already binds contract_fingerprint to the exact bundle
  // fingerprint; matching the bytes therefore also proves fingerprint freshness.
  return true;
}

/** Downloads only the two authorized plugins, then writes them and generated contract artifacts. */
export async function install(options) {
  const prepared = await prepareInstall(options);
  const fetchImpl = options.fetchImpl ?? fetch;
  const downloads = [];
  for (const plugin of PLUGINS) downloads.push(await downloadRelease(plugin, fetchImpl));
  const writes = [...prepared.writes, ...await prepareDownloadedWrites(prepared.vaultPath, downloads)];
  const backup = await createBackup(prepared.vaultPath, writes, prepared.bundle.fingerprint, downloads);
  try {
    for (const candidate of writes) {
      await assertExpectedHash(prepared.vaultPath, candidate);
      await writeAtomic(join(prepared.vaultPath, candidate.relativePath), candidate.bytes);
    }
  } catch (error) {
    const rollback = await restoreManifest(prepared.vaultPath, join(prepared.vaultPath, backup.relativePath), backup.manifest);
    throw new Error(`install failed; rollback restored ${rollback.restored} file(s) with ${rollback.conflicts.length} conflict(s): ${error instanceof Error ? error.message : 'unknown error'}`);
  }
  return { action: 'install', fingerprint: prepared.bundle.fingerprint, backup: backup.relativePath, writes: writes.map(publicEntry), downloads: backup.manifest.downloads };
}

export async function status(options) {
  const vaultPath = await validateTargetPath(options.vaultPath, options.expectedTarget);
  let generatedContractMatchesResult = false;
  if (options.bundle !== undefined) {
    generatedContractMatchesResult = await generatedContractMatches(vaultPath, options.bundle);
  } else {
    try { generatedContractMatchesResult = await generatedContractMatches(vaultPath, await loadDefaultBundle()); } catch { generatedContractMatchesResult = false; }
  }
  const communityBytes = await readOptionalFile(join(vaultPath, COMMUNITY_PLUGINS_PATH));
  let communityPlugins;
  try {
    const parsed = communityBytes ? JSON.parse(communityBytes.toString('utf8')) : [];
    communityPlugins = Array.isArray(parsed) && parsed.every((id) => typeof id === 'string') ? parsed : undefined;
  } catch { communityPlugins = undefined; }
  const quickAddSettings = await readOptionalFile(join(vaultPath, `.obsidian/plugins/${QUICKADD_ID}/data.json`));
  const metadataMenuSettings = await readOptionalFile(join(vaultPath, `.obsidian/plugins/${METADATA_MENU_ID}/data.json`));
  let quickAddConfigValid = false;
  let metadataMenuConfigValid = false;
  try {
    const settings = asObject(JSON.parse(quickAddSettings?.toString('utf8') ?? '{}'), 'QuickAdd settings');
    quickAddConfigValid = Array.isArray(settings.choices) && settings.choices.some((choice) => choice?.id === QUICKADD_CHOICE_ID
      && choice.name === 'MCPVault: New Inbox note'
      && choice.type === 'Template'
      && choice.command === false
      && choice.templatePath === `${TEMPLATE_ROOT}/Inbox.md`
      && choice.fileNameFormat?.format === '{{DATE:YYYYMMDD-HHmmssSSS}}'
      && choice.appendLink === false
      && choice.fileExistsBehavior?.kind === 'apply'
      && choice.fileExistsBehavior?.mode === 'duplicateSuffix');
  } catch { quickAddConfigValid = false; }
  try {
    const settings = asObject(JSON.parse(metadataMenuSettings?.toString('utf8') ?? '{}'), 'Metadata Menu settings');
    metadataMenuConfigValid = settings.classFilesPath === `${FILE_CLASSES_PATH}/` && settings.frontmatterOnly === true
      && settings.chooseFileClassAtFileCreation === false && settings.autoInsertFieldsAtFileClassInsertion === false;
  } catch { metadataMenuConfigValid = false; }
  const plugins = [];
  for (const plugin of PLUGINS) {
    const manifest = await readOptionalFile(join(vaultPath, `.obsidian/plugins/${plugin.id}/manifest.json`));
    let manifestInfo;
    if (manifest) {
      try {
        const parsed = JSON.parse(manifest.toString('utf8'));
        manifestInfo = validatePluginManifest(plugin, parsed.version, manifest);
      } catch { manifestInfo = undefined; }
    }
    const enabled = communityPlugins?.includes(plugin.id) ?? false;
    const configValid = plugin.id === QUICKADD_ID ? quickAddConfigValid : metadataMenuConfigValid;
    plugins.push({ id: plugin.id, installed: manifest !== undefined, enabled, manifestValid: manifestInfo !== undefined, configValid, ...(manifestInfo ? { version: manifestInfo.version, minAppVersion: manifestInfo.minAppVersion } : {}) });
  }
  return { action: 'status', generatedContractMatches: generatedContractMatchesResult, communityPluginsValid: communityPlugins !== undefined, plugins, backups: await backupDirectories(vaultPath) };
}

function assertRestorePath(value) {
  const path = assertVaultRelative(value, 'restore path');
  if (path !== COMMUNITY_PLUGINS_PATH && !path.startsWith('.obsidian/plugins/') && !path.startsWith(`${TEMPLATE_ROOT}/`)) throw new Error('restore manifest contains an out-of-scope path');
  return path;
}

export async function restore(options) {
  const vaultPath = await validateTargetPath(options.vaultPath, options.expectedTarget);
  const backupPath = assertVaultRelative(options.backup, 'backup');
  if (!backupPath.startsWith(`${BACKUP_ROOT}/`)) throw new Error('backup must be inside the installer backup directory');
  const backupRoot = join(vaultPath, backupPath);
  await assertOrdinaryPath(backupRoot, 'directory');
  const manifestBytes = await readOptionalFile(join(backupRoot, 'manifest.json'));
  if (!manifestBytes) throw new Error('backup manifest is missing');
  let manifest;
  try { manifest = asObject(JSON.parse(manifestBytes.toString('utf8')), 'backup manifest'); } catch { throw new Error('backup manifest is not valid JSON'); }
  if (manifest.format !== 2 || !Array.isArray(manifest.files)) throw new Error('backup manifest format is unsupported');
  const result = await restoreManifest(vaultPath, backupRoot, manifest);
  return { action: 'restore', backup: backupPath, ...result };
}

function parseArgs(args) {
  const result = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (!['--action', '--target', '--confirm-target', '--bundle', '--backup'].includes(flag) || value === undefined || result[flag.slice(2)] !== undefined) throw new Error('usage: --action install|status|restore --target <exact vault path> --confirm-target <same absolute path> [--bundle <generated JSON>] [--backup <backup path>]');
    result[flag.slice(2)] = value;
  }
  if (!['install', 'status', 'restore'].includes(result.action) || !result.target) throw new Error('an action and exact target are required');
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const options = { vaultPath: args.target, expectedTarget: args['confirm-target'] };
  let report;
  if (args.action === 'status') {
    const bundle = args.bundle ? JSON.parse(await readFile(resolve(args.bundle), 'utf8')) : undefined;
    report = await status({ ...options, ...(bundle ? { bundle } : {}) });
  }
  else if (args.action === 'restore') report = await restore({ ...options, backup: args.backup });
  else {
    const bundle = args.bundle
      ? JSON.parse(await readFile(resolve(args.bundle), 'utf8'))
      : await loadDefaultBundle();
    report = await install({ ...options, bundle });
  }
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'host plugin installer failed');
    process.exitCode = 1;
  });
}
