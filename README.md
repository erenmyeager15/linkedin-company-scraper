# LinkedIn Company Monitor - CRM & Headcount Changes

Turn public LinkedIn company pages into structured CRM enrichment and a recurring company-change watchlist. Track follower and employee-count movement, website or positioning changes, company-size updates, headquarters changes, and other public profile signals—without LinkedIn credentials.

At **$3 per 1,000 successfully saved companies**, the Actor charges only for usable records. A direct HTTP attempt runs first to minimize platform cost, followed by bounded Residential HTTP and browser fallbacks only when public access needs them.

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

Blocked, auth-wall, mismatched, or empty pages are never saved and never charged. Duplicate companies are charged at most once per run, and the Actor respects Apify spending limits.

## Output fields

Core enrichment includes company name, canonical LinkedIn URL, website and domain, description, industry, size and normalized size bounds, headquarters, type, founding year, specialties, followers, public employee count, logo, match provenance, field coverage, and timestamp.

Monitoring fields add observation status/count, prior timestamp and values, numeric deltas, changed fields, signals, and bounded history.

## Pricing

| Event | Price |
|---|---:|
| Successfully saved company | $0.003 |
| 1,000 successfully saved companies | $3.00 |

Platform usage is included in the event price for Store users. No usable record means no company event charge.

## Responsible use

Use the data only for lawful purposes and review important changes before acting. The Actor does not collect personal-profile data or private contact information. Users are responsible for complying with applicable laws and platform terms.

## License

Apache-2.0
