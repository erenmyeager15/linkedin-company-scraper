export interface ActorInput {
    /** LinkedIn company URLs to scrape */
    companyUrls?: string[];
    /** Company names to search for on LinkedIn */
    companyNames?: string[];
    /** Max results per company name search */
    maxResults?: number;
    /** Start with direct HTTP before paid proxy/browser fallbacks. */
    accessMode?: 'direct_first' | 'proxy_first';
    /** Stable private name used to retain recurring comparisons. */
    watchlistName?: string;
    followerChangePercent?: number;
    employeeChangePercent?: number;
    historyLimit?: number;
    generateMarkdownReport?: boolean;
    generateCsvReport?: boolean;
    /** Proxy configuration */
    proxyConfiguration?: {
        useApifyProxy?: boolean;
        apifyProxyGroups?: string[];
        apifyProxyCountry?: string;
    };
}

export interface CompanyRecord {
    companyName: string | null;
    linkedinUrl: string;
    website: string | null;
    companyDescription: string | null;
    industry: string | null;
    companySize: string | null;
    headquartersLocation: string | null;
    companyType: string | null;
    foundedYear: number | null;
    specialties: string[];
    followerCount: string | null;
    employeeCount: string | null;
    logoUrl: string | null;
    matchedFromName: string | null;
    scrapedAt: string;
    companySlug?: string | null;
    websiteDomain?: string | null;
    followerCountNumeric?: number | null;
    employeeCountNumeric?: number | null;
    companySizeMin?: number | null;
    companySizeMax?: number | null;
    fieldCoveragePercent?: number;
    watchlistName?: string;
    observationStatus?: 'baseline' | 'updated' | 'unchanged' | 'partial';
    observationCount?: number;
    previousObservedAt?: string | null;
    previousValues?: Record<string, unknown>;
    deltas?: { followers: number | null; employees: number | null };
    changes?: string[];
    signals?: string[];
    observationHistory?: CompanyObservation[];
}

export interface CompanyObservation {
    observedAt: string;
    followerCount: number | null;
    employeeCount: number | null;
    companySize: string | null;
    website: string | null;
    industry: string | null;
    headquartersLocation: string | null;
}
