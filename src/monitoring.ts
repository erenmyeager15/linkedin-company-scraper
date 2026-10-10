import { createHash } from 'node:crypto';
import { Actor, log } from 'apify';
import type { ActorInput, CompanyObservation, CompanyRecord } from './types.js';

export interface Snapshot {
    companyName: string | null;
    website: string | null;
    companyDescription: string | null;
    industry: string | null;
    companySize: string | null;
    headquartersLocation: string | null;
    companyType: string | null;
    specialties: string[];
    followerCount: number | null;
    employeeCount: number | null;
}

export interface StoredCompanyState {
    version: 1;
    observationCount: number;
    lastObservedAt: string;
    snapshot: Snapshot;
    history: CompanyObservation[];
}

export interface PreparedRecord {
    key: string;
    record: CompanyRecord;
    nextState: StoredCompanyState;
}

export interface MonitoringSummary {
    generatedAt: string;
    watchlistName: string;
    companies: number;
    baseline: number;
    updated: number;
    unchanged: number;
    partial: number;
    signals: number;
    stateWriteFailures: number;
    artifacts?: { datasetUrl?: string; markdownReportUrl?: string; csvReportUrl?: string };
}

const TRACKED_FIELDS: Array<keyof Snapshot> = [
    'companyName', 'website', 'companyDescription', 'industry', 'companySize',
    'headquartersLocation', 'companyType', 'specialties', 'followerCount', 'employeeCount',
];

export function parsePublicCount(value: string | null | undefined): number | null {
    if (!value) return null;
    const normalized = value.trim().replace(/,/g, '');
    const match = normalized.match(/^([0-9]+(?:\.[0-9]+)?)\s*([KMB])?/i);
    if (!match) return null;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) return null;
    const multiplier = ({ K: 1_000, M: 1_000_000, B: 1_000_000_000 } as const)[(match[2]?.toUpperCase() ?? '') as 'K' | 'M' | 'B'] ?? 1;
    return Math.round(amount * multiplier);
}

export function parseCompanySize(value: string | null | undefined): { min: number | null; max: number | null } {
    if (!value) return { min: null, max: null };
    const numbers = [...value.matchAll(/[0-9][0-9,]*/g)].map((match) => Number(match[0].replace(/,/g, ''))).filter(Number.isFinite);
    if (numbers.length >= 2) return { min: numbers[0] ?? null, max: numbers[1] ?? null };
    if (numbers.length === 1) return /\+/.test(value) ? { min: numbers[0] ?? null, max: null } : { min: numbers[0] ?? null, max: numbers[0] ?? null };
    return { min: null, max: null };
}

export function websiteDomain(value: string | null | undefined): string | null {
    if (!value) return null;
    try {
        const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
        return url.hostname.toLowerCase().replace(/^www\./, '') || null;
    } catch { return null; }
}

function snapshot(record: CompanyRecord): Snapshot {
    return {
        companyName: record.companyName,
        website: record.website,
        companyDescription: record.companyDescription,
        industry: record.industry,
        companySize: record.companySize,
        headquartersLocation: record.headquartersLocation,
        companyType: record.companyType,
        specialties: [...record.specialties].sort((a, b) => a.localeCompare(b)),
        followerCount: record.followerCountNumeric ?? parsePublicCount(record.followerCount),
        employeeCount: record.employeeCountNumeric ?? parsePublicCount(record.employeeCount),
    };
}

function equalValue(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}

function percentChange(current: number | null, previous: number | null): number | null {
    if (current === null || previous === null || previous === 0) return null;
    return ((current - previous) / Math.abs(previous)) * 100;
}

