import type { FileSystemService } from './filesystem.js';
import type { EconomyState, EconomyCommand } from './economy-model.js';
/** Non-monetary host repair of a Work claim already committed before a crash.
 * Neither worker equality nor a forged marker is sufficient: the existing
 * Work receipt binds the entire current body/Properties and generation. */
export declare function validatePaidClaimRecovery(state: EconomyState, c: EconomyCommand, fs: FileSystemService): Promise<void>;
//# sourceMappingURL=economy-claim-recovery.d.ts.map