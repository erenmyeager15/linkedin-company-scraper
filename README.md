# LinkedIn Company Scraper - $3/1k, Profiles & Insights

> **Unofficial Actor.** This tool is independent and is **not affiliated with, endorsed by, or sponsored by LinkedIn**. It collects only publicly available company page data and never uses LinkedIn credentials, cookies, or private APIs.

Extract structured company data from public LinkedIn company pages. Provide direct LinkedIn company URLs to collect company names, websites, descriptions, industries, employee ranges, headquarters, company types, specialties, follower counts, public employee counts, logos, and profile URLs.

The Actor uses an HTTP-first extraction path for speed and lower platform cost, with a bounded browser fallback only when a public page cannot be read reliably over HTTP.

The Actor uses residential proxy support, session rotation, retries, and bounded concurrency. Browser fallback is used only when the HTTP-first path cannot reliably read a public page. It saves only records that contain a company name plus meaningful public profile data. Missing values remain `null`; the Actor does not invent data or access private LinkedIn content.

Direct company URLs are the most precise input method. Company names are resolved to their public LinkedIn company page without login, which works reliably for well-known names and may not resolve ambiguous or heavily abbreviated ones.

A company is saved and charged only when the page yields a company name plus at least one substantive public field. Blocked pages are retried on a fresh session, and are never saved and never charged.

## Output fields

| Field | Description |
|---|---|
| `companyName` | Public company name |
| `linkedinUrl` | Canonical LinkedIn company URL |
| `website` | Public company website |
| `companyDescription` | Public company description |
| `industry` | LinkedIn industry |
| `companySize` | Published employee-size range |
| `headquartersLocation` | Published headquarters location |
| `companyType` | Public, private, nonprofit, or other published type |
| `foundedYear` | Published founding year when available |
| `specialties` | Published company specialties |
| `followerCount` | Public follower count |
| `employeeCount` | Public employee count when exposed in page metadata |
| `logoUrl` | Public company logo URL |
| `matchedFromName` | Original name input when the profile was resolved by name |
| `scrapedAt` | ISO extraction timestamp |

## Input

```json
{
  "companyUrls": [
    "https://www.linkedin.com/company/microsoft"
  ],
  "companyNames": [],
  "maxResults": 5,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"]
  }
}
```

## Sample output

```json
{
  "companyName": "Microsoft",
  "linkedinUrl": "https://www.linkedin.com/company/microsoft",
  "website": "https://news.microsoft.com/",
  "companyDescription": "Every company has a mission. What's ours? To empower every person and every organization to achieve more.",
  "industry": "Software Development",
  "companySize": "10,001+ employees",
  "headquartersLocation": "Redmond, Washington, US",
  "companyType": "Public Company",
  "foundedYear": 1975,
  "specialties": ["Business Software", "Developer Tools"],
  "followerCount": "28,327,871",
  "employeeCount": "232340",
  "logoUrl": "https://media.licdn.com/dms/image/...",
  "matchedFromName": null,
  "scrapedAt": "2026-06-12T14:00:00.000Z"
}
```

## How to scrape LinkedIn company pages

1. Open the Actor input.
2. Add one or more direct LinkedIn company URLs.
3. Keep residential proxy rotation enabled.
4. Run the Actor.
5. Export the dataset as JSON, CSV, Excel, or another supported format.

## Use cases

- B2B company research and lead enrichment
- Market and competitor analysis
- Industry and geographic segmentation
- Recruitment account research
- Public company directory enrichment

## Pricing

| Event | Price |
|---|---|
| `company-scraped` | $0.003 per successfully saved company profile ($3.00 per 1,000) |

The Actor charges only after a usable company record is saved. Platform usage is included in the event price for users.

## Responsible use

This Actor reads only publicly accessible company-page data. It does not use LinkedIn credentials or access private profiles. Users are responsible for complying with LinkedIn's terms, privacy requirements, and applicable laws.

## License

Apache-2.0
