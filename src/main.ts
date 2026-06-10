import { Actor, log } from 'apify';
import { PlaywrightCrawler } from 'crawlee';
import { routeHandlers } from './routes.js';
import type { ActorInput } from './types.js';

const LINKEDIN_BASE = 'https://www.linkedin.com';

function normalizeUrl(url: string): string {
    let cleaned = url.trim();
    if (!cleaned.startsWith('http')) {
        cleaned = `https://www.linkedin.com${cleaned.startsWith('/') ? '' : '/'}${cleaned}`;
    }
    cleaned = cleaned.replace(/\/$/, '');
    const match = cleaned.match(/(linkedin\.com\/company\/[^/?]+)/i);
    if (match) {
        const path = match[1];
        return `https://www.${path}`;
    }
    return cleaned;
}

function isLinkedInCompanyUrl(url: string): boolean {
    return /linkedin\.com\/company\//i.test(url);
}

function buildSearchUrl(query: string, maxResults: number): string {
    const encoded = encodeURIComponent(query);
    return `${LINKEDIN_BASE}/search/results/companies/?keywords=${encoded}&origin=GLOBAL_SEARCH_HEADER`;
}

await Actor.main(async () => {
    const input = (await Actor.getInput()) as ActorInput | null;
    if (!input) {
        throw new Error('Input is required. Please provide companyUrls or companyNames.');
    }

    const {
        companyUrls = [],
        companyNames = [],
        maxResults = 5,
        proxyConfiguration: proxyConfig,
    } = input;

    if (companyUrls.length === 0 && companyNames.length === 0) {
        throw new Error('At least one company URL or company name is required.');
    }

    const seenUrls = new Set<string>();
    const urlsToScrape: string[] = [];

    for (const raw of companyUrls) {
        if (!raw) continue;
        const normalized = normalizeUrl(raw);
        if (!isLinkedInCompanyUrl(normalized)) {
            log.warning(`Skipping invalid LinkedIn company URL: ${raw}`);
            continue;
        }
        if (!seenUrls.has(normalized)) {
            seenUrls.add(normalized);
            urlsToScrape.push(normalized);
        }
    }

    const searchData: Array<{ url: string; userData: { label: string; searchQuery: string; maxResults: number } }> = [];
    for (const name of companyNames) {
        if (!name) continue;
        const searchUrl = buildSearchUrl(name, maxResults);
        searchData.push({
            url: searchUrl,
            userData: { label: 'search-results', searchQuery: name, maxResults },
        });
    }

    log.info(`Starting scraper: ${urlsToScrape.length} direct URLs, ${searchData.length} name searches`);

    const proxyConfiguration = proxyConfig?.useApifyProxy !== false
        ? await Actor.createProxyConfiguration({
            groups: proxyConfig?.apifyProxyGroups ?? ['RESIDENTIAL'],
            countryCode: proxyConfig?.apifyProxyCountry ?? 'US',
        })
        : undefined;

    const crawler = new PlaywrightCrawler({
        proxyConfiguration,
        useSessionPool: true,
        maxConcurrency: 3,
        requestHandlerTimeoutSecs: 120,
        navigationTimeoutSecs: 120,
        maxRequestRetries: 3,
        retryOnBlocked: true,

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
            async ({ page }) => {
                page.setDefaultTimeout(8000);
                const delay = Math.floor(Math.random() * 4000) + 3000;
                await new Promise((resolve) => setTimeout(resolve, delay));
            },
        ],

        requestHandler: async (context) => {
            const label = context.request.userData.label as string | undefined;
            if (label === 'search-results') {
                await routeHandlers.handleSearchResults(context);
            } else {
                await routeHandlers.handleCompanyProfile(context);
            }
        },

        failedRequestHandler: async ({ request, log: ctxLog, session }, error) => {
            ctxLog.error(`Request failed: ${request.url}`, { error: (error as Error)?.message ?? 'Unknown error' });
            if (session) {
                session.retire();
            }
        },
    });

    if (urlsToScrape.length > 0) {
        await crawler.addRequests(
            urlsToScrape.map((url) => ({
                url,
                userData: { label: 'company-profile' },
            }))
        );
    }

    if (searchData.length > 0) {
        await crawler.addRequests(searchData);
    }

    await crawler.run();

    log.info('Actor finished successfully');
});
