export interface ActorInput {
    /** LinkedIn company URLs to scrape */
    companyUrls?: string[];
    /** Company names to search for on LinkedIn */
    companyNames?: string[];
    /** Max results per company name search */
    maxResults?: number;
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
    tagline: string | null;
    companyDescription: string | null;
    industry: string | null;
    companySize: string | null;
    headquartersLocation: string | null;
    foundedYear: string | null;
    companyType: string | null;
    specialties: string[];
    followerCount: string | null;
    employeeCount: string | null;
    linkedinVerified: boolean;
    logoUrl: string | null;
    bannerImageUrl: string | null;
    associatedMembersCount: string | null;
    recentPostsCount: string | null;
    fundingInfo: string | null;
    stockSymbol: string | null;
    affiliatedCompanies: string[];
    scrapedAt: string;
}
