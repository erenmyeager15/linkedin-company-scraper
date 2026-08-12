import { PlaywrightCrawlingContext } from 'crawlee';
import { Actor } from 'apify';
import { extractCompanyHtml } from './extract.js';
import {
    canSaveMore,
    hasUsableCompanyData,
    isAlreadySaved,
    isBlockedStatus,
    isBlockedUrl,
    isFinished,
    isNameResolved,
    looksBlockedText,
    nameMatchesCompany,
    normalizeCompanyUrl,
    parseFoundedYear,
    registerCharge,
    releaseSave,
    reserveSave,
} from './lib.js';
import { getBudget } from './state.js';
import type { CompanyRecord } from './types.js';

export const routeHandlers = {
    async handleCompanyProfile(context: PlaywrightCrawlingContext) {
        const { page, request, response, session, log, pushData, crawler } = context;
        const url = request.url;
        const budget = getBudget();
        const searchName = request.userData.searchName as string | undefined;
        const candidates = (request.userData.candidates as string[] | undefined) ?? [];
        const candidateIndex = (request.userData.candidateIndex as number | undefined) ?? 0;

        if (!canSaveMore(budget)) {
            log.info('Company budget reached; skipping remaining profiles.');
            return;
        }

        // A name that already resolved must not spend another navigation on a slug guess.
        if (isNameResolved(budget, searchName)) {
            log.info(`"${searchName}" already resolved; skipping remaining slug candidates.`);
            return;
        }

        const requestedUrl = normalizeCompanyUrl(url);
        if (requestedUrl && isAlreadySaved(budget, requestedUrl)) {
            log.info(`${requestedUrl} was already saved in this run; skipping.`);
            return;
        }

        const status = response?.status();
        if (isBlockedStatus(status)) {
            session?.retire();
            throw new Error(`LinkedIn returned HTTP ${status} for ${url}.`);
        }

        log.info(`Scraping company profile: ${url}`);

        await page.waitForSelector('h1, script[type="application/ld+json"]', { timeout: 5000 }).catch(() => {});

        const record: CompanyRecord = {
            companyName: null,
            linkedinUrl: url,
            website: null,
            companyDescription: null,
            industry: null,
            companySize: null,
            headquartersLocation: null,
            companyType: null,
            foundedYear: null,
            specialties: [],
            followerCount: null,
            employeeCount: null,
            logoUrl: null,
            matchedFromName: searchName ?? null,
            scrapedAt: new Date().toISOString(),
        };

        // Public LinkedIn company pages embed an Organization JSON-LD block plus a
        // guest "about" definition list. These are far more reliable than the
        // logged-in .org-top-card selectors.
        const extracted = extractCompanyHtml(await page.content());

        record.companyName = extracted.name ?? null;
        record.linkedinUrl = page.url().split('?')[0].replace(/\/$/, '');
        record.companyDescription = extracted.description ?? null;
        record.website = extracted.website ?? null;
        record.logoUrl = extracted.logo && !String(extracted.logo).startsWith('data:') ? extracted.logo : null;
        record.industry = extracted.industry ?? null;
        record.companySize = extracted.size ?? null;
        record.headquartersLocation = extracted.hq ?? null;
        record.companyType = extracted.type ?? null;
        record.foundedYear = parseFoundedYear(extracted.founded);
        record.employeeCount = extracted.employees ?? null;
        record.followerCount = extracted.followers ?? null;
        if (extracted.specialties) {
            record.specialties = String(extracted.specialties)
                .split(/[,;\u2022\u00b7]/)
                .map((s: string) => s.trim())
                .filter(Boolean);
        }

        // Blocking is judged before the record is trusted, so a wall can never be saved
        // or charged even when og: metadata fills in enough fields to look real.
        const blocked = extracted.blocked === true
            || isBlockedUrl(page.url())
            || looksBlockedText(record.companyDescription);

        if (blocked) {
            session?.retire();
            throw new Error(`LinkedIn blocked the company page for ${url} (authwall or verification).`);
        }

        const tryNextCandidate = async (reason: string): Promise<boolean> => {
            const nextCandidate = candidates[candidateIndex + 1];
            if (!searchName || !nextCandidate) return false;

            log.info(`${reason} at ${url}; trying the next slug for "${searchName}".`);
            // Keyed by URL so a candidate can never duplicate a direct request or another
            // name's candidate, which would double-charge the same company.
            await crawler.addRequests([{
                url: nextCandidate,
                userData: {
                    label: 'company-profile',
                    searchName,
                    candidates,
                    candidateIndex: candidateIndex + 1,
                },
            }]);
            return true;
        };

        if (!hasUsableCompanyData(record)) {
            if (await tryNextCandidate('No company found')) return;
            log.warning(`No usable public data for ${url}. Not saving and not charging.`);
            return;
        }

        // A guessed slug must actually belong to the requested company before it is billed.
        if (searchName && !nameMatchesCompany(searchName, record.companyName)) {
            log.warning(
                `"${record.companyName}" at ${url} does not match the requested name "${searchName}".`,
            );
            if (await tryNextCandidate('Name mismatch')) return;
            log.warning(`Could not resolve "${searchName}" to a matching company. Not saving and not charging.`);
            return;
        }

        const canonicalUrl = normalizeCompanyUrl(record.linkedinUrl) ?? record.linkedinUrl;

        // The slot is reserved before any await, so concurrent workers cannot overshoot
        // the target, bill past the spending limit, or save one company twice.
        if (!reserveSave(budget, canonicalUrl, searchName)) {
            log.info(`Skipping ${canonicalUrl}: already saved or the company budget is reached.`);
            return;
        }

        try {
            await pushData(record);
        } catch (error) {
            releaseSave(budget, canonicalUrl, searchName);
            throw error;
        }

        try {
            const chargeResult = await Actor.charge({ eventName: 'company-scraped' });
            registerCharge(budget, Boolean(chargeResult?.eventChargeLimitReached));
        } catch (chargeErr) {
            log.warning(`PPE charge failed: ${(chargeErr as Error).message}`);
        }

        log.info(`Pushed data for: ${record.companyName ?? url}`, {
            saved: budget.pushed,
            maxCompanies: budget.maxCompanies,
        });

        if (isFinished(budget)) {
            const reason = budget.stopReason ?? 'max-results';
            log.info(`Stopping crawl: ${reason}.`);
            crawler.stop(`Reached ${reason}`);
        }
    },

};
