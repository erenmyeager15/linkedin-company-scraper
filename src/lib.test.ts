import assert from 'node:assert/strict';
import test from 'node:test';
import { extractCompanyHtml } from './extract.js';
import {
    candidateUrls,
    canSaveMore,
    clampMaxResults,
    companySlugCandidates,
    createBudget,
    hasUsableCompanyData,
    isBlockedStatus,
    isBlockedUrl,
    isFinished,
    isAlreadySaved,
    isLinkedInCompanyUrl,
    isNameResolved,
    looksBlockedText,
    nameMatchesCompany,
    normalizeCompanyUrl,
    parseFoundedYear,
    registerCharge,
    releaseSave,
    reserveSave,
} from './lib.js';

test('HTTP HTML extraction preserves structured public company fields', () => {
    const html = `<!doctype html><html><head>
        <meta property="og:title" content="Fallback Name">
        <script type="application/ld+json">{
            "@type":"Organization",
            "name":"Acme",
            "description":"Public company description",
            "url":"https://www.linkedin.com/company/acme",
            "sameAs":["https://acme.example"],
            "foundingDate":"2012",
            "numberOfEmployees":{"value":250}
        }</script>
    </head><body><dl>
        <dt>Industry</dt><dd>Software</dd>
        <dt>Specialties</dt><dd>Analytics; Automation</dd>
    </dl><p>12,345 followers</p></body></html>`;

    const record = extractCompanyHtml(html);
    assert.equal(record.name, 'Acme');
    assert.equal(record.website, 'https://acme.example');
    assert.equal(record.industry, 'Software');
    assert.equal(record.specialties, 'Analytics; Automation');
    assert.equal(record.followers, '12,345');
    assert.equal(record.employees, '250');
    assert.equal(record.blocked, false);
});

test('founding dates are normalized without inventing a year', () => {
    assert.equal(parseFoundedYear('Founded 1975'), 1975);
    assert.equal(parseFoundedYear('2009-01-01'), 2009);
    assert.equal(parseFoundedYear('unknown'), null);
    assert.equal(parseFoundedYear(null), null);
});

const ACME_URL = 'https://www.linkedin.com/company/acme';

test('company URLs are canonicalised to the public guest profile', () => {
    assert.equal(
        normalizeCompanyUrl('https://www.linkedin.com/company/microsoft/'),
        'https://www.linkedin.com/company/microsoft',
    );
    assert.equal(
        normalizeCompanyUrl('linkedin.com/company/Microsoft/about/?trk=abc'),
        'https://www.linkedin.com/company/microsoft',
    );
    assert.equal(
        normalizeCompanyUrl('/company/apify/people'),
        'https://www.linkedin.com/company/apify',
    );
    assert.equal(
        normalizeCompanyUrl('https://www.linkedin.com/showcase/azure/'),
        'https://www.linkedin.com/company/azure',
    );
});

test('non-company links are rejected instead of scraped', () => {
    assert.equal(normalizeCompanyUrl('https://www.linkedin.com/in/someone'), null);
    assert.equal(normalizeCompanyUrl('https://example.com/company/acme'), null);
    assert.equal(normalizeCompanyUrl(''), null);
    assert.equal(isLinkedInCompanyUrl('https://www.linkedin.com/company/acme'), true);
    assert.equal(isLinkedInCompanyUrl('https://www.linkedin.com/jobs/view/1'), false);
});

test('company names produce the slug spellings LinkedIn actually uses', () => {
    assert.deepEqual(companySlugCandidates('Coca Cola'), ['coca-cola', 'cocacola']);
    assert.deepEqual(companySlugCandidates('Microsoft'), ['microsoft']);

    const withSuffix = companySlugCandidates('Acme Inc.');
    assert.ok(withSuffix.includes('acme-inc'));
    assert.ok(withSuffix.includes('acme'));

    const ampersand = companySlugCandidates('Johnson & Johnson');
    assert.ok(ampersand.includes('johnson-and-johnson'));
});

test('slug candidates are bounded and empty names yield nothing', () => {
    assert.ok(companySlugCandidates('A B C D E F').length <= 4);
    assert.deepEqual(companySlugCandidates('   '), []);
    assert.deepEqual(candidateUrls('Microsoft'), ['https://www.linkedin.com/company/microsoft']);
});

test('maxResults is clamped to the published schema range', () => {
    assert.equal(clampMaxResults(undefined), 5);
    assert.equal(clampMaxResults(0), 1);
    assert.equal(clampMaxResults(1000), 100);
    assert.equal(clampMaxResults(20), 20);
});

