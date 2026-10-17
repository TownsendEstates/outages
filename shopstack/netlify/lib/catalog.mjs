// ShopStack connector catalog: the single source of truth for the UI and the gateway.
// status: live    = public API, works with no partner agreement
//         oauth   = tenant connects their own account (OAuth / API key from their portal)
//         partner = requires a dealer account + signed API/EDI agreement; uses the
//                   configurable partner REST adapter once credentials are issued.
// caps: catalog_search, stock, pricing, order, order_status, invoice_import, vin_decode,
//       recalls, fitment, labour_times, repair_info, payments, financing, accounting_sync,
//       payroll_export, sms, email, reviews, telematics, ecommerce, crm_sync
const P = "partner", O = "oauth", L = "live";
const keyFields = [{ k: "account", label: "Dealer / account #" }, { k: "apiKey", label: "API key", secret: true }];
const restFields = [
  { k: "baseUrl", label: "API base URL" },
  { k: "account", label: "Dealer / account #" },
  { k: "apiKey", label: "API key / token", secret: true },
  { k: "authHeader", label: "Auth header name (default Authorization: Bearer)" },
];

export const CATALOG = [
  // Tire distributors (Canada)
  { id: "dynamic_tire", name: "Dynamic Tire Corp", cat: "Tire Distributors (CA)", status: P, caps: ["catalog_search", "stock", "pricing", "order", "order_status"], fields: restFields },
  { id: "ntd_canada", name: "National Tire Distributors", cat: "Tire Distributors (CA)", status: P, caps: ["catalog_search", "stock", "pricing", "order", "order_status"], fields: restFields },
  { id: "fountain_wholesale", name: "Fountain Tire Wholesale", cat: "Tire Distributors (CA)", status: P, caps: ["catalog_search", "stock", "pricing", "order"], fields: restFields },
  { id: "kal_tire_dist", name: "Kal Tire Distribution", cat: "Tire Distributors (CA)", status: P, caps: ["catalog_search", "stock", "pricing", "order"], fields: restFields },
  { id: "touchette", name: "Groupe Touchette", cat: "Tire Distributors (CA)", status: P, caps: ["catalog_search", "stock", "pricing", "order"], fields: restFields },
  { id: "costar_weborder", name: "COSTAR Weborder / C2C (OK Tire, Point S warehouses)", cat: "Tire Distributors (CA)", status: P, caps: ["catalog_search", "stock", "pricing", "order", "order_status", "invoice_import"], fields: restFields },
  { id: "tireconnect", name: "TireConnect (multi-supplier)", cat: "Tire Aggregators", status: O, caps: ["catalog_search", "stock", "pricing", "order", "fitment"], fields: keyFields },
  { id: "tireweb", name: "Tireweb", cat: "Tire Aggregators", status: O, caps: ["catalog_search", "stock", "pricing", "order"], fields: keyFields },
  // US cross-border
  { id: "atd", name: "American Tire Distributors (ATD)", cat: "Tire Distributors (US)", status: P, caps: ["catalog_search", "stock", "pricing", "order", "order_status"], fields: restFields },
  { id: "tirehub", name: "Tire Hub", cat: "Tire Distributors (US)", status: P, caps: ["catalog_search", "stock", "pricing", "order"], fields: restFields },
  { id: "usautoforce", name: "US AutoForce", cat: "Tire Distributors (US)", status: P, caps: ["catalog_search", "stock", "pricing", "order"], fields: restFields },
  // Manufacturers
  ...[
    ["michelin", "Michelin (BIB dealer)"], ["bridgestone", "Bridgestone / Firestone"], ["goodyear", "Goodyear"],
    ["continental", "Continental"], ["pirelli", "Pirelli"], ["yokohama", "Yokohama"], ["toyo", "Toyo"],
    ["hankook", "Hankook"], ["nokian", "Nokian Tyres"],
  ].map(([id, name]) => ({ id, name, cat: "Tire Manufacturers", status: P, caps: ["catalog_search", "stock", "pricing", "order"], fields: restFields })),
  // Wheels
  { id: "wheelpros", name: "Wheel Pros", cat: "Wheels & Accessories", status: O, caps: ["catalog_search", "stock", "pricing", "order", "fitment"], fields: keyFields },
  { id: "fastco", name: "Fastco Canada", cat: "Wheels & Accessories", status: P, caps: ["catalog_search", "stock", "pricing", "order"], fields: restFields },
  // Parts
  { id: "napa_ca", name: "NAPA Canada (PROLink)", cat: "Parts", status: P, caps: ["catalog_search", "stock", "pricing", "order", "invoice_import"], fields: restFields },
  { id: "bumper_lkq", name: "Bumper to Bumper / LKQ Canada", cat: "Parts", status: P, caps: ["catalog_search", "stock", "pricing", "order"], fields: restFields },
  { id: "carquest_ca", name: "Carquest Canada", cat: "Parts", status: P, caps: ["catalog_search", "stock", "pricing", "order"], fields: restFields },
  { id: "worldpac", name: "Worldpac speedDIAL", cat: "Parts", status: P, caps: ["catalog_search", "stock", "pricing", "order"], fields: restFields },
  { id: "lordco", name: "Lordco Auto Parts", cat: "Parts", status: P, caps: ["catalog_search", "stock", "pricing", "order"], fields: restFields },
  { id: "vast_auto", name: "Vast-Auto Distribution", cat: "Parts", status: P, caps: ["catalog_search", "stock", "pricing", "order"], fields: restFields },
  { id: "partstech", name: "PartsTech (multi-vendor)", cat: "Parts", status: O, caps: ["catalog_search", "stock", "pricing", "order"], fields: keyFields },
  { id: "nexpart", name: "Nexpart (WHI)", cat: "Parts", status: O, caps: ["catalog_search", "stock", "pricing", "order"], fields: keyFields },
  { id: "repairlink", name: "OEConnection RepairLink (OEM)", cat: "Parts", status: P, caps: ["catalog_search", "pricing", "order"], fields: restFields },
  // Repair data
  { id: "motor", name: "MOTOR Information Systems", cat: "Repair Data", status: P, caps: ["labour_times", "repair_info"], fields: keyFields },
  { id: "prodemand", name: "Mitchell 1 ProDemand", cat: "Repair Data", status: P, caps: ["labour_times", "repair_info"], fields: keyFields },
  { id: "alldata", name: "ALLDATA", cat: "Repair Data", status: P, caps: ["labour_times", "repair_info"], fields: keyFields },
  { id: "identifix", name: "Identifix", cat: "Repair Data", status: P, caps: ["repair_info"], fields: keyFields },
  { id: "carfax_ca", name: "CARFAX Canada", cat: "Repair Data", status: P, caps: ["repair_info"], fields: keyFields },
  // Vehicle data (live)
  { id: "nhtsa_vpic", name: "NHTSA vPIC VIN Decoder", cat: "Vehicle Data", status: L, caps: ["vin_decode"], fields: [] },
  { id: "tc_recalls", name: "Transport Canada Recalls", cat: "Vehicle Data", status: L, caps: ["recalls"], fields: [{ k: "apiKey", label: "TC API key (if required)", secret: true }] },
  { id: "wheelsize", name: "Wheel-Size Fitment API", cat: "Vehicle Data", status: O, caps: ["fitment"], fields: [{ k: "apiKey", label: "API key", secret: true }] },
  // Payments
  { id: "moneris", name: "Moneris", cat: "Payments & Financing", status: O, caps: ["payments"], fields: [{ k: "storeId", label: "Store ID" }, { k: "apiKey", label: "API token", secret: true }] },
  { id: "stripe", name: "Stripe (Terminal + online)", cat: "Payments & Financing", status: O, caps: ["payments"], fields: [{ k: "apiKey", label: "Secret key", secret: true }] },
  { id: "helcim", name: "Helcim", cat: "Payments & Financing", status: O, caps: ["payments"], fields: [{ k: "apiKey", label: "API token", secret: true }] },
  { id: "square", name: "Square", cat: "Payments & Financing", status: O, caps: ["payments"], fields: [{ k: "apiKey", label: "Access token", secret: true }] },
  { id: "clover", name: "Clover", cat: "Payments & Financing", status: O, caps: ["payments"], fields: [{ k: "apiKey", label: "API token", secret: true }] },
  { id: "flexiti", name: "Flexiti Financing", cat: "Payments & Financing", status: P, caps: ["financing"], fields: keyFields },
  { id: "affirm_ca", name: "Affirm Canada", cat: "Payments & Financing", status: O, caps: ["financing"], fields: keyFields },
  // Accounting / payroll
  { id: "qbo", name: "QuickBooks Online", cat: "Accounting & Payroll", status: O, caps: ["accounting_sync"], fields: [] },
  { id: "xero", name: "Xero", cat: "Accounting & Payroll", status: O, caps: ["accounting_sync"], fields: [] },
  { id: "sage50", name: "Sage 50 (export)", cat: "Accounting & Payroll", status: L, caps: ["accounting_sync"], fields: [] },
  { id: "wagepoint", name: "Wagepoint", cat: "Accounting & Payroll", status: O, caps: ["payroll_export"], fields: keyFields },
  { id: "rise", name: "Rise People", cat: "Accounting & Payroll", status: O, caps: ["payroll_export"], fields: keyFields },
  { id: "adp_ca", name: "ADP Canada", cat: "Accounting & Payroll", status: P, caps: ["payroll_export"], fields: keyFields },
  { id: "dayforce", name: "Dayforce", cat: "Accounting & Payroll", status: P, caps: ["payroll_export"], fields: keyFields },
  // Comms
  { id: "twilio", name: "Twilio SMS", cat: "Communications & Reviews", status: O, caps: ["sms"], fields: [{ k: "sid", label: "Account SID" }, { k: "apiKey", label: "Auth token", secret: true }, { k: "from", label: "From number" }] },
  { id: "sendgrid", name: "SendGrid", cat: "Communications & Reviews", status: O, caps: ["email"], fields: [{ k: "apiKey", label: "API key", secret: true }, { k: "from", label: "From email" }] },
  { id: "mailgun", name: "Mailgun", cat: "Communications & Reviews", status: O, caps: ["email"], fields: [{ k: "domain", label: "Domain" }, { k: "apiKey", label: "API key", secret: true }] },
  { id: "gbp", name: "Google Business Profile", cat: "Communications & Reviews", status: O, caps: ["reviews"], fields: [] },
  { id: "podium", name: "Podium", cat: "Communications & Reviews", status: O, caps: ["sms", "reviews"], fields: keyFields },
  { id: "birdeye", name: "Birdeye", cat: "Communications & Reviews", status: O, caps: ["reviews"], fields: keyFields },
  // Fleet / commerce / CRM
  { id: "geotab", name: "Geotab", cat: "Fleet & Commerce", status: O, caps: ["telematics"], fields: [{ k: "server", label: "Server" }, { k: "database", label: "Database" }, { k: "user", label: "User" }, { k: "apiKey", label: "Password", secret: true }] },
  { id: "samsara", name: "Samsara", cat: "Fleet & Commerce", status: O, caps: ["telematics"], fields: [{ k: "apiKey", label: "API token", secret: true }] },
  { id: "urfleet", name: "UrFleet", cat: "Fleet & Commerce", status: P, caps: ["telematics", "crm_sync"], fields: keyFields },
  { id: "shopify", name: "Shopify", cat: "Fleet & Commerce", status: O, caps: ["ecommerce"], fields: [{ k: "shop", label: "Shop domain" }, { k: "apiKey", label: "Admin API token", secret: true }] },
  { id: "hubspot", name: "HubSpot", cat: "Fleet & Commerce", status: O, caps: ["crm_sync"], fields: [{ k: "apiKey", label: "Private app token", secret: true }] },
  // Generic
  { id: "custom_rest", name: "Custom distributor (REST / JSON)", cat: "Custom", status: P, caps: ["catalog_search", "stock", "pricing", "order"], fields: [...restFields, { k: "searchPath", label: "Search path, e.g. /products?size={size}&q={q}" }, { k: "orderPath", label: "Order path, e.g. /orders" }, { k: "map", label: 'Field map JSON {"sku":"partNumber","cost":"dealerPrice","qty":"available"}' }] },
  { id: "edi_850", name: "EDI X12 850/810 (SFTP)", cat: "Custom", status: P, caps: ["order", "invoice_import"], fields: [{ k: "host", label: "SFTP host" }, { k: "user", label: "User" }, { k: "apiKey", label: "Password / key", secret: true }] },
];

export const byId = Object.fromEntries(CATALOG.map((c) => [c.id, c]));
