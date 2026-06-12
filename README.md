# LinkedIn Company Pages Scraper

Extract structured company data from public LinkedIn company pages. Provide direct LinkedIn company URLs to collect company names, websites, descriptions, industries, employee ranges, headquarters, founded years, company types, specialties, follower counts, public employee counts, logos, and profile URLs.

The Actor uses a browser with residential proxy support, session rotation, retries, and conservative concurrency. It saves only records that contain a company name plus meaningful public profile data. Missing values remain `null`; the Actor does not invent data or access private LinkedIn content.

Direct company URLs are the reliable input method. Company-name search is available as a best-effort beta because LinkedIn may require authentication for search pages.

## Output fields

| Field | Description |
|---|---|
| `companyName` | Public company name |
| `linkedinUrl` | Canonical LinkedIn company URL |
| `website` | Public company website |
| `tagline` | Public profile tagline, when exposed |
| `companyDescription` | Public company description |
| `industry` | LinkedIn industry |
| `companySize` | Published employee-size range |
| `headquartersLocation` | Published headquarters location |
| `foundedYear` | Published founding year |
| `companyType` | Public, private, nonprofit, or other published type |
| `specialties` | Published company specialties |
| `followerCount` | Public follower count |
| `employeeCount` | Public employee count when exposed in page metadata |
| `linkedinVerified` | `true` only when an explicit verification badge is visible; otherwise `null` |
| `logoUrl` | Public company logo URL |
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
  "tagline": null,
  "companyDescription": "Every company has a mission. What's ours? To empower every person and every organization to achieve more.",
  "industry": "Software Development",
  "companySize": "10,001+ employees",
  "headquartersLocation": "Redmond, Washington, US",
  "foundedYear": null,
  "companyType": "Public Company",
  "specialties": ["Business Software", "Developer Tools"],
  "followerCount": "28,327,871",
  "employeeCount": "232340",
  "linkedinVerified": null,
  "logoUrl": "https://media.licdn.com/dms/image/...",
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
| `company-scraped` | $0.004 per successfully saved company profile |

The Actor charges only after a usable company record is saved. Apify platform usage is billed separately.

## Responsible use

This Actor reads only publicly accessible company-page data. It does not use LinkedIn credentials or access private profiles. Users are responsible for complying with LinkedIn's terms, privacy requirements, and applicable laws.

## License

Apache-2.0
