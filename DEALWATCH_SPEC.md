# RTX 5090 Dealwatch — build brief for Codex

**Owner's request (2026-11-01):** Create and maintain a functioning laptop deal tracking website for the U.S., Canada, and UK, deployable to Netlify (or similarly straightforward host), with **three automated scans every day** and an auditable log of results. User has receiving/PO-box options in Canada and the UK. Do not store or expose addresses.

## Hard product requirements
- The listing **must contain a GeForce RTX 5090 Laptop GPU**. Explicitly distinguish from RTX 5080, RTX 5070 Ti, and desktop RTX 5090. Independently corroborate the exact configuration / model number where feasible.
- CPU: Intel Core Ultra 9 290HX or 290HX Plus **or a demonstrably newer/faster mobile processor**. Log a benchmark/comparison source and assessment for any substitute; do not assume every newer SKU is faster.
- RAM: **32GB installed minimum**, unless manufacturer/service documentation verifies a lower-RAM model can be upgraded by the purchaser to at least 32GB. Log upgrade method and reasonable RAM-kit cost; calculate total all-in hardware cost with upgrade.
- Conditions accepted: new, open-box, refurbished, with warranty/returns and condition displayed.
- Any laptop brand and any merchant can be considered **only with fraud/risk screening** and clear seller-of-record identification, including third-party marketplace sellers if independently vetted.

## Pricing requirements
- Aim for about **US$2,500**, hard budget preference **under US$3,000** equivalent, before taxes but separately show estimated applicable taxes/shipping/duties when determinable.
- Prioritize **at least 39% off**, but verify markdown against reputable historical real selling prices rather than inflated compare-at/MSRP. Mark a claimed 39%+ promotion 'unverified' until independently supported; separately track near-misses.
- Preserve listing currency (USD/CAD/GBP), currency-rate provenance, conversion timestamp, and a clearly labeled USD estimate. Never mix currencies.
- User **prefers PayPal** and needs shipping/collection feasibility for U.S., Canada, and UK. Check PO box restrictions/forwarder policies, cross-border warranty, marketplace return terms where possible; use unknown rather than inventing compatibility.

## Fraud/risk and product audit
Each potential merchant should have a structured risk assessment: official domain vs impersonation, legal business identity, seller-of-record, independent reputation/reviews, payment protections (especially PayPal), returns/warranty, policy plausibility and suspicious pricing patterns. Provide links and check timestamps. Never advertise any merchant as certified fraud-free; describe evidence and residual uncertainty.
Each result must track: shop, seller, country, exact model/SKU, spec proof, CPU/GPU/RAM eligibility with cited URLs, upgrade cost if any, listed price and currency, observed stock status and time, historic comparison price/evidence, claimed and validated discount, condition, shipping/PO-box info, PayPal status, risk category and reasons, last checked, and direct merchant URL.
**No fake stock, price, links, reviews, historical discounts, scan histories, or proof of fraud screening.** If uncertain, label unverified and keep it off the confirmed-deals view.

## Site UX
- Attractive, mobile-friendly dashboard. Region switcher: US/Canada/UK; filters for 5090 verified, CPUs, RAM upgradeability, discount >=39%, <=$3,000 USD equivalent, condition, PayPal, merchant risk.
- Top deals and near misses, verified vs pending vs rejected statuses, individual evidence/audit pages, price-history chart, last checked time, explanation of price math.
- Daily scan history with 3 run slots (8am, 2pm, 8pm America/Phoenix), counts: candidate URLs discovered, unique SKUs, actually checked, eligible verified, rejected and failed/blocked scans; distinct scan-run IDs and errors, not zero-filling pretending checks occurred.
- Database with dedupe by country + merchant + seller + SKU/config, retention of snapshots, downloadable CSV/JSON.
- Alerts for newly qualified, <= budget offers (PayPal preferred) and changed stock / meaningful price drops, without spamming repeated same results.
- A scan source-management page and transparent notes on unsupported sites.
- A basic publicly viewable site is sufficient; no private P.O. box address or account tokens should be published.

## Implementation guidance for Codex
- Bootstrap a small tested application in this repo, preferably deployable on **Netlify**. Frontend can be React/Vite or equivalent; use a durable external datastore such as Supabase/Postgres rather than Netlify ephemeral file storage.
- Implement a scheduled backend scanner **independent** of the already configured ChatGPT automation; that automation cannot automatically modify the site database.
- Three daily scans for America/Phoenix: 08:00, 14:00, 20:00 MST (which is UTC-7 year-round; UTC clock hours 15, 21, 03). Use provider-supported cron/scheduling and document UTC conversion. Mark a scan as performed only if actually executed.
- Prefer legitimate retailer/product APIs, feeds or otherwise permitted sources; respect site terms, robots, and request budgets. Do not falsely claim full internet coverage or live availability if source access is limited. Provide diagnostics and a manual verified-listing submit option.
- Configure data schema/migrations, server-side secrets, auth for admin actions, validation and regression tests for GPU exact match/CPU/RAM/discount/currency/seller-risk gates. Include a documented local demo with clearly labeled sample data and a production mode with zero fabricated live rows.
- Add README with step-by-step deploy instructions, environment variables, how to attach database, and a concise merchant-source integration checklist. Never commit secrets.
- Report meaningful implementation progress via commits or PR, avoid claiming a live deployed site until there is a tested URL.

## Existing parallel monitoring
A ChatGPT scheduled automation was created and set to scan **three times per day**. It reports in ChatGPT, **not** into this repo or web database. A website's scheduled scanner must be independently built and deployed.

## Acceptance criteria
1. Working site with filters, deal verification fields, audit trails and dated scan histories.
2. The scanner can run 3x/day and persists observations, dedupes, and records errors.
3. Real listings shown as confirmed only after evidence-backed stock/spec/seller screening; seed/demo data kept clearly separate.
4. PayPal, shipping/PO boxes and currency/discount verification visible.
5. Deployment walkthrough to Netlify and test evidence. If fully deploying requires account access, leave a ready-to-deploy app and tell the owner what must be connected.
