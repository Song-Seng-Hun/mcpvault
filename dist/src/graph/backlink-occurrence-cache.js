/** Bounded, caller-view-local read model. Values are occurrences, not decisions
 * about access, verification, ranking or truth. Only exhaustive scans commit. */
export class BacklinkOccurrenceCache {
    maxTargets;
    maxRetained;
    maxFill;
    entries = new Map();
    retained = 0;
    filling = false;
    constructor(maxTargets = 64, maxRetained = 12_288, maxFill = 4_096) {
        this.maxTargets = maxTargets;
        this.maxRetained = maxRetained;
        this.maxFill = maxFill;
        if (![maxTargets, maxRetained, maxFill].every(n => Number.isSafeInteger(n) && n > 0)
            || maxFill > maxRetained)
            throw Error('Invalid occurrence cache limits');
    }
    *read(target, scan) {
        const hit = this.entries.get(target);
        if (hit) {
            this.entries.delete(target);
            this.entries.set(target, hit);
            yield* hit;
            return;
        }
        // Graph readers can interleave while awaiting fresh source checks. Keep
        // only one bounded admission buffer, not one for every in-flight request.
        if (this.filling) {
            yield* scan();
            return;
        }
        this.filling = true;
        let pending = [];
        try {
            for (const occurrence of scan()) {
                if (pending) {
                    if (pending.length < this.maxFill)
                        pending.push(occurrence);
                    else
                        pending = undefined; // Oversized target streams; never cache a prefix.
                }
                yield occurrence;
            }
            if (pending) {
                while (this.entries.size >= this.maxTargets || this.retained + pending.length > this.maxRetained) {
                    const oldest = this.entries.keys().next().value;
                    this.retained -= this.entries.get(oldest).length;
                    this.entries.delete(oldest);
                }
                this.entries.set(target, pending);
                this.retained += pending.length;
            }
        }
        finally {
            // return()/throw() skips admission but always releases the fill slot.
            this.filling = false;
        }
    }
}
