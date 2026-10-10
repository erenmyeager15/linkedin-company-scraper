import { Actor } from 'apify';
import type { HttpCrawlingContext } from 'crawlee';
import { extractCompanyHtml } from './extract.js';
import {
    canSaveMore,
    hasUsableCompanyData,
    isAlreadySaved,
    isBlockedStatus,
    isBlockedUrl,
    isNameResolved,
    looksBlockedText,
    nameMatchesCompany,
    normalizeCompanyUrl,
    parseFoundedYear,
    registerCharge,
    releaseSave,
    reserveSave,
} from './lib.js';
import { getBudget, getMonitoring } from './state.js';
import type { PreparedRecord } from './monitoring.js';
import type { CompanyRecord } from './types.js';

export async function handleHttpCompanyProfile(
    context: HttpCrawlingContext,
    scheduleBrowserFallback: (request: { url: string; userData: Record<string, unknown> }) => void,
): Promise<void> {
    const { request, response, log, pushData, crawler, body, session } = context;
    const budget = getBudget();
    const url = request.url;
    const searchName = request.userData.searchName as string | undefined;
    const candidates = (request.userData.candidates as string[] | undefined) ?? [];
    const candidateIndex = (request.userData.candidateIndex as number | undefined) ?? 0;

    if (!canSaveMore(budget) || isNameResolved(budget, searchName)) return;
    const requestedUrl = normalizeCompanyUrl(url);
    if (requestedUrl && isAlreadySaved(budget, requestedUrl)) return;

    const status = response?.statusCode;
    if (isBlockedStatus(status)) {
        session?.retire();
        throw new Error(`LinkedIn returned HTTP ${status} for ${url}.`);
    }

    const extracted = extractCompanyHtml(Buffer.isBuffer(body) ? body.toString('utf8') : String(body ?? ''));
    const finalUrl = String(response?.url ?? url).split('?')[0].replace(/\/$/, '');
    const record: CompanyRecord = {
        companyName: extracted.name,
        linkedinUrl: finalUrl,
        website: extracted.website,
        companyDescription: extracted.description,
        industry: extracted.industry,
        companySize: extracted.size,
        headquartersLocation: extracted.hq,
        companyType: extracted.type,
        foundedYear: parseFoundedYear(extracted.founded),
        specialties: extracted.specialties
            ? extracted.specialties.split(/[,;\u2022\u00b7]/).map((item) => item.trim()).filter(Boolean)
            : [],
        followerCount: extracted.followers,
        employeeCount: extracted.employees,
        logoUrl: extracted.logo && !extracted.logo.startsWith('data:') ? extracted.logo : null,
        matchedFromName: searchName ?? null,
        scrapedAt: new Date().toISOString(),
    };

    if (extracted.blocked || isBlockedUrl(finalUrl) || looksBlockedText(record.companyDescription)) {
        session?.retire();
        throw new Error(`LinkedIn blocked the HTTP company request for ${url}.`);
    }

    const tryNextCandidate = async (reason: string): Promise<boolean> => {
        const nextCandidate = candidates[candidateIndex + 1];
        if (!searchName || !nextCandidate) return false;
        log.info(`${reason} at ${url}; trying the next slug for "${searchName}".`);
        await crawler.addRequests([{
            url: nextCandidate,
            userData: { label: 'company-profile', searchName, candidates, candidateIndex: candidateIndex + 1 },
        }]);
        return true;
    };

    if (!hasUsableCompanyData(record)) {
        if (await tryNextCandidate('No company found')) return;
        log.info(`No usable public HTTP data for ${url}; scheduling browser fallback.`);
        scheduleBrowserFallback({ url, userData: request.userData });
        return;
    }

    if (searchName && !nameMatchesCompany(searchName, record.companyName)) {
        if (await tryNextCandidate('Name mismatch')) return;
        log.info(`HTTP name resolution was inconclusive for "${searchName}"; scheduling browser fallback.`);
        scheduleBrowserFallback({ url, userData: request.userData });
        return;
    }

    const canonicalUrl = normalizeCompanyUrl(record.linkedinUrl) ?? record.linkedinUrl;
    if (!reserveSave(budget, canonicalUrl, searchName)) return;
    record.linkedinUrl = canonicalUrl;

    let prepared: PreparedRecord;
    try {
        prepared = await getMonitoring().prepare(record);
        await pushData(prepared.record);
    } catch (error) {
        releaseSave(budget, canonicalUrl, searchName);
        throw error;
    }
    await getMonitoring().commit(prepared);

    try {
        const chargeResult = await Actor.charge({ eventName: 'company-scraped' });
        registerCharge(budget, Boolean(chargeResult?.eventChargeLimitReached));
    } catch (error) {
        log.warning(`PPE charge failed: ${(error as Error).message}`);
    }

    log.info(`HTTP extraction saved: ${prepared.record.companyName ?? url}`, {
        observationStatus: prepared.record.observationStatus,
        signals: prepared.record.signals,
    });
}
