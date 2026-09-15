---
id: reviewed-skill-metadata-wave10
description: Godot addon discovery metadata with editor effects, API defects and version limits.
keywords: [Godot, addon, inspector, gizmo, undo, 에디터, 되돌리기]
use_when: Reviewing addon-development or preparing a version-scoped editor procedure.
parent: 2026-09-15-reviewed-skill-release.md
previous: 2026-09-16-reviewed-skill-metadata-wave9.md
next: 2026-09-16-reviewed-memory-provenance.md
---
# Metadata wave 10

Main read five retained addon-development files, 24,938 bytes; NAS fingerprint matched twice.
Useful scope: dock lifecycle, custom inspectors, gizmos, resource previews and reload diagnostics.
No editor, target snippet, plugin, account, listener or host grant was started or changed.

## Conditions before a usable derivative

The entry promises Godot 4.3+, while references include explicitly 4.7+ branches.
Missing: runnable project, plugin.cfg, scenes, custom classes and executable scripts.
No exact upstream revision or license notice is supplied; engine licensing is not skill licensing.
GDScript reset assigns the property directly, then emits an unsupported signal on the inspector plugin.
Use a version-verified property editor path; [EditorProperty](https://docs.godotengine.org/en/4.3/classes/class_editorproperty.html) documents notification via emit_changed.
Its [registration contract](https://docs.godotengine.org/en/4.3/classes/class_editorinspectorplugin.html) distinguishes property editors from general controls.
Gizmo example calls get_undo_redo on a Resource-derived gizmo plugin, not its supported owner.
Godot 4.3 documents that accessor on [EditorPlugin](https://docs.godotengine.org/en/4.3/classes/class_editorplugin.html).
The C# EditorInterface manager call also lacks support in the inspected 4.3 API; compilation remains untested.
Ray-plane math lacks a parallel-ray guard; world offsets are assigned without inverse local transform.
Test rotated/scaled nodes, cancel/undo and partial initialization before trusting geometry or reload.
Shared resources affect multiple scenes; printed resource paths can expose project metadata.
Editor callbacks are not MCP/host-hook registration; object queue_free is not filesystem deletion.
No blanket safety or language-parity verdict follows from adjacent GDScript/C# examples.

## Verified progress

Descriptor acceptance, eight contiguous quote ranges and eight negative controls passed.
Seven conditional impact axes recorded; policy/legal/account applicability and usage remain unknown.
Evidence SHA: `09930cd1818e33a3f62bceb56d1c7e11798e7c5453354f223af76d10ef40180a`.
Index `92dc3f14dd507386`: 26 pages; all 1,610 rows reread; second build created nothing.
Totals: 49 metadata-reviewed-with-limitations, zero drafts, 1,561 pending, zero verified live usable.
Static API comparison is not a Godot compile, UI, normal-task or adversarial behavior test.
Private sources/evidence remain outside Git; production source/dist and quarantine are unchanged.
Existing regression-e source/build basis revalidated; no new full-suite run or deployment claimed.
