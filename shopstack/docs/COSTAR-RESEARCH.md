# CoStar Shop Management Software: Competitive Research & ShopStack Positioning

Prepared for: Scott Townsend
Date: October 16, 2026
Subject: costarsoftware.ca (COSTAR Computer Systems, Sherwood Park, Alberta)

> Research note: costarsoftware.ca blocked direct crawling from the research environment, so this brief is built from COSTAR's own indexed pages (product, about, and dealer-network pages), the COSTAR Australia site (costar.com.au, same product family), and third-party listings. COSTAR's claims are its own marketing. Confirm current pricing and feature set with a demo call (sales@costar.ca, 1-800-661-7126) before using any of it in a sales conversation.

---

## 1. Bottom line

COSTAR is an Alberta-built, Windows-era, **tire-first** shop management and tire-distribution system. Its real moat is not the shop software. It is **COSTAR-to-COSTAR (C2C) connectivity**: dealer groups like OK Tire and Point S run COSTAR Distribution in their warehouses, so dealers on COSTAR Pro or Enterprise get live stock, pricing and ordering into their local warehouse.

The opening for ShopStack:
1. **Cloud-native and multi-tenant.** COSTAR's tiers (Pro, Enterprise, Distribution, CDX, Mobile, Weborder) read like separately licensed, on-prem or hosted modules.
2. **Vendor-neutral.** You don't have to belong to a COSTAR banner to get live distributor connectivity. ShopStack connects to many distributors and compares them side by side.
3. **Full back office built in.** COSTAR Pro has no GL or AP; those start at Enterprise. ShopStack ships accounting, payroll and CRM in every paid tier.
4. **AI-native.** COSTAR shows no AI features.

## 2. What COSTAR sells

| Product | Target | Key capabilities (vendor-stated) |
|---|---|---|
| **COSTAR Pro** | Single-location tire & auto shop | Retail POS, shop management, service scheduling, customer follow-up, inventory control, purchasing, accounts receivable |
| **COSTAR Enterprise** | Multi-store, multi-company, franchise, mixed retail and wholesale | Everything in Pro, plus general ledger, accounts payable, inter-entity data distribution, franchise/licence programs, consolidated reporting & benchmarking, fleet servicing, integrated tire fitment guide (search by size, brand, model, rim, manufacturer) |
| **COSTAR Distribution** | Tire wholesalers and warehouses | Everything in Enterprise, plus a mid-level WMS built for tires |
| **COSTAR Weborder** | Distributor's dealer customers | B2B web portal: check stock and pricing, place orders, order status, account review; WYSIWYG maintenance; multiple branded "skins" per large customer |
| **B2B Tire Wholesale website** | Distributors | Branded wholesale e-commerce |
| **COSTAR CDX** | Data exchange | Electronic data interchange between COSTAR systems and partners |
| **COSTAR Mobile** | Field and service | Mobile access |

**Dealer-network footprint (Canada):** OK Tire (every warehouse runs COSTAR Distribution; dealers connect C2C or through Weborder) and Point S Canada dealers (PRO, Enterprise, Distribution, Weborder). Australia: C2C live stock, pricing and availability with distributors (e.g., SSS Wheels & Tyres), plus electronic invoices (ASNs).

**Pricing:** not published. One third-party buyer guide shows a ~US$27.7K figure with no context. Treat it as unverified.

## 3. Weaknesses to exploit

| Gap | Evidence | ShopStack answer |
|---|---|---|
| Tiered back office: GL and AP only in Enterprise | Pro feature list stops at A/R | Double-entry GL, AP, bank rec, GST/HST return and financial statements in every paid plan |
| No payroll | Not listed anywhere | Canadian payroll: CPP/CPP2/EI/federal/provincial, flat-rate tech pay, AB overtime, vacation pay, PD7A remittance, T4 data |
| No real CRM | Only "customer follow-up" | Pipeline (fleet/commercial deals), activities, CASL-aware campaigns, service reminders, tire-swap season targeting |
| Closed-network connectivity | C2C works best inside COSTAR-run banners | Vendor-neutral connector gateway: tire distributors, parts, OEM, data, payments, accounting, comms |
| Dated UX, module licensing | Separate products for Weborder, Mobile, CDX | One responsive cloud app; modules switch on by plan or feature flag |
| No AI | None found | Estimate builder, inspection explainer, demand forecasting, reorder, price coaching, NL reports, bookkeeping categorization, review replies |
| Single-business licensing | Per-site licences | True multi-tenant SaaS with white-label branding per tenant (resellers and banners can brand it) |