test('authwall and challenge responses are recognised', () => {
    assert.equal(isBlockedUrl('https://www.linkedin.com/authwall?trk=x'), true);
    assert.equal(isBlockedUrl('https://www.linkedin.com/uas/login'), true);
    assert.equal(isBlockedUrl('https://www.linkedin.com/company/microsoft'), false);

    for (const status of [999, 403, 429, 503]) {
        assert.equal(isBlockedStatus(status), true, `${status} should count as blocked`);
    }
    assert.equal(isBlockedStatus(200), false);
    assert.equal(isBlockedStatus(404), false);
});

test('block markers stay narrow enough to avoid discarding real companies', () => {
    // Ordinary public-page sign-in prompts must not be treated as a block.
    assert.equal(looksBlockedText('Sign in to see who you already know'), false);
    assert.equal(looksBlockedText('Microsoft develops software'), false);

    assert.equal(looksBlockedText('Complete this security verification to continue'), true);
    assert.equal(looksBlockedText('Redirected to the authwall'), true);
    assert.equal(looksBlockedText(null), false);
});

test('a guessed slug is only accepted when it matches the requested company', () => {
    assert.equal(nameMatchesCompany('Microsoft', 'Microsoft'), true);
    assert.equal(nameMatchesCompany('Acme Inc', 'Acme'), true);
    assert.equal(nameMatchesCompany('Johnson & Johnson', 'Johnson & Johnson'), true);
    assert.equal(nameMatchesCompany('Coca Cola', 'The Coca-Cola Company'), true);

    // A slug guess that lands on an unrelated company must be rejected before billing.
    assert.equal(nameMatchesCompany('Acme Robotics', 'Globex Corporation'), false);
    assert.equal(nameMatchesCompany('Microsoft', null), false);
});

test('a company is only billable with a name plus real public data', () => {
    const base = {
        companyName: 'Acme',
        companyDescription: null,
        website: null,
        industry: null,
        headquartersLocation: null,
    };

    assert.equal(hasUsableCompanyData(base), false);
    assert.equal(hasUsableCompanyData({ ...base, industry: 'Software' }), true);
    assert.equal(hasUsableCompanyData({ ...base, website: 'https://acme.com' }), true);
    assert.equal(hasUsableCompanyData({ ...base, companyName: null, industry: 'Software' }), false);
});

test('the budget stops the run at the target count', () => {
    const budget = createBudget(2);

    assert.equal(reserveSave(budget, ACME_URL), true);
    assert.equal(canSaveMore(budget), true);

    assert.equal(reserveSave(budget, 'https://www.linkedin.com/company/globex'), true);
    assert.equal(isFinished(budget), true);
    assert.equal(budget.stopReason, 'max-results');
});

test('concurrent workers cannot overshoot the target count', () => {
    const budget = createBudget(2);
    const urls = [1, 2, 3, 4, 5].map((n) => `https://www.linkedin.com/company/c${n}`);

    const granted = urls.filter((url) => reserveSave(budget, url));

    assert.equal(granted.length, 2);
    assert.equal(budget.pushed, 2);
});

test('the same company is never saved or charged twice in one run', () => {
    const budget = createBudget(5);

    assert.equal(reserveSave(budget, ACME_URL, 'Acme Inc'), true);
    // A direct URL and a name lookup that resolve to the same company must not both bill.
    assert.equal(reserveSave(budget, ACME_URL), false);
    assert.equal(isAlreadySaved(budget, ACME_URL), true);
    assert.equal(budget.pushed, 1);
});

test('a failed save returns its reserved slot and its resolved name', () => {
    const budget = createBudget(1);

    assert.equal(reserveSave(budget, ACME_URL, 'Acme Inc'), true);
    assert.equal(canSaveMore(budget), false);

    releaseSave(budget, ACME_URL, 'Acme Inc');
    assert.equal(budget.pushed, 0);
    assert.equal(budget.stopReason, null);
    assert.equal(isNameResolved(budget, 'Acme Inc'), false);
    assert.equal(isAlreadySaved(budget, ACME_URL), false);
});

test('a reached spending limit stops the run immediately', () => {
    const budget = createBudget(50);

    registerCharge(budget, false);
    assert.equal(canSaveMore(budget), true);

    registerCharge(budget, true);
    assert.equal(budget.stopReason, 'charge-limit');
    assert.equal(canSaveMore(budget), false);
    // No further save may be reserved once the spending limit is reached.
    assert.equal(reserveSave(budget, ACME_URL), false);
});

test('a resolved name skips its remaining slug guesses', () => {
    const budget = createBudget(5);

    assert.equal(isNameResolved(budget, 'Coca Cola'), false);
    reserveSave(budget, 'https://www.linkedin.com/company/coca-cola', 'Coca Cola');
    assert.equal(isNameResolved(budget, 'coca cola'), true);
    assert.equal(isNameResolved(budget, 'Pepsi'), false);
    assert.equal(isNameResolved(budget, undefined), false);
});
