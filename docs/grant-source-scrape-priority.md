# Grant Source Scrape Priority

This is the recommended implementation order for Grant Keeper source acquisition.

## Priority 1: direct ingest

1. California Grants Portal CSV.
2. California Grants Portal Awards JSON/API.

These sources should stay online continuously and populate the baseline grant catalog.

## Priority 2: structured agency pages

3. CalOES grants search pages and announcement listings.
4. CalRecycle funding pages and program listings.
5. California Energy Commission funding opportunities and solicitation pages.

These are the highest-value HTML sources because they are updated often and usually contain program-level detail, deadlines, and eligibility language.

## Priority 3: expansion coverage

6. CalEPA loans and grants.
7. HCD grants and funding.
8. HCAI grants.
9. California Arts Council grant programs.
10. Office of Traffic Safety grants.
11. CalOSBA funding opportunities.
12. CPUC equity and access grants.

These broaden the grant universe and add more categories for nonprofit and community-focused work.

## Scrape strategy by source type

- `CSV` or `JSON`: poll on a schedule, diff against RTDB, update changed records, preserve provenance.
- `HTML listing pages`: crawl the listing, extract program cards, then follow detail pages for record enrichment.
- `HTML detail pages`: parse deadline, funding, eligibility, geography, and contact metadata into the common grant model.

## Cadence recommendation

- Canonical portal feeds: hourly or multiple times per day.
- Major agency listings: every 6 to 12 hours.
- Secondary program pages: daily.
- Deep detail refresh: on change detection, not on every run.

## Implementation rule

Do not add a source to the active sync loop until it has:

- a stable target URL
- a defined extraction pattern
- a record mapping into the shared grant schema
- a validation sample in RTDB or local test fixtures

