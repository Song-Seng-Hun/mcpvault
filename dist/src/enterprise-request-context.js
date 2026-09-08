import { AsyncLocalStorage } from 'node:async_hooks';
const requestContext = new AsyncLocalStorage();
export function getEnterpriseRequestContext() {
    return requestContext.getStore();
}
export function withEnterpriseRequestContext(context, callback) {
    return requestContext.run(context, callback);
}
