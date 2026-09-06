import { setImmediate as yieldToEventLoop } from 'node:timers/promises';
/** Visit an immutable inventory with synchronous callbacks; no chunk copies. */
export async function forEachInventoryItem(items, visit, assertOpen) {
    assertOpen();
    for (let start = 0; start < items.length; start += 256) {
        if (start > 0) {
            await yieldToEventLoop();
            assertOpen();
        }
        const end = Math.min(start + 256, items.length);
        for (let index = start; index < end; index++)
            visit(items[index]);
    }
    assertOpen();
}
