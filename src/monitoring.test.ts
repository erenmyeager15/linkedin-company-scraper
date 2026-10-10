import assert from 'node:assert/strict';
import test from 'node:test';
import {
    compareCompany,
    parseCompanySize,
    parsePublicCount,
    type StoredCompanyState,
    websiteDomain,
} from './monitoring.js';
import type { CompanyRecord } from './types.js';

function company(overrides: Partial<CompanyRecord> = {}): CompanyRecord {
    return {
        companyName: 'Acme',
        linkedinUrl: 'https://www.linkedin.com/company/acme',
        website: 'https://www.acme.example/about',
        companyDescription: 'Public company description',
        industry: 'Software Development',
        companySize: '201-500 employees',
        headquartersLocation: 'Austin, Texas, US',
        companyType: 'Privately Held',
        foundedYear: 2010,
        specialties: ['Automation', 'Analytics'],
        followerCount: '12.5K',
        employeeCount: '250',
        logoUrl: null,
        matchedFromName: null,
        scrapedAt: '2026-10-11T00:00:00.000Z',
        ...overrides,
    };
}

function state(overrides: Partial<StoredCompanyState['snapshot']> = {}): StoredCompanyState {
    return {
        version: 1,
        observationCount: 1,
        lastObservedAt: '2026-10-10T00:00:00.000Z',
        snapshot: {
            companyName: 'Acme',
            website: 'https://www.acme.example/about',
            companyDescription: 'Public company description',
            industry: 'Software Development',
            companySize: '201-500 employees',
            headquartersLocation: 'Austin, Texas, US',
            companyType: 'Privately Held',
            specialties: ['Analytics', 'Automation'],
            followerCount: 10_000,
            employeeCount: 250,
            ...overrides,
        },
        history: [],
    };
}

test('public counts normalize comma and compact suffix formats', () => {
    assert.equal(parsePublicCount('1,234 followers'), 1234);
    assert.equal(parsePublicCount('12.5K'), 12_500);
    assert.equal(parsePublicCount('2.3M followers'), 2_300_000);
    assert.equal(parsePublicCount('not public'), null);
});

test('company size ranges are normalized without inventing an upper bound', () => {
    assert.deepEqual(parseCompanySize('201-500 employees'), { min: 201, max: 500 });
    assert.deepEqual(parseCompanySize('10,001+ employees'), { min: 10_001, max: null });
    assert.deepEqual(parseCompanySize(null), { min: null, max: null });
});

test('website domains are normalized for CRM matching', () => {
    assert.equal(websiteDomain('https://www.acme.example/about'), 'acme.example');
    assert.equal(websiteDomain('acme.example'), 'acme.example');
    assert.equal(websiteDomain('not a domain'), null);
});

test('the first observation is explicitly marked as a baseline', () => {
    const result = compareCompany(company(), null);
    assert.equal(result.observationStatus, 'baseline');
    assert.deepEqual(result.changes, []);
    assert.deepEqual(result.signals, []);
});

test('repeat observations return count deltas and deterministic signals', () => {
    const result = compareCompany(company(), state(), 5, 5);
    assert.equal(result.observationStatus, 'updated');
    assert.deepEqual(result.deltas, { followers: 2500, employees: 0 });
    assert.ok(result.changes?.includes('followerCount'));
    assert.ok(result.signals?.includes('FOLLOWERS_UP_25.0_PCT'));
});

test('unchanged observations do not create false signals', () => {
    const result = compareCompany(company({ followerCount: '10,000' }), state(), 5, 5);
    assert.equal(result.observationStatus, 'unchanged');
    assert.deepEqual(result.changes, []);
    assert.deepEqual(result.signals, []);
});

test('a disappearing public count is partial, not a real decline', () => {
    const result = compareCompany(company({ followerCount: null }), state(), 5, 5);
    assert.equal(result.observationStatus, 'partial');
    assert.equal(result.deltas?.followers, null);
    assert.ok(!result.signals?.some((signal) => signal.startsWith('FOLLOWERS_DOWN')));
});