export function compareCompany(
    record: CompanyRecord,
    previous: StoredCompanyState | null,
    followerThreshold = 5,
    employeeThreshold = 5,
): Pick<CompanyRecord, 'observationStatus' | 'previousObservedAt' | 'previousValues' | 'deltas' | 'changes' | 'signals'> {
    if (!previous) return {
        observationStatus: 'baseline', previousObservedAt: null, previousValues: {},
        deltas: { followers: null, employees: null }, changes: [], signals: [],
    };
    const current = snapshot(record);
    const changes = TRACKED_FIELDS.filter((field) => !equalValue(current[field], previous.snapshot[field]));
    const followerDelta = current.followerCount !== null && previous.snapshot.followerCount !== null
        ? current.followerCount - previous.snapshot.followerCount : null;
    const employeeDelta = current.employeeCount !== null && previous.snapshot.employeeCount !== null
        ? current.employeeCount - previous.snapshot.employeeCount : null;
    const followerPct = percentChange(current.followerCount, previous.snapshot.followerCount);
    const employeePct = percentChange(current.employeeCount, previous.snapshot.employeeCount);
    const signals: string[] = [];
    if (followerPct !== null && Math.abs(followerPct) >= followerThreshold) signals.push(`FOLLOWERS_${followerPct > 0 ? 'UP' : 'DOWN'}_${Math.abs(followerPct).toFixed(1)}_PCT`);
    if (employeePct !== null && Math.abs(employeePct) >= employeeThreshold) signals.push(`EMPLOYEES_${employeePct > 0 ? 'UP' : 'DOWN'}_${Math.abs(employeePct).toFixed(1)}_PCT`);
    for (const field of ['website', 'industry', 'companySize', 'headquartersLocation', 'companyType'] as const) {
        if (changes.includes(field)) signals.push(`${field.replace(/([A-Z])/g, '_$1').toUpperCase()}_CHANGED`);
    }
    const hasPartialCounts = (current.followerCount === null && previous.snapshot.followerCount !== null)
        || (current.employeeCount === null && previous.snapshot.employeeCount !== null);
    return {
        observationStatus: hasPartialCounts ? 'partial' : (changes.length ? 'updated' : 'unchanged'),
        previousObservedAt: previous.lastObservedAt,
        previousValues: Object.fromEntries(changes.map((field) => [field, previous.snapshot[field]])),
        deltas: { followers: followerDelta, employees: employeeDelta },
        changes,
        signals,
    };
}

function observation(record: CompanyRecord): CompanyObservation {
    return {
        observedAt: record.scrapedAt,
        followerCount: record.followerCountNumeric ?? parsePublicCount(record.followerCount),
        employeeCount: record.employeeCountNumeric ?? parsePublicCount(record.employeeCount),
        companySize: record.companySize,
        website: record.website,
        industry: record.industry,
        headquartersLocation: record.headquartersLocation,
    };
}

function csvCell(value: unknown): string {
    const text = Array.isArray(value) ? value.join('|') : String(value ?? '');
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
}

export class MonitoringContext {
    private readonly records: CompanyRecord[] = [];
    private stateWriteFailures = 0;
    private constructor(
        private readonly stateStore: Awaited<ReturnType<typeof Actor.openKeyValueStore>>,
        private readonly outputStore: Awaited<ReturnType<typeof Actor.openKeyValueStore>>,
        private readonly input: Required<Pick<ActorInput, 'watchlistName' | 'followerChangePercent' | 'employeeChangePercent' | 'historyLimit' | 'generateMarkdownReport' | 'generateCsvReport'>>,
    ) {}

    static async create(input: ActorInput): Promise<MonitoringContext> {
        const [stateStore, outputStore] = await Promise.all([
            Actor.openKeyValueStore('linkedin-company-monitor-state'),
            Actor.openKeyValueStore(),
        ]);
        return new MonitoringContext(stateStore, outputStore, {
            watchlistName: input.watchlistName?.trim() || 'default',
            followerChangePercent: Number.isFinite(input.followerChangePercent) ? Math.max(0, Number(input.followerChangePercent)) : 5,
            employeeChangePercent: Number.isFinite(input.employeeChangePercent) ? Math.max(0, Number(input.employeeChangePercent)) : 5,
            historyLimit: Number.isFinite(input.historyLimit) ? Math.min(20, Math.max(2, Math.floor(Number(input.historyLimit)))) : 10,
            generateMarkdownReport: input.generateMarkdownReport !== false,
            generateCsvReport: input.generateCsvReport !== false,
        });
    }

