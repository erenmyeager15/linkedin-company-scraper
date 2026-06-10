# LinkedIn Company Scraper — Extract Company Profiles & Data

A production-ready Apify Actor that extracts comprehensive company profile data from LinkedIn company pages. Supports both direct URL input and company name search to automatically find and scrape LinkedIn company profiles.

## What It Extracts

| Field | Description |
|---|---|
| Company Name | Official company name |
| LinkedIn URL | Canonical LinkedIn company profile URL |
| Website | Company website URL |
| Tagline | Company tagline or subtitle |
| Company Description | Full company description text |
| Industry | Industry classification |
| Company Size | Employee count range |
| Headquarters Location | HQ address |
| Founded Year | Year the company was established |
| Company Type | Public / Private / Nonprofit / Partnership / Government |
| Specialties | List of company specialties |
| Follower Count | Number of LinkedIn followers |
| Employee Count | Number of employees on LinkedIn |
| LinkedIn Verified | Whether the profile is verified |
| Logo URL | Company logo image URL |
| Banner Image URL | Company banner/cover image URL |
| Associated Members | Public count of associated members |
| Recent Posts Count | Number of recent posts |
| Funding Info | Funding details if available |
| Stock Symbol | Stock ticker if publicly traded |
| Affiliated Companies | Parent companies and subsidiaries |
| Scraped At | ISO timestamp of extraction |

## How It Works

1. Accepts LinkedIn company URLs or company names as input
2. For name searches, queries LinkedIn search to find matching company profiles
3. Navigates to each company profile page
4. Extracts all publicly available profile fields
5. Deduplicates results by LinkedIn URL
6. Saves records to Apify Dataset with per-record PPE charging

## Features

- **Dual input mode**: Direct URLs or company name search
- **Deduplication**: Automatically deduplicates by LinkedIn URL
- **Anti-bot protection**: Residential proxy rotation, session pooling (max 10 uses), random delays 3-7s, retry on blocked
- **Pay-per-event**: $0.004 per company profile scraped
- **No login required**: Scrapes only publicly available data
- **Null fallbacks**: Gracefully handles missing fields

## 5 Use Cases

1. **B2B Sales Prospecting** — Build enriched prospect lists with company size, industry, and location data for targeted outreach campaigns
2. **Competitor Intelligence** — Track competitor profiles, follower growth, specialties, and recent activity to inform strategy
3. **Market Research** — Aggregate industry data, company sizes, and geographic distribution for market analysis reports
4. **Investor Due Diligence** — Pull company descriptions, funding info, stock symbols, and affiliated companies for investment research
5. **Recruitment Targeting** — Identify companies by size, industry, and location to optimize recruitment outreach efforts

## Sample Output

```json
{
  "companyName": "Microsoft",
  "linkedinUrl": "https://www.linkedin.com/company/microsoft",
  "website": "https://www.microsoft.com",
  "tagline": "Empowering every person and every organization on the planet to achieve more",
  "companyDescription": "Microsoft Corporation is an American multinational technology corporation...",
  "industry": "Computer Software",
  "companySize": "10,001+ employees",
  "headquartersLocation": "Redmond, WA",
  "foundedYear": "1975",
  "companyType": "Public",
  "specialties": ["Cloud Computing", "Software", "AI", "Enterprise Solutions"],
  "followerCount": "23,500,000",
  "employeeCount": "221,000",
  "linkedinVerified": true,
  "logoUrl": "https://media.licdn.com/dms/image/...",
  "bannerImageUrl": "https://media.licdn.com/dms/image/...",
  "associatedMembersCount": "1,200,000",
  "recentPostsCount": "47",
  "fundingInfo": null,
  "stockSymbol": "NASDAQ: MSFT",
  "affiliatedCompanies": ["LinkedIn", "GitHub", "Activision Blizzard"],
  "scrapedAt": "2026-06-10T12:00:00.000Z"
}
```

## Pricing

| Event | Price | Description |
|---|---|---|
| Company Profile Scraped | $0.004 | Charged after each successful company profile extraction |

Example: Scraping 500 company profiles costs $2.00.

## Input Configuration

| Field | Type | Required | Description |
|---|---|---|---|
| `companyUrls` | `string[]` | No | Direct LinkedIn company profile URLs |
| `companyNames` | `string[]` | No | Company names to search for on LinkedIn |
| `maxResults` | `number` | No | Max results per name search (default: 5, max: 100) |
| `proxyConfiguration` | `object` | No | Proxy settings (residential recommended) |

At least one of `companyUrls` or `companyNames` must be provided.

## Ethics & Legal Notice

This Actor scrapes **only publicly available data** from LinkedIn company profiles. It does not:
- Access private or authenticated content
- Store or use login credentials
- Circumvent LinkedIn's access controls

Users are responsible for ensuring their use of this data complies with LinkedIn's Terms of Service, applicable data protection regulations (GDPR, CCPA, etc.), and local laws. This tool is intended for legitimate business intelligence, research, and prospecting purposes.

## Proxy Configuration

Residential proxies are **strongly recommended** for LinkedIn scraping. The Actor defaults to Apify's RESIDENTIAL proxy group with US country routing. You can configure:

- Proxy groups (RESIDENTIAL, DATACENTER, etc.)
- Country code for geo-targeting
- Custom proxy endpoints

## Rate Limiting

The Actor implements strict anti-detection measures:
- Random delays between 3-7 seconds per request
- Session pool with max 10 uses per session
- Automatic retry on blocked requests (up to 3 retries)
- Max concurrency of 3 to avoid detection
