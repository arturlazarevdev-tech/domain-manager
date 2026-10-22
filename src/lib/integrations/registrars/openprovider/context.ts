import { AsyncLocalStorage } from "node:async_hooks";
export const openproviderRequestContext = new AsyncLocalStorage<{ onWait: (ms: number) => Promise<void> }>();
