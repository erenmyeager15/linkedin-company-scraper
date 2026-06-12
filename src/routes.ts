import { PlaywrightCrawlingContext } from 'crawlee';
import { Actor } from 'apify';
import type { CompanyRecord } from './types.js';

export const routeHandlers = {
    async handleCompanyProfile(context: PlaywrightCrawlingContext) {
        const { page, request, log, pushData } = context;
        const url = request.url;

        log.info(`Scraping company profile: ${url}`);

        await page.waitForSelector('h1, script[type="application/ld+json"]', { timeout: 20000 }).catch(() => {});

        const record: CompanyRecord = {
            companyName: null,
            linkedinUrl: url,
            website: null,
            tagline: null,
            companyDescription: null,
            industry: null,
            companySize: null,
            headquartersLocation: null,
            foundedYear: null,
            companyType: null,
            specialties: [],
            followerCount: null,
            employeeCount: null,
            linkedinVerified: null,
            logoUrl: null,
            scrapedAt: new Date().toISOString(),
        };

        // Public LinkedIn company pages embed an Organization JSON-LD block plus a
        // guest "about" definition list. These are far more reliable than the
        // logged-in .org-top-card selectors.
        const extracted = await page.evaluate(() => {
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
                        break;
                    }
                } catch { /* ignore bad JSON-LD */ }
            }

            // og: meta fallbacks
            const og = (p: string): string | null => document.querySelector(`meta[property="${p}"]`)?.getAttribute('content') ?? null;
            result.name = result.name ?? og('og:title');
            result.description = result.description ?? og('og:description');
            result.logo = result.logo ?? og('og:image');

            const textOf = (selector: string): string | null => {
                const text = document.querySelector(selector)?.textContent?.trim();
                return text || null;
            };
            result.tagline = textOf('.org-top-card-summary__tagline')
                ?? textOf('[data-test-id="about-us__tagline"]');

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
            const ft = document.body.innerText.match(/([\d,.]+[KMB]?)\s+followers/i);
            result.followers = ft ? ft[1] : null;

            result.verified = !!document.querySelector(
                '[aria-label*="verified" i], [title*="verified" i], [data-test-id*="verified" i]'
            );

            return result;
        });

        record.companyName = extracted.name ?? null;
        record.linkedinUrl = page.url().split('?')[0].replace(/\/$/, '');
        record.tagline = extracted.tagline ?? null;
        record.companyDescription = extracted.description ?? null;
        record.website = extracted.website ?? null;
        record.logoUrl = extracted.logo && !String(extracted.logo).startsWith('data:') ? extracted.logo : null;
        record.industry = extracted.industry ?? null;
        record.companySize = extracted.size ?? null;
        record.headquartersLocation = extracted.hq ?? null;
        record.foundedYear = extracted.founded ?? null;
        record.companyType = extracted.type ?? null;
        record.employeeCount = extracted.employees ?? null;
        record.followerCount = extracted.followers ?? null;
        record.linkedinVerified = extracted.verified ? true : null;
        if (extracted.specialties) {
            record.specialties = String(extracted.specialties).split(/[,•·]/).map((s: string) => s.trim()).filter(Boolean);
        }

        // Only save and charge if we identified the company with real data.
        const hasData = !!record.companyName && (record.companyDescription !== null || record.website !== null || record.industry !== null || record.headquartersLocation !== null);
        if (!hasData) {
            log.warning(`No usable data for ${url} (authwall or layout change). Not saving or charging.`);
            return;
        }

        await pushData(record);

        try {
            await Actor.charge({ eventName: 'company-scraped' });
        } catch (chargeErr) {
            log.warning(`PPE charge failed: ${chargeErr}`);
        }
        log.info(`Pushed data for: ${record.companyName ?? url}`);
    },

    async handleSearchResults(context: PlaywrightCrawlingContext) {
        const { page, request, log, enqueueLinks } = context;
        const query = request.userData as { searchQuery?: string; maxResults?: number };

        log.info(`Processing search results for: ${query?.searchQuery ?? request.url}`);

        await page.waitForSelector('.reusable-search__result-container', { timeout: 30000 }).catch(() => {});

        const resultLinks = page.locator('.reusable-search__result-container a[href*="/company/"], .entity-result__title-line a[href*="/company/"]');
        const count = await resultLinks.count();
        const limit = query?.maxResults ?? 5;
        const urlsToEnqueue: string[] = [];

        for (let i = 0; i < count && urlsToEnqueue.length < limit; i++) {
            const href = await resultLinks.nth(i).getAttribute('href');
            if (href && href.includes('/company/')) {
                const cleanUrl = href.split('?')[0];
                urlsToEnqueue.push(cleanUrl);
            }
        }

        if (urlsToEnqueue.length > 0) {
            await enqueueLinks({
                urls: urlsToEnqueue,
                label: 'company-profile',
            });
        }

        log.info(`Enqueued ${urlsToEnqueue.length} company links from search results`);
    },
};
