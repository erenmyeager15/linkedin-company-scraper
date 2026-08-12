import { Actor, log } from 'apify';
import { PlaywrightCrawler } from 'crawlee';
import { routeHandlers } from './routes.js';
import {
    candidateUrls,
    clampMaxResults,
    createBudget,
    MAX_SLUG_CANDIDATES,
    normalizeCompanyUrl,
    shouldAllowResource,
} from './lib.js';
import { setBudget } from './state.js';
import type { ActorInput } from './types.js';

await Actor.main(async () => {
    const input = (await Actor.getInput()) as ActorInput | null;
    if (!input) {
        await Actor.setStatusMessage('No company URLs or names provided; nothing to scrape.');
        return;
    }

    const {
        companyUrls = [],
        companyNames = [],
        proxyConfiguration: proxyConfig,
    } = input;

    if (companyUrls.length === 0 && companyNames.length === 0) {
        await Actor.setStatusMessage('No company URLs or names provided; nothing to scrape.');
        return;
    }

    const maxResults = clampMaxResults(input.maxResults);

    const seenUrls = new Set<string>();
    const directRequests: Array<{ url: string; userData: Record<string, unknown> }> = [];

    for (const raw of companyUrls) {
        if (!raw) continue;
        const normalized = normalizeCompanyUrl(raw);
        if (!normalized) {
            log.warning(`Skipping invalid LinkedIn company URL: ${raw}`);
            continue;
        }
        if (seenUrls.has(normalized)) continue;
        seenUrls.add(normalized);
        directRequests.push({ url: normalized, userData: { label: 'company-profile' } });
    }

    // LinkedIn company search needs a login, so each name is resolved against public
    // company pages by trying the slugs LinkedIn actually uses, one at a time.
    const nameRequests: Array<{ url: string; userData: Record<string, unknown> }> = [];
    for (const name of companyNames) {
        if (!name?.trim()) continue;
        const candidates = candidateUrls(name);
        if (candidates.length === 0) {
            log.warning(`Could not derive a LinkedIn company URL from name: ${name}`);
            continue;
        }
        // If an earlier target already claimed the first spelling, start this name at the
        // next unused candidate instead of dropping the name entirely.
        const startIndex = candidates.findIndex((candidate) => !seenUrls.has(candidate));
        if (startIndex === -1) {
            log.info(`All slug candidates for "${name}" are already queued; skipping duplicate lookup.`);
            continue;
        }

        seenUrls.add(candidates[startIndex]);
        nameRequests.push({
            url: candidates[startIndex],
            userData: {
                label: 'company-profile',
                searchName: name,
                candidates,
                candidateIndex: startIndex,
            },
        });
    }

    // Name lookups are capped by maxResults; explicitly listed URLs are always honoured.
    const cappedNameRequests = nameRequests.slice(0, maxResults);
    if (cappedNameRequests.length < nameRequests.length) {
        log.info(`Limiting name lookups to maxResults (${maxResults}) of ${nameRequests.length} names.`);
    }

    if (directRequests.length + cappedNameRequests.length === 0) {
        await Actor.setStatusMessage('No valid LinkedIn company URLs or resolvable company names were provided.');
        return;
    }

    // Each direct URL and each resolved name yields at most one company, so the number
    // of targets is the hard ceiling on saved and charged records.
    const budget = createBudget(directRequests.length + cappedNameRequests.length);
    setBudget(budget);

    log.info(`Starting scraper: ${directRequests.length} direct URLs, ${cappedNameRequests.length} name lookups`);

    const proxyConfiguration = proxyConfig?.useApifyProxy !== false
        ? await Actor.createProxyConfiguration({
            groups: proxyConfig?.apifyProxyGroups ?? ['RESIDENTIAL'],
            countryCode: proxyConfig?.apifyProxyCountry ?? 'US',
        })
        : undefined;

    if (!proxyConfiguration) {
        log.warning('Running without Apify Proxy. LinkedIn blocks datacenter IPs, so results are likely to be empty.');
    }

    const crawler = new PlaywrightCrawler({
        proxyConfiguration,
        useSessionPool: true,
        // Two pages keep peak memory inside the 1 GB tier, which is the cheapest
        // compute unit that still fits a Chromium instance.
        maxConcurrency: 2,
        requestHandlerTimeoutSecs: 120,
        navigationTimeoutSecs: 120,
        maxRequestRetries: 3,
        retryOnBlocked: true,
        // Bounds a large input list: every target plus its slug retries and a small margin.
        maxRequestsPerCrawl: directRequests.length + cappedNameRequests.length * MAX_SLUG_CANDIDATES + 10,

        launchContext: {
            launchOptions: {
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                ],
            },
        },

        sessionPoolOptions: {
            maxPoolSize: 20,
            sessionOptions: {
                maxAgeSecs: 3600,
                maxUsageCount: 10,
            },
        },

        preNavigationHooks: [
            async ({ page }, gotoOptions) => {
                // Company data is server-rendered, so there is nothing to wait for after
                // DOMContentLoaded. This cuts paid seconds off every navigation.
                if (gotoOptions) gotoOptions.waitUntil = 'domcontentloaded';

                // Fetch only the HTML document. LinkedIn's scripts alone were several
                // megabytes of residential bandwidth per company page.
                await page.route('**/*', async (route) => {
                    if (shouldAllowResource(route.request().resourceType())) {
                        await route.continue().catch(() => { /* navigation already settled */ });
                    } else {
                        await route.abort().catch(() => { /* navigation already settled */ });
                    }
                }).catch(() => { /* best effort */ });

                page.setDefaultTimeout(8000);
                const delay = Math.floor(Math.random() * 1500) + 1000;
                await new Promise((resolve) => setTimeout(resolve, delay));
            },
        ],

        requestHandler: async (context) => {
            await routeHandlers.handleCompanyProfile(context);
        },

        failedRequestHandler: async ({ request, log: ctxLog, session }, error) => {
            ctxLog.error(`Request failed: ${request.url}`, { error: (error as Error)?.message ?? 'Unknown error' });
            if (session) {
                session.retire();
            }
        },
    });

    await crawler.run([...directRequests, ...cappedNameRequests]);

    log.info('Actor finished', {
        companiesSaved: budget.pushed,
        companiesCharged: budget.charged,
        stopReason: budget.stopReason ?? 'targets-exhausted',
    });

    if (budget.charged < budget.pushed) {
        log.warning(`${budget.pushed - budget.charged} company record(s) were saved without a successful charge.`);
    }

    if (budget.stopReason === 'charge-limit') {
        await Actor.setStatusMessage(`Stopped at the run's spending limit after saving ${budget.pushed} companies.`);
    } else if (budget.pushed === 0) {
        await Actor.setStatusMessage(
            'No public company data was extracted. Check the company URLs, or enable Apify Proxy (residential).',
        );
    } else {
        await Actor.setStatusMessage(`Saved ${budget.pushed} LinkedIn company profiles.`);
    }
});
