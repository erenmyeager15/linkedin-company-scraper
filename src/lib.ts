import type { CompanyRecord } from './types.js';

export const LINKEDIN_BASE = 'https://www.linkedin.com';
export const DEFAULT_MAX_RESULTS = 5;
export const MAX_RESULTS_LIMIT = 100;
/** Slug guesses tried per company name before giving up. */
export const MAX_SLUG_CANDIDATES = 4;

/**
 * Stylesheets are deliberately NOT blocked: Playwright's innerText depends on layout,
 * so removing CSS would expose hidden sign-in boilerplate and corrupt block detection.
 */
export const BLOCKED_RESOURCE_PATTERNS = [
    '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp', '.ico', '.avif',
    '.woff', '.woff2', '.ttf', '.otf', '.eot',
    '.mp4', '.webm', '.mp3', '.pdf', '.zip',
];

/** Canonicalises any LinkedIn company link to its public guest profile URL. */
export function normalizeCompanyUrl(rawUrl: string): string | null {
    if (!rawUrl?.trim()) return null;

    let cleaned = rawUrl.trim();
    if (!/^https?:\/\//i.test(cleaned)) {
        cleaned = `${LINKEDIN_BASE}${cleaned.startsWith('/') ? '' : '/'}${cleaned}`;
    }

    const match = cleaned.match(/linkedin\.com\/(?:company|showcase)\/([^/?#]+)/i);
    if (!match) return null;

    const slug = match[1].toLowerCase();
    if (!slug) return null;

    return `${LINKEDIN_BASE}/company/${slug}`;
}

export function isLinkedInCompanyUrl(url: string): boolean {
    return /linkedin\.com\/(?:company|showcase)\//i.test(url);
}

const LEGAL_SUFFIXES = [
    'inc', 'llc', 'ltd', 'limited', 'corp', 'corporation', 'gmbh', 'plc',
    'co', 'company', 'pvt', 'pte', 'sa', 'ag', 'bv', 'nv', 'group', 'holdings',
];

function tokenize(name: string): string[] {
    return name
        .toLowerCase()
        .replace(/&/g, ' and ')
        .split(/[^a-z0-9]+/)
        .filter(Boolean);
}

function compact(name: string): string {
    return tokenize(name).join('');
}

/**
 * LinkedIn company search requires a login, so names are resolved against public
 * company pages by deriving the slugs LinkedIn actually uses.
 */
export function companySlugCandidates(name: string): string[] {
    const tokens = tokenize(name);
    if (tokens.length === 0) return [];

    const withoutSuffix = tokens.filter((token, index) =>
        !(index === tokens.length - 1 && tokens.length > 1 && LEGAL_SUFFIXES.includes(token)));

    const candidates = [
        tokens.join('-'),
        tokens.join(''),
        withoutSuffix.join('-'),
        withoutSuffix.join(''),
    ];

    const unique: string[] = [];
    for (const candidate of candidates) {
        if (candidate && !unique.includes(candidate)) unique.push(candidate);
    }

    return unique.slice(0, MAX_SLUG_CANDIDATES);
}

export function candidateUrls(name: string): string[] {
    return companySlugCandidates(name).map((slug) => `${LINKEDIN_BASE}/company/${slug}`);
}

/**
 * A guessed slug is only accepted when the page really belongs to the requested
 * company, so an unrelated page can never be saved and charged as a match.
 */
export function nameMatchesCompany(searchName: string, companyName: string | null): boolean {
    if (!companyName) return false;

    const searchCompact = compact(searchName);
    const companyCompact = compact(companyName);
    if (!searchCompact || !companyCompact) return false;

    if (searchCompact === companyCompact) return true;
    if (companyCompact.includes(searchCompact) || searchCompact.includes(companyCompact)) return true;

    const significant = tokenize(searchName).filter((token) =>
        token.length >= 3 && !LEGAL_SUFFIXES.includes(token));
    if (significant.length === 0) return false;

    const companyTokens = new Set(tokenize(companyName));
    const matched = significant.filter((token) => companyTokens.has(token)).length;

    return matched / significant.length >= 0.6;
}

export function clampMaxResults(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(parsed)) return DEFAULT_MAX_RESULTS;
    return Math.min(MAX_RESULTS_LIMIT, Math.max(1, Math.floor(parsed)));
}

const BLOCK_URL_PATTERN = /\/authwall|\/uas\/login|\/checkpoint\/|\/login(?:\?|$)|\/signup/i;

export function isBlockedUrl(url: string): boolean {
    return BLOCK_URL_PATTERN.test(url);
}

/** LinkedIn answers throttled guest traffic with 999, and challenges with 403/429. */
export function isBlockedStatus(status: number | null | undefined): boolean {
    if (typeof status !== 'number') return false;
    return status === 999 || status === 403 || status === 429 || status >= 500;
}

/**
 * Deliberately unambiguous phrases only. Generic sign-in prompts appear on ordinary
 * public company pages, so matching them would discard real companies.
 */
export const BLOCK_TEXT_MARKERS = [
    'authwall',
    'security verification',
    'unusual activity',
    'verify you are a human',
    'captcha',
];

export function looksBlockedText(text: string | null | undefined): boolean {
    if (!text) return false;
    const lower = text.toLowerCase();
    return BLOCK_TEXT_MARKERS.some((marker) => lower.includes(marker));
}

/**
 * Only a record with a name plus at least one substantive public field is saved and
 * charged, so an authwall or layout change can never bill an empty profile.
 */
export function hasUsableCompanyData(record: Pick<CompanyRecord,
    'companyName' | 'companyDescription' | 'website' | 'industry' | 'headquartersLocation'>): boolean {
    if (!record.companyName) return false;

    return Boolean(record.companyDescription)
        || Boolean(record.website)
        || Boolean(record.industry)
        || Boolean(record.headquartersLocation);
}

export type StopReason = 'max-results' | 'charge-limit' | null;

export interface RunBudget {
    maxCompanies: number;
    pushed: number;
    charged: number;
    stopReason: StopReason;
    /** Company names already resolved, so extra slug guesses are skipped. */
    resolvedNames: Set<string>;
    /** Canonical URLs already saved, so one company is never billed twice. */
    savedUrls: Set<string>;
}

export function createBudget(maxCompanies: number): RunBudget {
    return {
        maxCompanies,
        pushed: 0,
        charged: 0,
        stopReason: null,
        resolvedNames: new Set(),
        savedUrls: new Set(),
    };
}

export function isFinished(budget: RunBudget): boolean {
    return budget.stopReason !== null || budget.pushed >= budget.maxCompanies;
}

export function canSaveMore(budget: RunBudget): boolean {
    return budget.stopReason === null && budget.pushed < budget.maxCompanies;
}

export function isAlreadySaved(budget: RunBudget, canonicalUrl: string): boolean {
    return budget.savedUrls.has(canonicalUrl);
}

/**
 * Reserves a save slot before any await, so concurrent workers cannot overshoot the
 * target count, keep charging after the spending limit, or bill one company twice.
 */
export function reserveSave(budget: RunBudget, canonicalUrl: string, searchName?: string | null): boolean {
    if (!canSaveMore(budget)) return false;
    if (budget.savedUrls.has(canonicalUrl)) return false;

    budget.savedUrls.add(canonicalUrl);
    budget.pushed += 1;
    if (searchName) budget.resolvedNames.add(searchName.toLowerCase());
    if (budget.pushed >= budget.maxCompanies && !budget.stopReason) {
        budget.stopReason = 'max-results';
    }
    return true;
}

/** Rolls back a reserved slot when the save itself failed. */
export function releaseSave(budget: RunBudget, canonicalUrl: string, searchName?: string | null): void {
    budget.savedUrls.delete(canonicalUrl);
    if (searchName) budget.resolvedNames.delete(searchName.toLowerCase());
    if (budget.pushed > 0) budget.pushed -= 1;
    if (budget.stopReason === 'max-results' && budget.pushed < budget.maxCompanies) {
        budget.stopReason = null;
    }
}

export function registerCharge(budget: RunBudget, limitReached: boolean): void {
    budget.charged += 1;
    if (limitReached) budget.stopReason = 'charge-limit';
}

export function isNameResolved(budget: RunBudget, searchName: string | null | undefined): boolean {
    if (!searchName) return false;
    return budget.resolvedNames.has(searchName.toLowerCase());
}
