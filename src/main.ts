import { Actor, log } from 'apify';
import {
    HttpCrawler,
    PlaywrightCrawler,
    type HttpCrawlingContext,
    type ProxyConfiguration,
    type RequestOptions,
} from 'crawlee';
import { handleHttpCompanyProfile } from './http-routes.js';
import {
    candidateUrls,
    canSaveMore,
    clampMaxResults,
    createBudget,
    MAX_SLUG_CANDIDATES,
    normalizeCompanyUrl,
    shouldAllowResource,
} from './lib.js';
import { MonitoringContext } from './monitoring.js';
import { routeHandlers } from './routes.js';
import { setBudget, setMonitoring } from './state.js';
import type { ActorInput } from './types.js';

type QueuedRequest = { url: string; userData: Record<string, unknown>; uniqueKey?: string };

await Actor.main(async () => {
    const input = (await Actor.getInput()) as ActorInput | null;
    if (!input) {
        await Actor.setStatusMessage('No company URLs or names provided; nothing to scrape.');
        return;
    }

    const {
        companyUrls = [], companyNames = [], proxyConfiguration: proxyConfig, accessMode = 'direct_first',
    } = input;
    if (companyUrls.length === 0 && companyNames.length === 0) {
        await Actor.setStatusMessage('No company URLs or names provided; nothing to scrape.');
        return;
    }

    const maxResults = clampMaxResults(input.maxResults);
    const seenUrls = new Set<string>();
    const directRequests: QueuedRequest[] = [];
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

    const nameRequests: QueuedRequest[] = [];
    for (const name of companyNames) {
        if (!name?.trim()) continue;
        const candidates = candidateUrls(name);
        if (candidates.length === 0) {
            log.warning(`Could not derive a LinkedIn company URL from name: ${name}`);
            continue;
        }
        const startIndex = candidates.findIndex((candidate) => !seenUrls.has(candidate));
        if (startIndex === -1) {
            log.info(`All slug candidates for "${name}" are already queued; skipping duplicate lookup.`);
            continue;
        }
        seenUrls.add(candidates[startIndex]);
        nameRequests.push({
            url: candidates[startIndex],
            userData: { label: 'company-profile', searchName: name, candidates, candidateIndex: startIndex },
        });
    }

    const cappedNameRequests = nameRequests.slice(0, maxResults);
    if (cappedNameRequests.length < nameRequests.length) {
        log.info(`Limiting name lookups to maxResults (${maxResults}) of ${nameRequests.length} names.`);
    }
    const initialRequests = [...directRequests, ...cappedNameRequests];
    if (initialRequests.length === 0) {
        await Actor.setStatusMessage('No valid LinkedIn company URLs or resolvable company names were provided.');
        return;
    }

    const budget = createBudget(initialRequests.length);
    const monitoring = await MonitoringContext.create(input);
    setBudget(budget);
    setMonitoring(monitoring);
    const requestLimit = directRequests.length + cappedNameRequests.length * MAX_SLUG_CANDIDATES + 10;
    log.info('Starting LinkedIn company monitor', {
        directUrls: directRequests.length, nameLookups: cappedNameRequests.length, accessMode,
    });

    const proxyConfiguration = proxyConfig?.useApifyProxy !== false
        ? await Actor.createProxyConfiguration({
            groups: proxyConfig?.apifyProxyGroups ?? ['RESIDENTIAL'],
            countryCode: proxyConfig?.apifyProxyCountry ?? 'US',
        })
        : undefined;
    if (!proxyConfiguration) {
        log.warning('Apify Proxy is disabled. Direct HTTP and a direct browser fallback will be attempted.');
    }

    const restartNameLookup = (request: QueuedRequest): QueuedRequest => {
        const candidates = request.userData.candidates as string[] | undefined;
        const searchName = request.userData.searchName as string | undefined;
        if (!searchName || !candidates?.[0]) return request;
        return {
            url: candidates[0],
            userData: { ...request.userData, candidateIndex: 0 },
        };
    };

    const browserFallbackRequests: RequestOptions[] = [];
    const browserFallbackUrls = new Set<string>();
    const scheduleBrowserFallback = (request: QueuedRequest): void => {
        const restarted = restartNameLookup(request);
        if (browserFallbackUrls.has(restarted.url)) return;
        browserFallbackUrls.add(restarted.url);
        browserFallbackRequests.push({ ...restarted, uniqueKey: `browser:${restarted.url}` });
    };

    const runHttpStage = async (
        requests: QueuedRequest[],
        stageName: string,
        stageProxy: ProxyConfiguration | undefined,
        retries: number,
        scheduleUnresolved: (request: QueuedRequest) => void,
    ): Promise<void> => {
        if (requests.length === 0 || !canSaveMore(budget)) return;
        log.info(`${stageName}: ${requests.length} target(s).`);
        const crawler = new HttpCrawler({
            proxyConfiguration: stageProxy,
            useSessionPool: Boolean(stageProxy),
            maxConcurrency: 10,
            requestHandlerTimeoutSecs: 45,
            maxRequestRetries: retries,
            retryOnBlocked: Boolean(stageProxy),
            maxRequestsPerCrawl: requestLimit,
            sessionPoolOptions: {
                maxPoolSize: 20,
                sessionOptions: { maxAgeSecs: 1800, maxUsageCount: 10 },
            },
            requestHandler: async (context) => handleHttpCompanyProfile(
                context as unknown as HttpCrawlingContext,
                scheduleUnresolved,
            ),
            failedRequestHandler: async ({ request, log: ctxLog, session }, error) => {
                ctxLog.warning(`${stageName} request exhausted retries; continuing to the next access stage.`, {
                    url: request.url, error: (error as Error)?.message ?? 'Unknown error',
                });
                session?.retire();
                scheduleUnresolved({ url: request.url, userData: request.userData });
            },
        });
        await crawler.run(requests);
    };

    if (accessMode === 'direct_first') {
        const proxyHttpRequests: QueuedRequest[] = [];
        const proxyHttpUrls = new Set<string>();
        const scheduleProxyHttp = (request: QueuedRequest): void => {
            const restarted = restartNameLookup(request);
            if (proxyHttpUrls.has(restarted.url)) return;
            proxyHttpUrls.add(restarted.url);
            // The direct stage already handled this URL in the shared request queue.
            proxyHttpRequests.push({ ...restarted, uniqueKey: `proxy-http:${restarted.url}` });
        };
        await runHttpStage(
            initialRequests, 'Direct HTTP', undefined, 0,
            proxyConfiguration ? scheduleProxyHttp : scheduleBrowserFallback,
        );
        if (proxyConfiguration) {
            await runHttpStage(proxyHttpRequests, 'Proxy HTTP fallback', proxyConfiguration, 2, scheduleBrowserFallback);
        }
    } else {
        await runHttpStage(initialRequests, 'Proxy HTTP', proxyConfiguration, 2, scheduleBrowserFallback);
    }

    if (browserFallbackRequests.length > 0 && canSaveMore(budget)) {
        log.info(`Browser fallback: ${browserFallbackRequests.length} unresolved target(s).`);
        const crawler = new PlaywrightCrawler({
            proxyConfiguration,
            useSessionPool: Boolean(proxyConfiguration),
            maxConcurrency: 2,
            requestHandlerTimeoutSecs: 120,
            navigationTimeoutSecs: 120,
            maxRequestRetries: 3,
            retryOnBlocked: Boolean(proxyConfiguration),
            maxRequestsPerCrawl: requestLimit,
            launchContext: {
                launchOptions: {
                    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
                },
            },
            sessionPoolOptions: {
                maxPoolSize: 20,
                sessionOptions: { maxAgeSecs: 3600, maxUsageCount: 10 },
            },
            preNavigationHooks: [
                async ({ page }, gotoOptions) => {
                    if (gotoOptions) gotoOptions.waitUntil = 'domcontentloaded';
                    await page.route('**/*', async (route) => {
                        if (shouldAllowResource(route.request().resourceType())) {
                            await route.continue().catch(() => {});
                        } else {
                            await route.abort().catch(() => {});
                        }
                    }).catch(() => {});
                    page.setDefaultTimeout(8000);
                    const delay = Math.floor(Math.random() * 1500) + 1000;
                    await new Promise((resolve) => setTimeout(resolve, delay));
                },
            ],
            requestHandler: async (context) => routeHandlers.handleCompanyProfile(context),
            failedRequestHandler: async ({ request, log: ctxLog, session }, error) => {
                ctxLog.error(`Browser fallback failed: ${request.url}`, {
                    error: (error as Error)?.message ?? 'Unknown error',
                });
                session?.retire();
            },
        });
        await crawler.run(browserFallbackRequests);
    }

    const summary = await monitoring.saveReports();
    log.info('Actor finished', {
        companiesSaved: budget.pushed,
        companiesCharged: budget.charged,
        stopReason: budget.stopReason ?? 'targets-exhausted',
        baseline: summary.baseline,
        updated: summary.updated,
        unchanged: summary.unchanged,
        partial: summary.partial,
        signals: summary.signals,
    });
    if (budget.charged < budget.pushed) {
        log.warning(`${budget.pushed - budget.charged} company record(s) were saved without a successful charge.`);
    }
    if (budget.stopReason === 'charge-limit') {
        await Actor.setStatusMessage(`Stopped at the run's spending limit after saving ${budget.pushed} companies.`);
    } else if (budget.pushed === 0) {
        await Actor.setStatusMessage('No public company data was extracted. Check the URLs or enable Residential proxy fallback.');
    } else {
        await Actor.setStatusMessage(`Saved ${budget.pushed} companies; ${summary.updated} changed and ${summary.signals} signals found.`);
    }
});
