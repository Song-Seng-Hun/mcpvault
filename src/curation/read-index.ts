import type { CurationIndexPage, CurationIndexQuery } from '../memory/sqlite-store.js';
import type { CurationDeliveryFact, CurationDeliverySink } from './delivery.js';

/** Private discovery capture. It never grants caller visibility or managed status. */
export interface CurationReadCapture {
  generation: number;
  page(query: CurationIndexQuery): Promise<CurationIndexPage>;
  assertCurrent(): Promise<void>;
  delivery?(actor: string, document: string): Promise<CurationDeliveryFact | undefined>;
}
export interface CurationReadIndex extends Partial<CurationDeliverySink> {
  captureCuration(): Promise<CurationReadCapture | undefined>;
}
