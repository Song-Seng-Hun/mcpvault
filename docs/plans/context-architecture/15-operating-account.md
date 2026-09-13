---
id: context-operating-account
kind: execution-record
description: Approved recoverable ordinary account and separate pulse latency limitation.
keywords: [account, Windows Credential Manager, pulse, recovery, 운영 계정]
parent: README.md
previous: 14-next-gates.md
next: 16-candidate-delivery.md
---
# Operating identity

2026-09-14: user explicitly approved a dedicated non-administrator account.
Account ID: `context-ops-20260914`; model family `codex`; role `agent`.
This is an account record, not a spawned agent, model owner or administrator.
Existing identities were not changed or used to elevate capabilities.

## Secret recovery

- Verified [WinCred](https://learn.microsoft.com/en-us/windows/win32/api/wincred/ns-wincred-credentialw) Generic storage with local-machine persistence.
- Generated a32-byte random password in process; persisted before registration.
- Tested exact readback and refusal to replace an existing credential.
- Deleted only the owned ephemeral probe; retained the account recovery entry.
- Recovered the same credential in fresh processes; no duplicate signup.
- Passed credentials through private redirected stdin, never command-line arguments.
- Printed only allowlisted diagnostics; no passwords, tokens or raw SDK errors.
- No plaintext credential file, repository secret or Vault secret was created.
- Local operational helpers are ignored; credentials exist only in the approved store.

## Live evidence and limitation

Existing loopback8788 listener was verified as the expected P1c runtime PID15640.
Registration response processing was incomplete; it was not blindly replayed.
Subsequent exact-account login verified successful registration and password recovery.
Whoami verified expected identity and ordinary capabilities; no moderator/admin/enterprise authority.
The authenticated session was revoked through `auth.logout`.
Latest timings: login124ms, whoami74ms, logout168ms.
`get_agent_pulse(hostBusy=true, purpose=work, maxChars=1024)` timed out at30010ms.
After P1d restart, login/pulse/logout passed with the saved checkpoint; the empty-state path remains unverified.
The client failure's last action was logout cleanup, not the failing pulse operation.
Thirteen synthetic helper tests passed; they are not native pulse success evidence.

## Next work

Trace empty-state pulse source reads and retain current access/revision checks.
Do not bypass required work-state checks or fabricate an empty successful packet.
Use current policy and the saved exact account; signup grants no source paths or automatic migration.
An account-private continuity checkpoint was created with expectedRevision=missing and reread.
It stores plan/context/TODO only; anonymous body/outline reads denied and public search excludes it.
No document conversion, community action, skill registration or model run occurred.
Freeze the current regression basis; implement fixes in the next tested batch.
