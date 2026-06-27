# Grant Source Registry

This registry is the working source list for Grant Keeper. It separates:

- sources that can be ingested today with the current CSV/JSON pipeline
- sources that should be added next as HTML crawl targets

## Tier 1: ingest now

| Rank | Source | Type | Why it matters | Current mode | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | California Grants Portal CSV | CSV | Canonical statewide opportunity feed with the broadest coverage | Active | Primary live feed from `grants.ca.gov` / CA Open Data |
| 2 | California Grants Portal Awards JSON/API | JSON | Same statewide registry, useful as the second ingest path and for feed parity checks | Active | CA Open Data API-backed dataset |

## Tier 2: add as structured HTML scrape targets

| Rank | Source | Type | Why it matters | Suggested scrape mode | Notes |
| --- | --- | --- | --- | --- | --- |
| 3 | California Governor's Office of Emergency Services grants | HTML | High-volume emergency, homeland security, victim services, and local public safety funding | Category crawl + announcement scrape | [Search for Grants](https://www.caloes.ca.gov/office-of-the-director/policy-administration/finance-administration/grants-management/search-for-grants/) |
| 4 | CalRecycle funding | HTML | Strong climate, recycling, solid waste, and local government funding pipeline | Program listing crawl | [Funding](https://calrecycle.ca.gov/funding/) |
| 5 | California Energy Commission funding opportunities | HTML | Clean energy and transportation grant pipeline with recurring solicitations | Solicitation crawler | [Funding Opportunities](https://www.energy.ca.gov/funding-opportunities) |
| 6 | CalEPA loans and grants | HTML | Environmental justice, enforcement, and cleanup grants | Program page crawler | [Loans and Grants](https://calepa.ca.gov/loansgrants/) |
| 7 | California Department of Housing and Community Development | HTML | Housing, homelessness, community development, and affordable housing funding | Program page crawler | [Grants & Funding](https://www.hcd.ca.gov/grants-and-funding) |
| 8 | HCAI grants | HTML | Health workforce and training grants | Program page crawler | [Grants for Organizations](https://hcai.ca.gov/workforce/financial-assistance/grants/) |
| 9 | California Arts Council grants | HTML | Arts and cultural funding, often with detailed eligibility data | Program page crawler | [Grant Programs](https://arts.ca.gov/grants/grant-programs/) |
| 10 | Office of Traffic Safety grants | HTML | Public safety and transportation safety funding with statewide relevance | Program page crawler | [Grants](https://www.ots.ca.gov/grants/) |
| 11 | CalOSBA funding opportunities | HTML | Small business and nonprofit funding | Program page crawler | [Funding Opportunities](https://calosba.ca.gov/for-small-businesses-and-non-profits/funding-opportunities-for-small-businesses-and-non-profits/) |
| 12 | CPUC equity and access grants | HTML | Utility-adjacent equity funding with targeted local impact | Program page crawler | [Equity and Access Grant Program](https://www.cpuc.ca.gov/about-cpuc/divisions/news-and-public-information-office/business-and-community-outreach/equity-and-access-grant-program) |

## Recommended ingestion order

1. Keep the California Grants Portal CSV as the canonical baseline.
2. Keep the California Grants Portal JSON/API source active as the parity check.
3. Add CalOES next because it has active announcement pages and high-value grants.
4. Add CalRecycle and CEC next because they have clear recurring funding programs.
5. Add CalEPA, HCD, and HCAI after those because they broaden category coverage.
6. Add the remaining agency pages once the HTML crawler path is stable.

## Field strategy

- Use the California Grants Portal feed for canonical opportunity records.
- Use agency pages for enrichment, deadlines, and solicitation metadata.
- Normalize every source into the same `grant_sources` RTDB node and the same `grants` record shape.
- Keep provenance fields populated so the UI can filter by source, category, and feed lineage.

