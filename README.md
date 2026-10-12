# LinkedIn Company Monitor - CRM & Headcount Changes

Extract public LinkedIn company data for CRM enrichment, account-based marketing (ABM) research and competitor monitoring. Build a recurring company watchlist to track follower and public employee-count movement, website or positioning changes, company-size updates and headquarters changes—without LinkedIn credentials.

The company-result event costs **$3 per 1,000 successfully saved companies**, plus the existing memory-based Actor Start fee. A direct HTTP attempt runs first to reduce proxy use, followed by bounded Residential HTTP and browser fallbacks only when public access needs them.

> **Unofficial Actor.** This tool is independent and is not affiliated with, endorsed by, or sponsored by LinkedIn. It reads public company pages only and never uses LinkedIn credentials, private APIs, personal profiles, emails, or phone numbers.

## Why teams use it

- **CRM data hygiene:** refresh company website, industry, size, HQ, type, and public counts.
- **Account intelligence:** detect material follower or employee movement with configurable thresholds.
- **Competitor monitoring:** schedule the same watchlist and review exactly which public fields changed.
- **ABM research:** normalize domains and public headcount ranges for downstream segmentation.
- **Audit-ready exports:** receive structured JSON plus formula-safe CSV and a concise Markdown report.

## Recurring watchlists

Use the same `watchlistName` and company URLs on every scheduled run. The Actor privately retains a bounded observation history for each company and returns:

- `observationStatus`: `baseline`, `updated`, `unchanged`, or `partial`
- `previousValues`: earlier values for changed fields
- `deltas`: numeric follower and employee changes
- `changes`: exact public fields that changed
- `signals`: deterministic alerts such as `FOLLOWERS_UP_8.2_PCT` or `COMPANY_SIZE_CHANGED`
- `observationHistory`: the latest 2–20 bounded observations

The run also saves `RUN_SUMMARY`, `report.md`, and `report.csv` in the default key-value store. Monitoring state stays private to your Actor storage.

## Input example

```json
{
  "companyUrls": [
    "https://www.linkedin.com/company/microsoft",
    "https://www.linkedin.com/company/apifytech"
  ],
  "companyNames": [],
  "maxResults": 5,
  "accessMode": "direct_first",
  "watchlistName": "us-saas-watchlist",
  "followerChangePercent": 5,
  "employeeChangePercent": 5,
  "historyLimit": 10,
  "generateMarkdownReport": true,
  "generateCsvReport": true,
  "proxyConfiguration": {
    "useApifyProxy": true,
    "apifyProxyGroups": ["RESIDENTIAL"],
    "apifyProxyCountry": "US"
  }
}
```

Direct URLs are the most precise input. Company-name lookup tests a bounded set of likely public slugs and verifies the returned company name before saving or charging.

## Output example

```json
{
  "companyName": "Microsoft",
  "linkedinUrl": "https://www.linkedin.com/company/microsoft",
  "companySlug": "microsoft",
  "website": "https://www.microsoft.com/",
  "websiteDomain": "microsoft.com",
  "industry": "Software Development",
  "companySize": "10,001+ employees",
  "companySizeMin": 10001,
  "companySizeMax": null,
  "headquartersLocation": "Redmond, Washington, US",
  "followerCount": "28,327,871",
  "followerCountNumeric": 28327871,
  "employeeCount": "232340",
  "employeeCountNumeric": 232340,
  "fieldCoveragePercent": 100,
  "watchlistName": "us-saas-watchlist",
  "observationStatus": "updated",
  "observationCount": 2,
  "previousObservedAt": "2026-10-10T14:00:00.000Z",
  "deltas": { "followers": 15200, "employees": 340 },
  "changes": ["followerCount", "employeeCount"],
  "signals": [],
  "scrapedAt": "2026-10-11T14:00:00.000Z"
}
```

Public fields can be missing or change presentation. Missing values remain `null`; the Actor does not infer private facts. A `partial` observation warns that a previously visible public count disappeared, so it is not mistaken for a real drop.

## Cost and reliability controls

`direct_first` is the recommended mode:

1. Try the public page over direct HTTP at no proxy-bandwidth cost.
2. Retry unresolved targets through the configured proxy over HTTP.
3. Launch a resource-blocked browser only for targets still unresolved.

Set `proxy_first` when consistency matters more than minimum cost. Explicitly disabling proxy remains supported, but LinkedIn may block direct access.

Blocked, auth-wall, mismatched or empty pages are not saved and do not trigger a `company-scraped` event. The Actor Start fee can still apply when no company is saved. Duplicate companies trigger at most one company-result event per run, and saving respects Apify's event-charge limit.

## Output fields

Core enrichment includes company name, canonical LinkedIn URL, website and domain, description, industry, size and normalized size bounds, headquarters, type, founding year, specialties, followers, public employee count, logo, match provenance, field coverage, and timestamp.

Monitoring fields add observation status/count, prior timestamp and values, numeric deltas, changed fields, signals, and bounded history.

## Pricing: Company Records + Actor Start

| Event | Price |
|---|---:|
| Successfully saved company | $0.003 |
| 1,000 successfully saved companies | $3.00 |
| `apify-actor-start` | $0.00005 per GB, minimum one event |

No usable record means no `company-scraped` charge, not a completely free run. The Actor Start fee can still apply to empty or failed runs, and companies already saved before a partial failure retain their normal result charges. Apify counts one start event per GB of memory, with at least one event; at the unchanged 1024 MB default, that is `$0.00005` for the start event.

Platform usage is included under the current Store pricing. Private history and CSV/Markdown reports have no extra monitoring event. See the [live Pricing tab](https://apify.com/fascinating_lentil/linkedin-company-scraper/pricing) for current event prices, discounts and platform-usage terms. Company-result subtotals exclude the start fee.

## Responsible use

Use the data only for lawful purposes and review important changes before acting. The Actor does not collect personal-profile data or private contact information. Users are responsible for complying with applicable laws and platform terms.

## License

Apache-2.0
