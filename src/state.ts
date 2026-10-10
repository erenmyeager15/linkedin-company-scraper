import type { RunBudget } from './lib.js';
import type { MonitoringContext } from './monitoring.js';

let activeBudget: RunBudget | null = null;
let activeMonitoring: MonitoringContext | null = null;

export function setBudget(budget: RunBudget): void {
    activeBudget = budget;
}

export function getBudget(): RunBudget {
    if (!activeBudget) throw new Error('Run budget was not initialised before crawling started.');
    return activeBudget;
}

export function setMonitoring(monitoring: MonitoringContext): void {
    activeMonitoring = monitoring;
}

export function getMonitoring(): MonitoringContext {
    if (!activeMonitoring) throw new Error('Monitoring context was not initialised before crawling started.');
    return activeMonitoring;
}
