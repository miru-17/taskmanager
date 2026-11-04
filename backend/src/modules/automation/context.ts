import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Carried through everything an automation's actions do. Any event emitted while it is set
 * inherits the chain, which is how loops are detected (rule A → change → rule B → change → rule A).
 */
export interface AutomationContext {
  depth: number;
  chain: string[];
  ruleName: string;
}

export const automationContext = new AsyncLocalStorage<AutomationContext>();
export const currentAutomation = () => automationContext.getStore();
