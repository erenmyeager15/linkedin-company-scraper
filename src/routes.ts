import { PlaywrightCrawlingContext } from 'crawlee';
import { Actor } from 'apify';
import {
    BLOCK_TEXT_MARKERS,
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

        await page.waitForSelector('h1, script[type="application/ld+json"]', { timeout: 8000 }).catch(() => {});

        const record: CompanyRecord = {
            companyName: null,
            linkedinUrl: url,
            website: null,
            companyDescription: null,
            industry: null,
            companySize: null,
            headquartersLocation: null,
            companyType: null,
            specialties: [],
            followerCount: null,
            employeeCount: null,
            logoUrl: null,
            scrapedAt: new Date().toISOString(),
        };

        // Public LinkedIn company pages embed an Organization JSON-LD block plus a
        // guest "about" definition list. These are far more reliable than the
        // logged-in .org-top-card selectors.
        const extracted = await page.evaluate((blockMarkers: string[]) => {
            /* eslint-disable @typescript-eslint/no-explicit-any */
            const result: Record<string, any> = {};

            // JSON-LD Organization
            const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
            for (const s of scripts) {
                try {
                    let data: any = JSON.parse(s.textContent || '{}');
                    const graph = data['@graph'];
                    if (Array.isArray(graph)) {
                        data = graph.find((g: any) => /Organization/i.test(g['@type'])) ?? data;
                    }
                    const types = Array.isArray(data['@type']) ? data['@type'].join(' ') : (data['@type'] ?? '');
                    if (/Organization/i.test(types)) {
                        result.name = data.name ?? null;
                        result.description = data.description ?? null;
                        result.logo = (typeof data.logo === 'string' ? data.logo : data.logo?.url) ?? null;
                        const sameAs = Array.isArray(data.sameAs) ? data.sameAs[0] : data.sameAs;
                        result.website = data.url && !/linkedin\.com/i.test(data.url) ? data.url : (sameAs ?? null);
                        if (data.address) {
                            const a = data.address;
                            result.hq = [a.addressLocality, a.addressRegion, a.addressCountry].filter(Boolean).join(', ') || null;
                        }
                        if (data.numberOfEmployees) {
                            result.employees = String(data.numberOfEmployees.value ?? data.numberOfEmployees);
                        }
                        if (data.foundingDate) result.founded = String(data.foundingDate);
                        break;
                    }
                } catch { /* ignore bad JSON-LD */ }
            }

            // og: meta fallbacks
            const og = (p: string): string | null => document.querySelector(`meta[property="${p}"]`)?.getAttribute('content') ?? null;
            result.name = result.name ?? og('og:title');
            result.description = result.description ?? og('og:description');
            result.logo = result.logo ?? og('og:image');

            // Guest "about" definition list (dt/dd) for industry, size, HQ, founded, specialties, type
            const lists = Array.from(document.querySelectorAll('dl'));
            for (const dl of lists) {
                const terms = Array.from(dl.querySelectorAll('dt'));
                for (const term of terms) {
                    const label = (term.textContent || '').trim().toLowerCase();
                    const definition = term.nextElementSibling?.tagName === 'DD'
                        ? term.nextElementSibling
                        : null;
                    const value = (definition?.textContent || '').trim();
                    if (!label || !value) continue;
                    if (label.includes('website')) result.website = result.website ?? value;
                    else if (label.includes('industry')) result.industry = value;
                    else if (label.includes('size')) result.size = value;
                    else if (label.includes('headquarters')) result.hq = result.hq ?? value;
                    else if (label.includes('founded')) result.founded = value;
                    else if (label.includes('type')) result.type = value;
                    else if (label.includes('specialties')) result.specialties = value;
                }
            }

            // Followers (guest page subline)
            const bodyText = document.body?.innerText || '';
            const ft = bodyText.match(/([\d,.]+[KMB]?)\s+followers/i);
            result.followers = ft ? ft[1] : null;

            const lowerBody = bodyText.toLowerCase();
            result.blocked = blockMarkers.some((marker) => lowerBody.includes(marker));

            return result;
        }, BLOCK_TEXT_MARKERS);

        record.companyName = extracted.name ?? null;
        record.linkedinUrl = page.url().split('?')[0].replace(/\/$/, '');
        record.companyDescription = extracted.description ?? null;
        record.website = extracted.website ?? null;
        record.logoUrl = extracted.logo && !String(extracted.logo).startsWith('data:') ? extracted.logo : null;
        record.industry = extracted.industry ?? null;
        record.companySize = extracted.size ?? null;
        record.headquartersLocation = extracted.hq ?? null;
        record.companyType = extracted.type ?? null;
        record.employeeCount = extracted.employees ?? null;
        record.followerCount = extracted.followers ?? null;
        if (extracted.specialties) {
            record.specialties = String(extracted.specialties).split(/[,•·]/).map((s: string) => s.trim()).filter(Boolean);
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