**Where COSTAR is strong (respect these):** deep tire domain (fitment, tire WMS), entrenched banner relationships (OK Tire, Point S), franchise and inter-entity consolidation, and Alberta and Canadian support. Don't attack the banners head-on. Win independents first, then offer banners a **white-label tenant group** with consolidated reporting.

## 4. Market & competitor map (Canada)

| Competitor | Segment | Note |
|---|---|---|
| COSTAR | Tire dealers and distributors | Incumbent in OK Tire and Point S |
| Tireweb | Tire e-commerce and wholesale B2B | Live stock and dealer pricing; integrates SAP/NetSuite through flat file, FTP or API |
| TireShop | Cloud tire POS | PartsTech, QuickBooks, Autoflow, Epicor, Openbay |
| Tekmetric, Shopmonkey, AutoLeap, Shop-Ware | Cloud general repair (US-centric) | Strong UX; weak on Canadian tax, payroll, tire storage and bilingual needs |
| Mitchell 1 Manager SE, Protractor | Legacy general repair | Desktop heritage |
| NAPA TRACS | Parts-banner shop software | Banner lock-in |

**Positioning line:** *"Canadian-built cloud shop management with real accounting, payroll and CRM, connected to every distributor you buy from, not just one."*

## 5. Must-connect vendor and distributor list

Connectors in ShopStack carry one of three statuses:
- **Live**: works out of the box (public API).
- **OAuth**: the tenant connects their own account.
- **Partner**: needs a dealer account and a signed API or EDI agreement with that vendor. The adapter is stubbed against the vendor's documented interface and switched on once credentials are issued.

| Category | Connectors |
|---|---|
| Tire distributors (CA) | Dynamic Tire, National Tire Distributors (NTD), Fountain Tire Wholesale, Kal Tire Distribution, Groupe Touchette, OK Tire warehouses (COSTAR Distribution/Weborder), TireConnect (aggregator), Tireweb (aggregator) |
| Tire distributors (US cross-border) | American Tire Distributors (ATD), Tire Hub, US AutoForce |
| Tire manufacturers (dealer B2B) | Michelin, Bridgestone/Firestone, Goodyear, Continental, Pirelli, Yokohama, Toyo, Hankook, Nokian |
| Wheels & accessories | Wheel Pros, Fastco Canada |
| Parts | NAPA Canada (PROLink), Bumper to Bumper / LKQ Canada, Carquest Canada, Worldpac (speedDIAL), Lordco, Vast-Auto, PartsTech (multi-vendor), Nexpart (WHI), OEConnection RepairLink (OEM) |
| Repair data | MOTOR (labour times and specs), Mitchell 1 ProDemand, ALLDATA, Identifix, CARFAX Canada |
| Vehicle data (Live) | NHTSA vPIC VIN decoder (free), Transport Canada Motor Vehicle Safety Recalls API (free), Wheel-Size fitment API |
| Payments & financing | Moneris, Stripe Terminal, Helcim, Square, Clover, Flexiti (consumer financing used widely by Canadian tire shops), Affirm Canada |
| Accounting sync | QuickBooks Online, Xero, Sage 50 (export) |
| Payroll export | Wagepoint, Rise People, ADP Canada, Dayforce |
| Comms & reputation | Twilio SMS, SendGrid/Mailgun, Google Business Profile reviews, Podium, Birdeye |
| Fleet & telematics | Geotab (mileage-triggered service), Samsara, UrFleet (cross-sell into the managed-print client base) |
| Commerce | Shopify (tire e-commerce storefront and stock sync), HubSpot (CRM sync) |

**Biggest go-to-market risk:** distributor API access is a business-development job, not just engineering. Budget 30–90 days per distributor agreement. Start with the two or three distributors your pilot shops buy from most and the two aggregators (TireConnect, PartsTech), which unlock many suppliers at once.

## 6. Recommended SaaS packaging (CAD, per location, per month)

