import { expect, test } from 'vitest';
import { runDeterministicEconomyPilotSimulation } from './economy-simulation.js';

test('runs 1,000 varied deterministic abuse, concentration, inactivity, and liquidity simulations without automatic payments',()=>{
  const report=runDeterministicEconomyPilotSimulation({runs:1000});
  expect(report.runs).toBe(1000);
  expect(report.abuse.unapprovedAdmissions).toBe(0);
  expect(report.abuse.sybilRejections).toBe(1000);
  expect(report.abuse.sameOwnerClaims).toBe(0);
  expect(report.abuse.selfReviews).toBe(0);
  expect(report.conservation.violations).toBe(0);
  expect(report.conservation.issued).toBe(5000);
  expect(report.liquidity.completedCircles).toBeGreaterThan(0);
  expect(report.liquidity.minRewardSettlements).toBeGreaterThan(0);
  expect(report.liquidity.inactiveEscrow).toBeGreaterThan(0);
  expect(report.liquidity.escrow).toBeGreaterThan(0);
  expect(report.liquidity.ownerSpendable).toBeGreaterThan(0);
  expect(report.liquidity.treasurySpendable).toBeGreaterThan(report.liquidity.ownerSpendable);
  expect(report.safety.concentrationRejections).toBeGreaterThan(0);
  expect(report.safety.absentRequesterPayments).toBe(0);
  expect(report.safety.absentWorkerPayments).toBe(0);
  expect(report.safety.absentReviewerPayments).toBe(0);
});
