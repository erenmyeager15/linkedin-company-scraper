import { load } from 'cheerio';
import { BLOCK_TEXT_MARKERS } from './lib.js';

export interface ExtractedCompany {
    name: string | null;
    description: string | null;
    logo: string | null;
    website: string | null;
    industry: string | null;
    size: string | null;
    hq: string | null;
    type: string | null;
    founded: string | null;
    specialties: string | null;
    followers: string | null;
    employees: string | null;
    blocked: boolean;
}

function organizationFromJsonLd(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object') return null;
    const data = value as Record<string, unknown>;
    const graph = Array.isArray(data['@graph']) ? data['@graph'] : [data];

    for (const candidate of graph) {
        if (!candidate || typeof candidate !== 'object') continue;
        const item = candidate as Record<string, unknown>;
        const types = Array.isArray(item['@type']) ? item['@type'].join(' ') : String(item['@type'] ?? '');
        if (/Organization/i.test(types)) return item;
    }
    return null;
}

function stringValue(value: unknown): string | null {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
    return null;
}

export function extractCompanyHtml(html: string): ExtractedCompany {
    const $ = load(html);
    const result: ExtractedCompany = {
        name: null,
        description: null,
        logo: null,
        website: null,
        industry: null,
        size: null,
        hq: null,
        type: null,
        founded: null,
        specialties: null,
        followers: null,
        employees: null,
        blocked: false,
    };

    $('script[type="application/ld+json"]').each((_index, element) => {
        if (result.name) return;
        try {
            const organization = organizationFromJsonLd(JSON.parse($(element).text()));
            if (!organization) return;

            result.name = stringValue(organization.name);
            result.description = stringValue(organization.description);

            const logo = organization.logo;
            result.logo = stringValue(logo)
                ?? (logo && typeof logo === 'object' ? stringValue((logo as Record<string, unknown>).url) : null);

            const sameAs = Array.isArray(organization.sameAs) ? organization.sameAs[0] : organization.sameAs;
            const canonicalUrl = stringValue(organization.url);
            result.website = canonicalUrl && !/linkedin\.com/i.test(canonicalUrl)
                ? canonicalUrl
                : stringValue(sameAs);

            const address = organization.address;
            if (address && typeof address === 'object') {
                const fields = address as Record<string, unknown>;
                result.hq = [fields.addressLocality, fields.addressRegion, fields.addressCountry]
                    .map(stringValue)
                    .filter(Boolean)
                    .join(', ') || null;
            }

            const employees = organization.numberOfEmployees;
            result.employees = employees && typeof employees === 'object'
                ? stringValue((employees as Record<string, unknown>).value)
                : stringValue(employees);
            result.founded = stringValue(organization.foundingDate);
        } catch {
            // Ignore malformed JSON-LD and continue with metadata and definition lists.
        }
    });

    const meta = (property: string): string | null => stringValue($(`meta[property="${property}"]`).attr('content'));
    result.name ??= meta('og:title');
    result.description ??= meta('og:description');
    result.logo ??= meta('og:image');

    $('dl dt').each((_index, term) => {
        const label = $(term).text().trim().toLowerCase();
        const definition = $(term).next('dd');
        const value = definition.text().trim();
        if (!label || !value) return;

        if (label.includes('website')) result.website ??= value;
        else if (label.includes('industry')) result.industry = value;
        else if (label.includes('size')) result.size = value;
        else if (label.includes('headquarters')) result.hq ??= value;
        else if (label.includes('founded')) result.founded = value;
        else if (label.includes('type')) result.type = value;
        else if (label.includes('specialties')) result.specialties = value;
    });

    const bodyText = $('body').text().replace(/\s+/g, ' ').trim();
    result.followers = bodyText.match(/([\d,.]+[KMB]?)\s+followers/i)?.[1] ?? null;
    const lowerBody = bodyText.toLowerCase();
    result.blocked = BLOCK_TEXT_MARKERS.some((marker) => lowerBody.includes(marker));

    return result;
}
