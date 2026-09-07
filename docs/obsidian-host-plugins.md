# Optional Obsidian host plugins

`scripts/obsidian-host-plugins.mjs` is an opt-in installer for exactly two
community plugins in the local host vault:

- [QuickAdd](https://github.com/chhoumann/quickadd), using one ordinary
  Template choice named `MCPVault: New Inbox note`.
- [Metadata Menu](https://github.com/mdelobelle/metadatamenu), using generated
  FileClass Markdown supplied by the server property contract.

It never installs Dataview, Templater, or Waypoint. It does not create a macro,
user script, hotkey, command, or automatic trigger.

## Safety boundary

Every mutating command requires this exact, explicit target:

```powershell
E:\llm_wiki\llm_wiki
```

The target and its `.obsidian` directory must already exist, be ordinary
directories, and have no symlink/junction at any inspected component. Bundle
paths must be Markdown files inside the vault and cannot contain `..`.

The installer merges only one QuickAdd choice, the two authorized IDs in
`.obsidian/community-plugins.json`, and Metadata Menu's `classFilesPath` only
when it is absent. It preserves other enabled plugin IDs and refuses to replace
a user choice, invalid JSON, or a different existing class-files path. Existing
settings are not printed. Obsidian must still be restarted or its plugins
reloaded afterward; this script never launches or executes either plugin.

QuickAdd uses the upstream Template-choice configuration shape: a specific
folder, a timestamp-only filename format, link appending disabled, and the
`duplicateSuffix` file-exists mode. The filename never incorporates a typed
title, so user input cannot become a path. The timestamp plus collision policy
means each invocation creates a distinct ordinary note under `Inbox/`, rather
than appending shared content. This matches QuickAdd's documented Template behavior
and its current source types ([Template guide](https://quickadd.obsidian.guide/docs/Choices/TemplateChoice/),
[choice source](https://github.com/chhoumann/quickadd/blob/master/src/types/choices/TemplateChoice.ts)).

Metadata Menu stores field definitions in FileClass Markdown and has a
`classFilesPath` settings value ([settings source](https://github.com/mdelobelle/metadatamenu/blob/master/src/settings/MetadataMenuSettings.ts),
[FileClass guide](https://github.com/mdelobelle/metadatamenu/blob/master/docs/fileclasses.md)).
The installer only points it at server-generated files; it never introduces a
second schema authority. Its official field model includes `Input` and `Multi`
types ([source](https://github.com/mdelobelle/metadatamenu/blob/master/src/fields/Fields.ts)).
This installation uses only those frontmatter fields with `frontmatterOnly:
true`; it installs no Dataview integration or query configuration.
The generated bundle uses an ordinary folder path; the installer adds the
trailing `/` required by Metadata Menu's `classFilesPath` setting. Without it,
the plugin can appear enabled while failing to associate `fileClass: Inbox`.
For a CLI/API probe, use `fileFields`/`namedFileFields` to inspect the field IDs,
then `postValues` with `indexedPath`. In Metadata Menu 0.8.12 the legacy
`postNamedFieldsValues` implementation dereferences Dataview and can silently
fail without it; it is not part of this integration. No workaround plugin is
installed. Native form writes use the indexed-field path.

The tags Multi picker starts without a site-wide taxonomy. Use its add-value
control to define and select a local tag; it edits the host FileClass, which
the installer then preserves as a user edit. A picker value warning is not a
server schema rejection. Ordinary Obsidian Properties remain available for
free-form tag lists, and contract-drift status is advisory, not an auto-reset.

## Parent integration contract

The default one-command path imports the already-built
`dist/src/authoring-assist.js` and calls its `hostPluginBundle()` export. That
is the single authoritative source for the server property contract; the
installer validates its result but does not recreate it. `--bundle <path>`
remains available only for an explicit reviewed/generated JSON input, including
tests. The exporter contract is:

```json
{
  "fingerprint": "sha256:<64 lowercase hexadecimal characters>",
  "templates": [
    {
      "path": "Templates/MCPVault/Inbox.md",
      "content": "---\nnote_kind: fleeting\nlifecycle: inbox\ntitle: \"\"\ntags: []\nfileClass: Inbox\n---\n# {{VALUE:title}}\n\n{{VALUE:content}}\n"
    }
  ],
  "fileClassesPath": "Templates/MCPVault/FileClasses",
  "fileClasses": [
    {
      "path": "Templates/MCPVault/FileClasses/Inbox.md",
      "content": "---\ncontract_fingerprint: sha256:<64 lowercase hexadecimal characters>\nfields:\n  - name: title\n    type: Input\n    id: <server-generated-unique-id>\n    path: \"\"\n    options: {}\n  - name: tags\n    type: Multi\n    id: <server-generated-unique-id>\n    path: \"\"\n    options:\n      sourceType: ValuesList\n      valuesList: {}\n---\n"
    }
  ]
}
```

All bundle Markdown is visible to Obsidian: template paths must be under
`Templates/MCPVault/`, and FileClasses must be under the exact
`Templates/MCPVault/FileClasses` path. The installer accepts at most eight
templates and eight FileClasses, with a 64 KiB per-file and 256 KiB total
content limit.

`fingerprint` is computed by the server exporter's
`propertyContractFingerprint()` and returned by `hostPluginBundle()`. The
installer validates and records that supplied canonical value rather than
recomputing or duplicating the property contract. The server must generate
unique Metadata Menu field IDs.

The Inbox template keeps YAML `title` empty and places the requested title only
in the H1. This avoids typed text breaking YAML; Metadata Menu's `Input` field
can edit `title` later. It must also contain `tags`, `fileClass: Inbox`, and a
`{{VALUE:content}}` body prompt. The installer rejects QuickAdd JS/macros,
Templater syntax, and Dataview references in every template. Every FileClass
must carry the exact `contract_fingerprint`, define `title` as `Input` and
`tags` as `Multi`, and omit `scope`, `auth`/`authentication`/`authorization`,
`review`, and `proof` fields. Other contract fields remain server-owned, so no
client-side authoritative schema is duplicated here.

## Commands

Check the host without downloading or changing anything:

```powershell
node scripts/obsidian-host-plugins.mjs --action status --target E:\llm_wiki\llm_wiki
```

Install the two authorized plugins from their official GitHub release assets
using the built server contract:

Close Obsidian first so it cannot save plugin settings during installation.
The installer aborts rather than overwrite a concurrently changed file.

```powershell
node scripts/obsidian-host-plugins.mjs --action install --target E:\llm_wiki\llm_wiki
```

Use an explicit reviewed JSON bundle only when needed for controlled testing or
an external export:

```powershell
node scripts/obsidian-host-plugins.mjs --action install --target E:\llm_wiki\llm_wiki --bundle E:\path\to\server-property-contract.json
```

For each install the script saves
`.obsidian/mcpvault-host-plugins/backups/<id>/manifest.json`. It records every
changed file, including files that were absent, plus the release tag, official
asset URLs, byte counts, original SHA-256 hashes, and installed SHA-256 hashes.
Existing file bytes are stored in the same backup directory only for
restoration; neither they nor settings contents are written to stdout.

Release metadata is limited to 1 MiB and each asset to 16 MiB, with a 30-second
request deadline. An asset URL must exactly match
`https://github.com/<official-repository>/releases/download/<tag>/<name>`;
the downloaded `manifest.json` must have the expected plugin ID, matching
version, and a non-empty `minAppVersion`. Node's default fetch redirect handling
is used only after that exact URL check, and the final URL must remain on an
official GitHub asset host (`github.com`, `objects.githubusercontent.com`, or
`release-assets.githubusercontent.com`). Intermediate redirects are handled by
the platform fetch implementation and are not independently exposed.

Restore one specific backup:

```powershell
node scripts/obsidian-host-plugins.mjs --action restore --target E:\llm_wiki\llm_wiki --backup .obsidian/mcpvault-host-plugins/backups/<id>
```

Restore compares the current file hash with the recorded installed hash. It
restores only unchanged installer output; a post-install user edit is returned
as a conflict and is never overwritten. The installer uses the same rule to
roll back a partial install after a write failure. Before a write, it also
compares every settings/template baseline with the bytes parsed during planning;
concurrent drift aborts the transaction rather than overwriting it.

Backups may contain local plugin settings. Keep `.obsidian/mcpvault-host-plugins/`
out of Git or use a private vault repository policy; this installer deliberately
does not alter the user's `.gitignore`.

## Verification

The installer test is included in the normal full suite. To run it alone:

```powershell
npm test -- scripts/obsidian-host-plugins.test.ts --maxWorkers=1
```

It covers the generated-bundle checks, exact target validation, non-overwriting
QuickAdd and community-plugin merges, mocked official releases,
version/minimum-app/source/SHA records, status configuration checks, and
conflict-safe restoration of present and initially absent files. It does not
install live plugins. The default-bundle test imports the real built contract.
