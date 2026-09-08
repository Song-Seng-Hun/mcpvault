export interface EconomyPilotSimulationOptions {
    runs: number;
}
export interface EconomyPilotSimulationReport {
    runs: number;
    abuse: {
        unapprovedAdmissions: number;
        sybilRejections: number;
        sameOwnerClaims: number;
        selfReviews: number;
    };
    conservation: {
        issued: number;
        violations: number;
    };
    liquidity: {
        completedCircles: number;
        minRewardSettlements: number;
        inactiveEscrow: number;
        ownerSpendable: number;
        treasurySpendable: number;
        escrow: number;
    };
    safety: {
        concentrationRejections: number;
        absentRequesterPayments: number;
        absentWorkerPayments: number;
        absentReviewerPayments: number;
    };
}
/** A deterministic, model-free stress check. Each run varies the approved
 * fixed-supply pilot across independent circulation, inactivity, concentration,
 * and minimum-reward cases. It is evidence for invariants and liquidity shape,
 * never an operating forecast or permission to enable the economy. */
export declare function runDeterministicEconomyPilotSimulation(options: EconomyPilotSimulationOptions): EconomyPilotSimulationReport;
//# sourceMappingURL=economy-simulation.d.ts.map