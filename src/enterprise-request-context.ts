import { AsyncLocalStorage } from 'node:async_hooks';

export interface EnterpriseRequestContext {
  transport: 'http' | 'rest' | 'stdio';
  certFingerprint?: string;
}

const requestContext = new AsyncLocalStorage<EnterpriseRequestContext>();

export function getEnterpriseRequestContext(): EnterpriseRequestContext | undefined {
  return requestContext.getStore();
}

export function withEnterpriseRequestContext<T>(
  context: EnterpriseRequestContext,
  callback: () => T,
): T {
  return requestContext.run(context, callback);
}
