import { netTenths, amountPaisa } from './calc';

// Display math for outbox / synced-entry cards. Must match what the server
// stores: net weight (gross - tare, moisture deduction) and the payable
// amount on that net weight. Regression: these cards previously showed gross
// weight and a gross-based amount, which disagreed with the farmer's slip.
export interface EntryPayloadLike {
  grossTenths: number;
  tareTenths: number;
  moistureTenths: number;
  rateRupees: number;
}

export function entryNetTenths(p: EntryPayloadLike): number {
  return netTenths(p.grossTenths, p.tareTenths, p.moistureTenths);
}

export function entryAmountPaisa(p: EntryPayloadLike): number {
  return amountPaisa(entryNetTenths(p), p.rateRupees);
}