| Plan | Price | Includes |
|---|---|---|
| **Starter** | $149 | Work orders, POS, scheduling, customers and vehicles, inventory, 2 connectors, basic AI (50 actions/mo), 3 users |
| **Pro** | $299 | Everything in Starter, plus accounting (GL, AP, bank rec, GST/HST), CRM pipeline and campaigns, tire storage, unlimited connectors, AI (500 actions/mo), 15 users |
| **Enterprise** | $549 | Everything in Pro, plus payroll, multi-location consolidation, custom roles, API access, white-label, AI unlimited (fair use) |
| **Distribution / Banner** | Quote | Dealer B2B portal, multi-tenant group admin, banner-wide reporting, EDI |

Add-ons: payroll for Pro ($6/employee/mo), SMS bundles, onboarding/data migration ($750–$2,500), COSTAR data-migration service (a strong switching incentive).

Unit economics to validate: Claude API cost per AI action is fractions of a cent to a few cents at Opus-tier pricing ($4/$20 per M tokens). Meter it per tenant (built into the `ai_usage` table) and gate it by plan.

## 7. Alberta & Canadian legal and compliance flags

- **AMVIC (Alberta Motor Vehicle Industry Council):** auto repair businesses in Alberta need an AMVIC licence. Under Alberta's Consumer Protection Act and Automotive Business Regulation, repair estimates must be written, and the final bill can't exceed the estimate beyond the regulated tolerance without the customer's prior authorization. ShopStack enforces a configurable overage threshold and blocks invoicing until re-authorization is logged. **Confirm the current tolerance with AMVIC before launch**; the default setting is conservative (10%, capped at $100).
- **PIPA (Alberta) / PIPEDA (federal):** customer and employee PII (names, phones, VINs tied to people, SINs, bank info). Requirements: consent purpose statements, breach notification (PIPA s.34.1, notify the OIPC when there is a real risk of significant harm), access requests, retention limits. Host in a Canadian region (Supabase `ca-central-1`). Encrypt SINs at rest; the app masks them in the UI.
- **CASL (anti-spam):** marketing SMS and email need express or implied consent with recorded date and source, plus unsubscribe. ShopStack stores `consent_marketing`, `consent_date` and `consent_source` per customer, and campaigns exclude non-consented contacts automatically.
- **CRA payroll:** source deductions follow T4127 (Payroll Deductions Formulas). The 2026 values are pre-loaded (YMPE $74,600; YAMPE $85,000; CPP 5.95%; CPP2 4%; EI 1.63% up to $68,900; federal 14% lowest bracket and BPA $16,452; Alberta 8% bracket to $61,200 and BPA $22,769). **Verify against the January 2026 T4127 before the first live pay run, and update every January and July.** Remittance (PD7A) due dates depend on remitter type.
- **Alberta Employment Standards:** overtime over 8 hours a day or 44 a week at 1.5×. Vacation pay 4% (6% after 5 years). General holiday pay. Built into the payroll engine as configurable rules.
- **Sales tax:** GST/HST registration and filing (GST34). Province-aware rates are built in: AB 5% GST; BC 5% + 7% PST; SK 5% + 6%; MB 5% + 7% RST; QC 5% + 9.975%; ON 13% HST; NS 14% HST; NB/NL/PE 15% HST.
- **Tire recycling fees:** Alberta Recycling Management Authority advance disposal surcharge on new tires (passenger default $4.00/tire, configurable). Other provinces have their own programs (eTracks in Ontario, Tire Stewardship BC, etc.).
- **Interest on overdue accounts:** the Criminal Code criminal interest rate is now **35% APR** (since Jan 1, 2025). Default AR late-charge settings sit well below it (2%/month = 24% APR maximum default, with disclosure on the invoice). Alberta consumer credit disclosure rules apply when you extend credit to consumers.
- **Consumer financing (Flexiti / Affirm):** the lender carries the regulatory burden. The shop needs clear disclosure at the point of sale.
- **Trademark:** "ShopStack" is a working name. Run a CIPO and USPTO search before branding spend. Do not use "COSTAR" in marketing beyond fair comparative statements, and keep claims factual (Competition Act, misleading representations).
- **Bilingual:** Quebec (Charter of the French Language / Bill 96) requires French UI and documents for Quebec tenants. The i18n hooks are in place; a French translation is a pre-Quebec-launch task.
