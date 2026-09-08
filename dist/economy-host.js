#!/usr/bin/env node
import { realpath } from 'node:fs/promises';
import { dirname } from 'node:path';
import { readFederationFile } from './src/public-federation-storage.js';
import { EconomyLedger } from './src/economy-ledger.js';
import { loadEconomyHostConfig, probeEconomyStorage, inspectEconomyRecovery, recoverEconomyWriter, validateOperatorAdjudication } from './src/economy-host.js';
import { assertEconomyConservation, economyRevision, economyRetry } from './src/economy-model.js';
import { questAttention } from './src/economy-operations.js';
import { FileSystemService } from './src/filesystem.js';
import { validatePaidClaimRecovery } from './src/economy-claim-recovery.js';
const [operation, configPath, commandPath] = process.argv.slice(2);
if (!operation || operation === '--help') {
    console.log('Host-only economy operator (stop the exact shared server first).\nUsage: node dist/economy-host.js doctor|initialize|status|inspect|recover|transact <private-config.json> [private-command.json]\nConfig: {version:1,vaultPath:"absolute vault",hostPath:"existing private directory outside source/Vault",policy:{...}}\nDefault OFF. Enabling requires explicit owners/operators and treasuryWeeklyBudget (pilot 500). No command mints automatically.\ntransact accepts only issue/allocate/resolve/recover_claim with operator actor, permanent requestId and reason. inspect returns recovery fingerprint; recover command requires expectedFingerprint and reason. Never remove locks or roll back journal/checkpoint manually. An abandoned recovery gate requires explicitly offline forensic recovery.');
    process.exit(0);
}
if (!configPath)
    throw new Error('Private host config path required');
const actualConfig = await realpath(configPath);
const initial = JSON.parse(await readFederationFile(dirname(actualConfig), actualConfig, { maxBytes: 32768 }));
const config = await loadEconomyHostConfig(actualConfig, initial.vaultPath);
if (operation === 'inspect') {
    console.log(JSON.stringify(await inspectEconomyRecovery(config)));
    process.exit(0);
}
const probes = [];
for (const path of [config.vaultPath, config.hostPath])
    probes.push(await probeEconomyStorage(path));
if (operation === 'doctor') {
    console.log(JSON.stringify({ enabled: config.policy.enabled, probes, powerLossGuarantee: false }));
    process.exit(0);
}
const command = commandPath ? JSON.parse(await readFederationFile(dirname(await realpath(commandPath)), await realpath(commandPath), { maxBytes: 8192 })) : undefined;
if (operation === 'recover') {
    if (!command)
        throw new Error('Recovery approval JSON required');
    console.log(JSON.stringify(await recoverEconomyWriter(config, command)));
    process.exit(0);
}
if (!['initialize', 'status', 'transact'].includes(operation))
    throw new Error('Unsupported operator operation');
if (!config.policy.enabled)
    throw new Error('Host policy is disabled; no ledger admission');
const options = { ...config, storageVerified: true };
const ledger = operation === 'initialize' ? await EconomyLedger.initialize(options) : await EconomyLedger.open(options);
try {
    if (operation === 'transact') {
        const c = command;
        if (!c || !['issue', 'allocate', 'resolve', 'recover_claim'].includes(c.op))
            throw new Error('Host operator only accepts issue, allocate, resolve or recover_claim');
        const fs = new FileSystemService(config.vaultPath);
        const validate = async (state) => {
            if (economyRetry(state, c))
                return;
            if (c.op === 'recover_claim') {
                await validatePaidClaimRecovery(state, c, fs);
                return;
            }
            if (c.op !== 'resolve' || !(Number(c.amount) > 0))
                return;
            await validateOperatorAdjudication(state, c, fs);
            /*
             * The state above is supplied by ledger.transact after replay while its
             * writer queue is held. Do not call ledger.snapshot() here: that would
             * queue behind this transaction and deadlock its own commit validation.
             */
            const contract = c.contractId ? state.contracts[c.contractId] : undefined;
            if (!contract)
                throw new Error('Contract unavailable');
        };
        await validate(await ledger.snapshot());
        // The operator runs offline with the sole journal writer. Recheck filesystem
        // artifacts separately; never recursively snapshot inside ledger's queue.
        console.log(JSON.stringify(await ledger.transact(c, validate)));
    }
    else {
        const s = await ledger.snapshot();
        assertEconomyConservation(s);
        console.log(JSON.stringify({ initialized: operation === 'initialize', sequence: s.sequence, issued: s.issued,
            available: Object.values(s.balances).reduce((a, b) => a + b, 0), escrow: Object.values(s.contracts).reduce((a, b) => a + b.escrow, 0),
            attention: Object.values(s.contracts).filter(c => questAttention(c, new Date().toISOString()) !== 'none').slice(0, 20).map(c => ({ contractId: c.id, attention: questAttention(c, new Date().toISOString()), revision: economyRevision(c) })),
            attentionTruncated: Object.values(s.contracts).filter(c => questAttention(c, new Date().toISOString()) !== 'none').length > 20,
            nextAction: 'Restart the same shared server with --economy-config=<private-config.json> only when host policy is approved.' }));
    }
}
finally {
    await ledger.close();
}
