import type { EndpointAvailabilityContext, EndpointDescriptor } from './endpoint-registry.js';
export declare function operationReadAlias(tool: string, op: unknown): string | undefined;
type Availability = NonNullable<EndpointDescriptor['operations']>[string];
export declare function operationAvailability(item: EndpointDescriptor, context: EndpointAvailabilityContext, baseWrite: Availability): (Availability & {
    operations: Record<string, Availability>;
}) | undefined;
export {};
//# sourceMappingURL=operation-contracts.d.ts.map