    async prepare(base: CompanyRecord): Promise<PreparedRecord> {
        const canonical = base.linkedinUrl.toLowerCase();
        const key = `MONITOR_${createHash('sha256').update(`${this.input.watchlistName}\n${canonical}`).digest('hex')}`;
        let previous: StoredCompanyState | null = null;
        let stateReadFailed = false;
        try { previous = (await this.stateStore.getValue<StoredCompanyState>(key)) ?? null; } catch (error) {
            stateReadFailed = true;
            log.warning('Could not read prior company observation; current row will be marked partial.', { company: base.companyName, message: error instanceof Error ? error.message : 'Unknown state read error' });
        }
        const followers = parsePublicCount(base.followerCount);
        const employees = parsePublicCount(base.employeeCount);
        const size = parseCompanySize(base.companySize);
        const companySlug = base.linkedinUrl.match(/\/company\/([^/?#]+)/i)?.[1]?.toLowerCase() ?? null;
        const enriched: CompanyRecord = {
            ...base,
            companySlug,
            websiteDomain: websiteDomain(base.website),
            followerCountNumeric: followers,
            employeeCountNumeric: employees,
            companySizeMin: size.min,
            companySizeMax: size.max,
            fieldCoveragePercent: Math.round(([
                base.companyName, base.website, base.companyDescription, base.industry, base.companySize,
                base.headquartersLocation, base.companyType, base.foundedYear, base.followerCount, base.employeeCount,
            ].filter((value) => value !== null && value !== '').length / 10) * 100),
            watchlistName: this.input.watchlistName,
            observationCount: (previous?.observationCount ?? 0) + 1,
            ...compareCompany(base, previous, this.input.followerChangePercent, this.input.employeeChangePercent),
        };
        if (stateReadFailed) enriched.observationStatus = 'partial';
        const history = [...(previous?.history ?? []), observation(enriched)].slice(-this.input.historyLimit);
        enriched.observationHistory = history;
        return {
            key,
            record: enriched,
            nextState: { version: 1, observationCount: enriched.observationCount ?? 1, lastObservedAt: enriched.scrapedAt, snapshot: snapshot(enriched), history },
        };
    }

    async commit(prepared: PreparedRecord): Promise<void> {
        try { await this.stateStore.setValue(prepared.key, prepared.nextState); }
        catch (error) {
            this.stateWriteFailures += 1;
            log.warning('Company row was saved, but private watchlist state could not be updated.', { company: prepared.record.companyName, message: error instanceof Error ? error.message : 'Unknown state write error' });
        }
        this.records.push(prepared.record);
    }

    async saveReports(): Promise<MonitoringSummary> {
        const statuses = (status: CompanyRecord['observationStatus']) => this.records.filter((record) => record.observationStatus === status).length;
        const summary: MonitoringSummary = {
            generatedAt: new Date().toISOString(), watchlistName: this.input.watchlistName,
            companies: this.records.length, baseline: statuses('baseline'), updated: statuses('updated'),
            unchanged: statuses('unchanged'), partial: statuses('partial'),
            signals: this.records.reduce((total, record) => total + (record.signals?.length ?? 0), 0),
            stateWriteFailures: this.stateWriteFailures,
        };
        const dataset = await Actor.openDataset();
        summary.artifacts = { datasetUrl: `https://api.apify.com/v2/datasets/${dataset.id}/items` };
        if (this.input.generateMarkdownReport) {
            await this.outputStore.setValue('report.md', this.markdown(summary), { contentType: 'text/markdown; charset=utf-8' });
            summary.artifacts.markdownReportUrl = this.outputStore.getPublicUrl('report.md');
        }
        if (this.input.generateCsvReport) {
            await this.outputStore.setValue('report.csv', this.csv(), { contentType: 'text/csv; charset=utf-8' });
            summary.artifacts.csvReportUrl = this.outputStore.getPublicUrl('report.csv');
        }
        await this.outputStore.setValue('RUN_SUMMARY', summary);
        return summary;
    }

    private markdown(summary: MonitoringSummary): string {
        const lines = [
            '# LinkedIn Company Watchlist Report', '',
            `- Watchlist: ${summary.watchlistName.replace(/[<>]/g, '')}`,
            `- Companies: ${summary.companies}`,
            `- Baseline / updated / unchanged / partial: ${summary.baseline} / ${summary.updated} / ${summary.unchanged} / ${summary.partial}`,
            `- Signals: ${summary.signals}`,
            '', '## Company changes', '',
            '| Company | Status | Followers Δ | Employees Δ | Signals |',
            '|---|---|---:|---:|---|',
            ...this.records.map((record) => `| ${String(record.companyName ?? record.companySlug ?? 'Unknown').replace(/\|/g, '\\|').replace(/[<>]/g, '')} | ${record.observationStatus} | ${record.deltas?.followers ?? ''} | ${record.deltas?.employees ?? ''} | ${(record.signals ?? []).join(', ')} |`),
            '', '> Public company-page observations can be incomplete or change with LinkedIn presentation. Review important changes before acting.', '',
        ];
        return lines.join('\n');
    }

    private csv(): string {
        const headers = ['watchlistName', 'companyName', 'linkedinUrl', 'websiteDomain', 'observationStatus', 'observationCount', 'followers', 'followersDelta', 'employees', 'employeesDelta', 'changes', 'signals', 'scrapedAt'];
        const rows = this.records.map((record) => [record.watchlistName, record.companyName, record.linkedinUrl, record.websiteDomain, record.observationStatus, record.observationCount, record.followerCountNumeric, record.deltas?.followers, record.employeeCountNumeric, record.deltas?.employees, record.changes, record.signals, record.scrapedAt].map(csvCell).join(','));
        return [headers.join(','), ...rows].join('\n');
    }
}
