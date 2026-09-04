import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import multer from "multer";
import { v4 as uuidv4 } from "uuid";
import { ddbDocClient } from "./libs/awsClient.js";
import { 
  ScanCommand, 
  PutCommand, 
  GetCommand, 
  BatchGetCommand,
  TransactWriteCommand,
  UpdateCommand, 
  DeleteCommand 
} from "@aws-sdk/lib-dynamodb";
import { adminAuth } from "./middleware/adminAuth.js";
import { userAuth } from "./middleware/userAuth.js";
import { uploadFileToS3 } from "./libs/s3Service.js";
import { DEFAULT_PRODUCT_CATEGORY, PRODUCT_TAXONOMY, getProductCategory } from "./config/productTaxonomy.js";
import { sendOrderNotification } from "./libs/emailService.js";
import { sendOrderStatusWhatsApp } from "./libs/whatsappService.js";
import { sendOrderStatusPush } from "./libs/pushNotificationService.js";
import { registerPwaRoutes } from "./routes/pwaRoutes.js";
import { createHash, randomBytes, timingSafeEqual } from "crypto";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.set("trust proxy", 1);
app.use(cors());
app.use(express.json());
registerPwaRoutes(app);

// Multer setup for image uploads (memory storage)
const upload = multer({ storage: multer.memoryStorage() });

// --- DELIVERY & GEOLOCATION HELPERS ---
const STORE_COORDS = { lat: 28.3839, lng: 76.7695 }; // Kamlesh Suits, PIN 122504

// Precise PIN code → coordinate mapping (expanded coverage)
const PIN_COORDS = {
  // ── STORE AREA ──────────────────────────────────────────
  "122504": { lat: 28.3839, lng: 76.7695 },
  "122506": { lat: 28.3600, lng: 76.7900 },

  // ── GURGAON / GURUGRAM ──────────────────────────────────
  "122001": { lat: 28.4595, lng: 77.0266 },
  "122002": { lat: 28.4717, lng: 77.0718 },
  "122003": { lat: 28.4450, lng: 77.0450 },
  "122004": { lat: 28.4950, lng: 77.0800 },
  "122006": { lat: 28.4800, lng: 77.0950 },
  "122007": { lat: 28.4150, lng: 77.0600 },
  "122008": { lat: 28.5050, lng: 77.0750 },
  "122009": { lat: 28.4300, lng: 76.9800 },
  "122010": { lat: 28.4600, lng: 76.9900 },
  "122011": { lat: 28.5200, lng: 77.0700 },
  "122015": { lat: 28.4750, lng: 77.0250 },
  "122016": { lat: 28.4500, lng: 77.0500 },
  "122017": { lat: 28.4282, lng: 77.0423 },
  "122018": { lat: 28.4089, lng: 76.9926 },
  "122051": { lat: 28.4200, lng: 77.0550 },
  "122052": { lat: 28.4350, lng: 77.0900 },
  "122101": { lat: 28.3950, lng: 76.8900 },
  "122102": { lat: 28.4050, lng: 76.9050 },
  "122103": { lat: 28.4100, lng: 76.9200 },
  "122104": { lat: 28.4200, lng: 76.9300 },
  "122105": { lat: 28.3800, lng: 76.8700 },
  "122107": { lat: 28.3700, lng: 76.8500 },
  "122108": { lat: 28.3600, lng: 76.8300 },
  "122413": { lat: 28.3300, lng: 76.8100 },
  "122414": { lat: 28.3100, lng: 76.8000 },
  "122505": { lat: 28.4111, lng: 76.8401 },
  "122508": { lat: 28.4000, lng: 76.8200 },

  // ── DELHI ────────────────────────────────────────────────
  "110001": { lat: 28.6369, lng: 77.2167 },
  "110002": { lat: 28.6430, lng: 77.2280 },
  "110003": { lat: 28.6220, lng: 77.2050 },
  "110004": { lat: 28.6560, lng: 77.2250 },
  "110005": { lat: 28.6690, lng: 77.1900 },
  "110006": { lat: 28.6500, lng: 77.2050 },
  "110007": { lat: 28.6740, lng: 77.2100 },
  "110008": { lat: 28.6600, lng: 77.1730 },
  "110009": { lat: 28.6800, lng: 77.2300 },
  "110010": { lat: 28.5684, lng: 77.1232 },
  "110011": { lat: 28.6200, lng: 77.2280 },
  "110012": { lat: 28.6080, lng: 77.1850 },
  "110013": { lat: 28.5900, lng: 77.2150 },
  "110014": { lat: 28.5700, lng: 77.2350 },
  "110015": { lat: 28.6700, lng: 77.1500 },
  "110016": { lat: 28.5450, lng: 77.2050 },
  "110017": { lat: 28.5350, lng: 77.2150 },
  "110018": { lat: 28.6300, lng: 77.1150 },
  "110019": { lat: 28.5400, lng: 77.2850 },
  "110020": { lat: 28.5392, lng: 77.2655 },
  "110021": { lat: 28.5700, lng: 77.1650 },
  "110022": { lat: 28.5950, lng: 77.1850 },
  "110023": { lat: 28.6050, lng: 77.2050 },
  "110024": { lat: 28.5550, lng: 77.2650 },
  "110025": { lat: 28.5400, lng: 77.2500 },
  "110026": { lat: 28.6900, lng: 77.1400 },
  "110027": { lat: 28.6750, lng: 77.1600 },
  "110028": { lat: 28.5950, lng: 77.1650 },
  "110029": { lat: 28.5550, lng: 77.2100 },
  "110030": { lat: 28.5250, lng: 77.1900 },
  "110031": { lat: 28.6850, lng: 77.2700 },
  "110032": { lat: 28.6600, lng: 77.2800 },
  "110033": { lat: 28.7050, lng: 77.1450 },
  "110034": { lat: 28.7100, lng: 77.1650 },
  "110035": { lat: 28.7050, lng: 77.1850 },
  "110036": { lat: 28.7200, lng: 77.1350 },
  "110037": { lat: 28.6100, lng: 77.1350 },
  "110038": { lat: 28.5950, lng: 77.1200 },
  "110039": { lat: 28.5800, lng: 77.1200 },
  "110040": { lat: 28.6750, lng: 77.1000 },
  "110041": { lat: 28.7100, lng: 77.2000 },
  "110042": { lat: 28.7250, lng: 77.1750 },
  "110043": { lat: 28.6000, lng: 77.0750 },
  "110044": { lat: 28.5400, lng: 77.3200 },
  "110045": { lat: 28.5900, lng: 77.0700 },
  "110046": { lat: 28.5600, lng: 77.0900 },
  "110047": { lat: 28.5700, lng: 77.0800 },
  "110048": { lat: 28.5500, lng: 77.2800 },
  "110049": { lat: 28.5350, lng: 77.2600 },
  "110051": { lat: 28.6400, lng: 77.3050 },
  "110052": { lat: 28.7000, lng: 77.2200 },
  "110053": { lat: 28.6500, lng: 77.2650 },
  "110054": { lat: 28.6700, lng: 77.2050 },
  "110055": { lat: 28.6600, lng: 77.2150 },
  "110056": { lat: 28.6650, lng: 77.1150 },
  "110057": { lat: 28.5200, lng: 77.1800 },
  "110058": { lat: 28.6200, lng: 77.1050 },
  "110059": { lat: 28.6000, lng: 77.0900 },
  "110060": { lat: 28.6400, lng: 77.1800 },
  "110061": { lat: 28.5650, lng: 77.3100 },
  "110062": { lat: 28.5300, lng: 77.2400 },
  "110063": { lat: 28.5850, lng: 77.1050 },
  "110064": { lat: 28.6150, lng: 77.1600 },
  "110065": { lat: 28.5800, lng: 77.2900 },
  "110066": { lat: 28.5750, lng: 77.1500 },
  "110067": { lat: 28.5850, lng: 77.1650 },
  "110068": { lat: 28.5450, lng: 77.2200 },
  "110069": { lat: 28.5550, lng: 77.2350 },
  "110070": { lat: 28.5284, lng: 77.1512 },
  "110071": { lat: 28.5150, lng: 77.1700 },
  "110072": { lat: 28.5000, lng: 77.1300 },
  "110073": { lat: 28.5100, lng: 77.1500 },
  "110074": { lat: 28.5050, lng: 77.0950 },
  "110075": { lat: 28.5786, lng: 77.0436 },
  "110076": { lat: 28.5550, lng: 77.3300 },
  "110077": { lat: 28.5450, lng: 77.0750 },
  "110078": { lat: 28.5300, lng: 77.0600 },
  "110080": { lat: 28.6550, lng: 77.3300 },
  "110081": { lat: 28.6850, lng: 77.2000 },
  "110082": { lat: 28.7000, lng: 77.1200 },
  "110083": { lat: 28.6950, lng: 77.1050 },
  "110084": { lat: 28.7100, lng: 77.0800 },
  "110085": { lat: 28.7150, lng: 77.1000 },
  "110086": { lat: 28.7250, lng: 77.1150 },
  "110087": { lat: 28.7050, lng: 77.0950 },
  "110088": { lat: 28.6450, lng: 77.0800 },
  "110089": { lat: 28.6500, lng: 77.0950 },
  "110090": { lat: 28.6750, lng: 77.3150 },
  "110091": { lat: 28.6700, lng: 77.3350 },
  "110092": { lat: 28.6600, lng: 77.3150 },
  "110093": { lat: 28.6500, lng: 77.3250 },
  "110094": { lat: 28.6350, lng: 77.3200 },
  "110095": { lat: 28.6450, lng: 77.3400 },
  "110096": { lat: 28.7300, lng: 77.2700 },

  // ── REWARI ──────────────────────────────────────────────
  "123001": { lat: 28.1970, lng: 76.6170 },
  "123015": { lat: 28.2050, lng: 76.6050 },
  "123021": { lat: 28.1800, lng: 76.5800 },
  "123023": { lat: 28.1600, lng: 76.5550 },
  "123024": { lat: 28.1450, lng: 76.5350 },
  "123025": { lat: 28.2200, lng: 76.6400 },
  "123029": { lat: 28.2400, lng: 76.6600 },
  "123035": { lat: 28.2600, lng: 76.6800 },
  "123101": { lat: 28.2700, lng: 76.7000 },
  "123102": { lat: 28.2300, lng: 76.7100 },
  "123103": { lat: 28.2100, lng: 76.7300 },
  "123106": { lat: 28.2415, lng: 76.7322 },
  "123110": { lat: 28.2500, lng: 76.7500 },
  "123301": { lat: 28.1300, lng: 76.6500 },
  "123302": { lat: 28.1100, lng: 76.6300 },
  "123303": { lat: 28.0900, lng: 76.6100 },
  "123401": { lat: 28.1833, lng: 76.6167 },
  "123411": { lat: 28.1500, lng: 76.6000 },
  "123412": { lat: 28.1650, lng: 76.6250 },
  "123501": { lat: 28.0815, lng: 76.5822 },

  // ── JHAJJAR ─────────────────────────────────────────────
  "124001": { lat: 28.6070, lng: 76.6570 },
  "124002": { lat: 28.5900, lng: 76.6400 },
  "124021": { lat: 28.5750, lng: 76.6200 },
  "124022": { lat: 28.5600, lng: 76.6050 },
  "124101": { lat: 28.5150, lng: 76.5750 },
  "124102": { lat: 28.5312, lng: 76.6211 },
  "124103": { lat: 28.6067, lng: 76.6567 },
  "124104": { lat: 28.4800, lng: 76.5500 },
  "124105": { lat: 28.4600, lng: 76.5300 },
  "124106": { lat: 28.4400, lng: 76.5100 },
  "124107": { lat: 28.4200, lng: 76.4900 },
  "124108": { lat: 28.6300, lng: 76.6800 },
  "124109": { lat: 28.6500, lng: 76.7000 },
  "124110": { lat: 28.6700, lng: 76.7200 },
  "124111": { lat: 28.6900, lng: 76.7400 },
  "124112": { lat: 28.5500, lng: 76.5900 },
  "124113": { lat: 28.5300, lng: 76.5700 },
  "124201": { lat: 28.7100, lng: 76.7600 },
  "124202": { lat: 28.7300, lng: 76.7800 },
  "124303": { lat: 28.4100, lng: 76.7400 },
  "124304": { lat: 28.3900, lng: 76.7200 },
  "124401": { lat: 28.4600, lng: 76.7800 },
  "124404": { lat: 28.4400, lng: 76.7600 },
  "124406": { lat: 28.4800, lng: 76.8000 },
  "124501": { lat: 28.5050, lng: 76.8200 },
  "124505": { lat: 28.5250, lng: 76.8400 },
  "124507": { lat: 28.5450, lng: 76.8600 },
};

// Region centroid fallback – any pincode starting with these prefixes is deliverable
const REGION_CENTROIDS = {
  "110": { lat: 28.6139, lng: 77.2090 }, // Delhi (city centre)
  "122": { lat: 28.4089, lng: 76.9926 }, // Gurgaon / Gurugram
  "123": { lat: 28.1970, lng: 76.6170 }, // Rewari district
  "124": { lat: 28.6070, lng: 76.6570 }, // Jhajjar district
};

const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const calcFeeFromDistance = (distance) => {
  const fee = 30 + Math.floor(distance / 7) * 30;
  return Math.round(Math.min(Math.max(fee, 30), 280));
};

const getDeliveryDetails = (pincode) => {
  // 1. Exact match – most accurate distance
  const exactCoords = PIN_COORDS[pincode];
  if (exactCoords) {
    const distance = calculateDistance(
      STORE_COORDS.lat, STORE_COORDS.lng,
      exactCoords.lat, exactCoords.lng
    );
    return {
      isAllowed: true,
      distance: parseFloat(distance.toFixed(2)),
      deliveryFee: calcFeeFromDistance(distance),
    };
  }

  // 2. Region-prefix fallback – estimate from district centroid
  const prefix = String(pincode).substring(0, 3);
  const regionCoords = REGION_CENTROIDS[prefix];
  if (regionCoords) {
    const distance = calculateDistance(
      STORE_COORDS.lat, STORE_COORDS.lng,
      regionCoords.lat, regionCoords.lng
    );
    return {
      isAllowed: true,
      distance: parseFloat(distance.toFixed(2)),
      deliveryFee: calcFeeFromDistance(distance),
      estimatedFee: true, // flag that this is an estimate
    };
  }

  return { isAllowed: false };
};

// --- HELPERS ---
const validateProduct = (data) => {
  const errors = [];
  const productCategory = String(data.product_category || DEFAULT_PRODUCT_CATEGORY).trim();
  const categoryDefinition = getProductCategory(productCategory);
  const variants = Array.isArray(data.variants)
    ? data.variants.slice(0, 6).map((variant, index) => ({
        id: String(variant?.id || `variant-${index + 1}`).trim(),
        colorName: String(variant?.colorName || '').trim(),
        colorHex: /^#[0-9a-f]{6}$/i.test(String(variant?.colorHex || '')) ? String(variant.colorHex).toUpperCase() : '#808080',
        images: Array.isArray(variant?.images)
          ? variant.images.slice(0, 6).map(image => String(image || '').trim()).filter(Boolean)
          : [],
        stock: Math.max(0, parseInt(variant?.stock) || 0)
      })).filter(variant => variant.images.length > 0)
    : [];
  const rawHeroFeature = data.hero_feature && typeof data.hero_feature === 'object' ? data.hero_feature : {};
  const heroFeature = {
    enabled: Boolean(rawHeroFeature.enabled),
    heroImageId: String(rawHeroFeature.heroImageId || '').trim(),
    image: String(rawHeroFeature.image || '').trim(),
    line_one: String(rawHeroFeature.line_one || 'Featured piece').trim().slice(0, 60),
    line_two: String(rawHeroFeature.line_two || '').trim().slice(0, 100),
    line_one_color: /^#[0-9a-f]{6}$/i.test(String(rawHeroFeature.line_one_color || '')) ? String(rawHeroFeature.line_one_color).toUpperCase() : '#FDE68A',
    line_two_color: /^#[0-9a-f]{6}$/i.test(String(rawHeroFeature.line_two_color || '')) ? String(rawHeroFeature.line_two_color).toUpperCase() : '#FFFFFF',
  };
  
  const sanitized = {
    title: String(data.title || "Untitled Asset").trim(),
    description: String(data.description || "").trim(),
    price: parseFloat(data.price) || 0,
    discount: parseInt(data.discount) || 0,
    mrp: parseFloat(data.mrp) || parseFloat(data.price) || 0,
    stock: parseInt(data.stock) || 0,
    type: String(data.type || "product"),
    product_category: productCategory,
    product_subcategory: String(data.product_subcategory || "").trim(),
    image: String(data.image || ""),
    images: Array.isArray(data.images) ? data.images : [],
    colors: Array.isArray(data.colors) ? data.colors : [],
    variants,
    hero_feature: heroFeature,
    featured_on_home: Boolean(data.featured_on_home),
    hero_image_id: String(data.hero_image_id || '').trim(),
    categories: Array.isArray(data.categories) ? data.categories : [],
    fabric_family: String(data.fabric_family || "").trim(),
    fabric_category: String(data.fabric_category || "").trim(),
    session: String(data.session || "").trim(),
    rating: parseFloat(data.rating) || 4.1,
    reviews: parseInt(data.reviews) || 26,
  };

  if (!sanitized.title) errors.push("Title is required");
  if (sanitized.price < 0) errors.push("Price cannot be negative");
  if (!categoryDefinition) errors.push("Select a valid product category");
  if (
    categoryDefinition &&
    sanitized.product_subcategory &&
    !categoryDefinition.subcategories.includes(sanitized.product_subcategory)
  ) {
    errors.push("Select a valid product subcategory");
  }
  if (categoryDefinition?.requiresFabric && (!sanitized.fabric_family || !sanitized.fabric_category)) {
    errors.push("Fabric family and fabric type are required for suits");
  }
  if (Array.isArray(data.variants) && variants.some(variant => !variant.colorName)) {
    errors.push("Every product variant must have a colour name");
  }
  
  return { sanitized, errors };
};

// --- PUBLIC ROUTES ---

// Public, versionable product taxonomy used by admin forms and storefront filters.
app.get("/api/product-taxonomy", (req, res) => {
  res.json({ version: 1, defaultCategory: DEFAULT_PRODUCT_CATEGORY, categories: PRODUCT_TAXONOMY });
});

const escapeHtml = value => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

// Social networks generally do not execute the storefront's React code. This
// lightweight HTML response exposes product metadata in the initial response,
// then sends real shoppers to the canonical product page in their browser.
app.get("/api/share/product/:id", async (req, res) => {
  const productId = String(req.params.id || "");
  const canonicalUrl = `https://kamleshsuits.com/product/${encodeURIComponent(productId)}`;

  try {
    const data = await ddbDocClient.send(new GetCommand({
      TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
      Key: { suitId: productId },
    }));

    if (!data.Item) return res.redirect(302, canonicalUrl);

    const product = data.Item;
    const title = product.title || "Kamlesh Suits Collection";
    const rawDescription = product.description || `Shop ${title} at Kamlesh Suits. Premium Indian ethnic wear delivered across India.`;
    const description = String(rawDescription).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 240);
    const rawImage = product.image || product.images?.[0] || product.variants?.find(variant => variant.images?.[0])?.images?.[0] || "/icons/pwa-512.png";
    const image = String(rawImage).startsWith("http")
      ? String(rawImage)
      : `https://kamleshsuits.com${String(rawImage).startsWith("/") ? "" : "/"}${rawImage}`;
    const price = Number(product.price || 0);
    const stock = Array.isArray(product.variants) && product.variants.length
      ? product.variants.reduce((sum, variant) => sum + Number(variant.stock || 0), 0)
      : Number(product.stock);
    const isOutOfStock = Number.isFinite(stock) && stock <= 0;
    const availability = isOutOfStock ? "out of stock" : "in stock";
    const schema = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      name: title,
      image: [image],
      description,
      sku: product.suitId,
      brand: { "@type": "Brand", name: "Kamlesh Suits" },
      offers: {
        "@type": "Offer",
        url: canonicalUrl,
        priceCurrency: "INR",
        price,
        availability: isOutOfStock ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
        itemCondition: "https://schema.org/NewCondition",
      },
    }).replaceAll("<", "\\u003c");
    const redirectTarget = JSON.stringify(canonicalUrl).replaceAll("<", "\\u003c");

    res
      .set("Cache-Control", "public, max-age=0, s-maxage=300, stale-while-revalidate=86400")
      .type("html")
      .send(`<!doctype html>
<html lang="en-IN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} | Kamlesh Suits</title>
  <meta name="description" content="${escapeHtml(description)}">
  <meta name="robots" content="index, follow, max-image-preview:large">
  <link rel="canonical" href="${escapeHtml(canonicalUrl)}">
  <link rel="me" href="https://www.instagram.com/kamleshsuits/">
  <meta property="og:locale" content="en_IN">
  <meta property="og:type" content="product">
  <meta property="og:site_name" content="Kamlesh Suits">
  <meta property="og:title" content="${escapeHtml(title)} | Kamlesh Suits">
  <meta property="og:description" content="${escapeHtml(description)}">
  <meta property="og:url" content="${escapeHtml(canonicalUrl)}">
  <meta property="og:image" content="${escapeHtml(image)}">
  <meta property="og:image:secure_url" content="${escapeHtml(image)}">
  <meta property="og:image:alt" content="${escapeHtml(title)} by Kamlesh Suits">
  <meta property="product:price:amount" content="${escapeHtml(price)}">
  <meta property="product:price:currency" content="INR">
  <meta property="product:availability" content="${availability}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${escapeHtml(title)} | Kamlesh Suits">
  <meta name="twitter:description" content="${escapeHtml(description)}">
  <meta name="twitter:image" content="${escapeHtml(image)}">
  <meta name="twitter:image:alt" content="${escapeHtml(title)} by Kamlesh Suits">
  <script type="application/ld+json">${schema}</script>
  <script>window.location.replace(${redirectTarget});</script>
</head>
<body><p>Opening <a href="${escapeHtml(canonicalUrl)}">${escapeHtml(title)} at Kamlesh Suits</a>…</p></body>
</html>`);
  } catch (error) {
    console.error("Product share metadata error:", error);
    res.redirect(302, canonicalUrl);
  }
});

// Get all products
app.get("/api/products", async (req, res) => {
  const params = {
    TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
    FilterExpression: "#type = :suit OR #type = :product",
    ExpressionAttributeNames: { "#type": "type" },
    ExpressionAttributeValues: { ":suit": "suit", ":product": "product" }
  };

  try {
    const data = await ddbDocClient.send(new ScanCommand(params));
    res.json(data.Items);
  } catch (err) {
    console.error("DynamoDB Scan Error:", err);
    res.status(500).json({ message: "Error fetching products" });
  }
});

// Get product by ID
app.get("/api/products/:id", async (req, res) => {
  const params = {
    TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
    Key: { suitId: req.params.id },
  };

  try {
    const data = await ddbDocClient.send(new GetCommand(params));
    if (!data.Item) return res.status(404).json({ message: "Product not found" });
    res.json(data.Item);
  } catch (err) {
    res.status(500).json({ message: "Error fetching product" });
  }
});

// --- ADMIN PROTECTED ROUTES ---

// Create Product
app.post("/api/admin/products", adminAuth, async (req, res) => {
  const { sanitized, errors } = validateProduct(req.body);
  
  if (errors.length > 0) {
    return res.status(400).json({ message: "Validation failed", errors });
  }

  const product = {
    ...sanitized,
    suitId: uuidv4(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const params = {
    TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
    Item: product,
  };

  console.log("Saving product to DynamoDB:", JSON.stringify(product, null, 2));
  try {
    await ddbDocClient.send(new PutCommand(params));
    res.status(201).json(product);
  } catch (err) {
    console.error("DynamoDB Put Error:", err);
    console.error("Attempted Product:", JSON.stringify(product, null, 2));
    res.status(500).json({ 
      message: "Error creating product", 
      error: err.message,
      code: err.code || err.name,
      stack: err.stack
    });
  }
});

// Update Product
app.put("/api/admin/products/:id", adminAuth, async (req, res) => {
  const { id } = req.params;
  
  // For updates, we validate the incoming partial data
  const { sanitized } = validateProduct(req.body);
  
  // Only include fields that were actually sent in the request AND are valid product fields
  const updates = {};
  const validFields = [
    'title', 'description', 'price', 'discount', 'mrp', 'stock', 
    'type', 'product_category', 'product_subcategory', 'image', 'images', 'colors', 'variants', 'hero_feature', 'featured_on_home', 'hero_image_id', 'categories',
    'fabric_family', 'fabric_category', 'session', 'rating', 'reviews'
  ];

  validFields.forEach(key => {
    if (req.body.hasOwnProperty(key)) {
      updates[key] = sanitized[key];
    }
  });

  updates.updated_at = new Date().toISOString();

  const keys = Object.keys(updates).filter(k => k !== 'suitId' && k !== 'id');
  
  if (keys.length === 0) {
    return res.json({ message: "No updates provided" });
  }

  const UpdateExpression = "SET " + keys.map((k, i) => `#field${i} = :val${i}`).join(", ");
  const ExpressionAttributeNames = keys.reduce((acc, k, i) => ({ ...acc, [`#field${i}`]: k }), {});
  const ExpressionAttributeValues = keys.reduce((acc, k, i) => ({ ...acc, [`:val${i}`]: updates[k] }), {});

  const params = {
    TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
    Key: { suitId: id },
    UpdateExpression,
    ExpressionAttributeNames,
    ExpressionAttributeValues,
    ReturnValues: "ALL_NEW",
  };

  try {
    const data = await ddbDocClient.send(new UpdateCommand(params));
    res.json(data.Attributes);
  } catch (err) {
    console.error("DynamoDB Update Error:", err);
    console.error("Update params:", JSON.stringify(params, null, 2));
    res.status(500).json({ 
      message: "Error updating product", 
      error: err.message,
      code: err.code || err.name
    });
  }
});

// Delete Product
app.delete("/api/admin/products/:id", adminAuth, async (req, res) => {
  const params = {
    TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
    Key: { suitId: req.params.id },
  };

  try {
    await ddbDocClient.send(new DeleteCommand(params));
    res.json({ message: "Product deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Error deleting product" });
  }
});

// --- USER PROFILE ROUTES ---

// Get User Profile (Cart, Wishlist, etc.)
app.get("/api/user/profile", userAuth, async (req, res) => {
  const params = {
    TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
    Key: { suitId: `USER#${req.user.sub}` },
  };

  try {
    const data = await ddbDocClient.send(new GetCommand(params));
    if (!data.Item) {
      return res.json({ cartItems: [], wishlistItems: [], user_id: req.user.sub });
    }
    res.json(data.Item);
  } catch (err) {
    console.error("Profile Fetch Error:", err);
    res.status(500).json({ message: "Error fetching user profile" });
  }
});

// Save/Update User Profile
app.post("/api/user/profile", userAuth, async (req, res) => {
  const { cartItems, wishlistItems } = req.body;
  
  const profile = {
    suitId: `USER#${req.user.sub}`,
    type: "user_profile",
    user_id: req.user.sub,
    email: req.user.email,
    name: req.user.name,
    cartItems: Array.isArray(cartItems) ? cartItems : [],
    wishlistItems: Array.isArray(wishlistItems) ? wishlistItems : [],
    addresses: Array.isArray(req.body.addresses) ? req.body.addresses : [],
    updated_at: new Date().toISOString(),
  };

  const params = {
    TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
    Item: profile,
  };

  try {
    await ddbDocClient.send(new PutCommand(params));
    res.json(profile);
  } catch (err) {
    console.error("Profile Save Error:", err);
    res.status(500).json({ message: "Error saving user profile" });
  }
});

// --- ORDER ROUTES ---

const createOrderRecord = async ({ items, address, subtotal, total, paymentMethod, installationId = '', user = null }) => {
  const orderId = `#ORD-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
  const trackingToken = randomBytes(24).toString("hex");
  const trackingTokenHash = createHash("sha256").update(trackingToken).digest("hex");
  const now = new Date().toISOString();
  const order = {
    suitId: `ORDER#${orderId}`,
    type: "order",
    orderId,
    user_id: user?.sub || `GUEST#${address.phone}`,
    user_email: user?.email || null,
    user_name: address.name,
    user_phone: address.phone,
    guest_order: !user,
    installation_id: String(installationId || '').slice(0, 80),
    items,
    address,
    subtotal: Number(subtotal),
    total: Number(total),
    paymentMethod: paymentMethod || "cod",
    paymentStatus: "Unpaid",
    status: "Awaiting Confirmation",
    whatsappOptIn: address.whatsappOptIn === true,
    confirmationMethod: address.whatsappOptIn === true ? "Store phone call and WhatsApp" : "Store phone call",
    trackingTokenHash,
    created_at: now,
    updated_at: now,
  };

  await ddbDocClient.send(new TransactWriteCommand({
    TransactItems: [
      {
        Put: {
          TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
          Item: order,
        },
      },
      {
        Update: {
          TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
          Key: { suitId: `PHONE_ORDERS#${address.phone}` },
          UpdateExpression: "SET #type = if_not_exists(#type, :type), user_phone = if_not_exists(user_phone, :phone), order_refs = list_append(if_not_exists(order_refs, :empty), :newRef)",
          ExpressionAttributeNames: { "#type": "type" },
          ExpressionAttributeValues: {
            ":type": "phone_order_index",
            ":phone": address.phone,
            ":empty": [],
            ":newRef": [{ orderId, created_at: now }],
          },
        },
      },
    ],
  }));

  return { order, trackingToken };
};

const toPublicTrackingOrder = (order) => ({
  orderId: order.orderId,
  status: order.status,
  paymentStatus: order.paymentStatus,
  paymentMethod: order.paymentMethod,
  paid_at: order.paid_at || null,
  payment_updated_at: order.payment_updated_at || null,
  total: order.total,
  created_at: order.created_at,
  updated_at: order.updated_at,
  confirmed_at: order.confirmed_at || null,
  customerName: order.user_name,
  phoneMasked: order.user_phone ? `******${String(order.user_phone).slice(-4)}` : null,
  delivery: {
    area: order.address?.area || '',
    city: order.address?.city || '',
    state: order.address?.state || '',
    pincode: order.address?.pincode || ''
  },
  items: (order.items || []).map(item => ({
    suitId: item.suitId,
    title: item.title,
    image: item.image,
    quantity: item.quantity,
    price: item.price,
    selectedColor: item.selectedColor || null
  }))
});

const trackingAttempts = new Map();
const allowTrackingAttempt = (ip) => {
  const now = Date.now();
  const recent = (trackingAttempts.get(ip) || []).filter(time => now - time < 15 * 60 * 1000);
  if (recent.length >= 100) return false;
  recent.push(now);
  trackingAttempts.set(ip, recent);
  return true;
};

const validateOrderRequest = ({ items, address, total }) => {
  if (!Array.isArray(items) || items.length === 0 || items.length > 20) return "Your cart is empty or too large";
  if (!address || !address.name || !/^\d{10}$/.test(String(address.phone || ""))) return "A valid name and 10-digit mobile number are required";
  if (!/^\d{6}$/.test(String(address.pincode || "")) || !address.houseNo || !address.area || !address.city || !address.state) return "Delivery address is incomplete";
  if (!Number.isFinite(Number(total)) || Number(total) <= 0) return "Order total is invalid";
  return null;
};

// Guest checkout: the store calls the customer before confirming fulfilment.
app.post("/api/orders", async (req, res) => {
  const { items, address, subtotal, total, paymentMethod, installationId } = req.body;
  const validationError = validateOrderRequest({ items, address, total });
  if (validationError) return res.status(400).json({ message: validationError });

  try {
    const { order, trackingToken } = await createOrderRecord({ items, address, subtotal, total, paymentMethod, installationId });
    const pushNotification = await sendOrderStatusPush(order);
    res.status(201).json({
      message: "Order request received. The store will call the customer to confirm it.",
      orderId: order.orderId,
      status: order.status,
      trackingToken,
      pushNotification,
    });
  } catch (err) {
    console.error("Guest Order Placement Error:", err);
    res.status(500).json({ message: "Could not save your order request. Please try again." });
  }
});

// Place New Order
app.post("/api/user/orders", userAuth, async (req, res) => {
  const { items, address, subtotal, total, paymentMethod, installationId } = req.body;
  const validationError = validateOrderRequest({ items, address, total });
  if (validationError) return res.status(400).json({ message: validationError });

  try {
    const { order, trackingToken } = await createOrderRecord({ items, address, subtotal, total, paymentMethod, installationId, user: req.user });
    const pushNotification = await sendOrderStatusPush(order);
    
    // 2. Send Email Notifications (Fire and forget or wait depending on reliability needs)
    // We wait here to ensure we can tell the user if something went wrong with the core flow
    const emailResult = await sendOrderNotification({
      user: { email: req.user.email, sub: req.user.sub },
      address,
      items,
      subtotal,
      total,
      paymentMethod,
      orderId: order.orderId
    });

    if (!emailResult.success) {
      console.warn("Order saved but emails failed to send:", emailResult.error);
    }

    res.status(201).json({ 
      message: "Order placed successfully", 
      orderId: order.orderId,
      status: order.status,
      trackingToken,
      emailSent: emailResult.success,
      pushNotification,
    });
  } catch (err) {
    console.error("Order Placement Error:", err);
    res.status(500).json({ message: "Error placing order", error: err.message });
  }
});

// Track a guest order using its private device token, or recover it with order ID + phone.
app.post("/api/orders/track", async (req, res) => {
  if (!allowTrackingAttempt(req.ip || req.socket.remoteAddress || "unknown")) {
    return res.status(429).json({ message: "Too many tracking attempts. Please try again later." });
  }

  const orderId = String(req.body.orderId || "").trim().toUpperCase();
  const phone = String(req.body.phone || "").replace(/\D/g, "").slice(-10);
  const trackingToken = String(req.body.trackingToken || "");
  if (!/^#ORD-\d{13}-\d{4}$/.test(orderId)) {
    return res.status(404).json({ message: "Order not found. Check the order ID and phone number." });
  }

  try {
    const result = await ddbDocClient.send(new GetCommand({
      TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
      Key: { suitId: `ORDER#${orderId}` }
    }));
    const order = result.Item;
    if (!order || order.type !== "order") {
      return res.status(404).json({ message: "Order not found. Check the order ID and phone number." });
    }

    let tokenMatches = false;
    if (trackingToken && order.trackingTokenHash) {
      const suppliedHash = createHash("sha256").update(trackingToken).digest("hex");
      const expected = Buffer.from(order.trackingTokenHash, "hex");
      const supplied = Buffer.from(suppliedHash, "hex");
      tokenMatches = expected.length === supplied.length && timingSafeEqual(expected, supplied);
    }
    const phoneMatches = /^\d{10}$/.test(phone) && phone === String(order.user_phone || "").replace(/\D/g, "").slice(-10);

    if (!tokenMatches && !phoneMatches) {
      return res.status(404).json({ message: "Order not found. Check the order ID and phone number." });
    }

    res.json(toPublicTrackingOrder(order));
  } catch (err) {
    console.error("Guest Order Tracking Error:", err);
    res.status(500).json({ message: "Could not load this order right now. Please try again." });
  }
});

// Find lightweight order references by delivery mobile number. Full order data
// is fetched only after the customer selects a matching order.
app.post("/api/orders/lookup-by-phone", async (req, res) => {
  if (!allowTrackingAttempt(req.ip || req.socket.remoteAddress || "unknown")) {
    return res.status(429).json({ message: "Too many tracking attempts. Please try again later." });
  }

  const phone = String(req.body.phone || "").replace(/\D/g, "").slice(-10);
  if (!/^\d{10}$/.test(phone)) {
    return res.status(400).json({ message: "Enter a valid 10-digit mobile number." });
  }

  try {
    const tableName = process.env.AWS_DYNAMODB_TABLE_NAME;
    const index = await ddbDocClient.send(new GetCommand({
      TableName: tableName,
      Key: { suitId: `PHONE_ORDERS#${phone}` },
      ProjectionExpression: "order_refs",
    }));

    let items = [];
    const refs = (index.Item?.order_refs || []).slice(-25);
    if (refs.length) {
      const currentOrders = await ddbDocClient.send(new BatchGetCommand({
        RequestItems: {
          [tableName]: {
            Keys: refs.map(ref => ({ suitId: `ORDER#${ref.orderId}` })),
            ProjectionExpression: "orderId, created_at, updated_at, #status, paymentStatus, total",
            ExpressionAttributeNames: { "#status": "status" },
          },
        },
      }));
      items = currentOrders.Responses?.[tableName] || [];
    } else {
      // Compatibility path for orders created before the phone index existed.
      const legacy = await ddbDocClient.send(new ScanCommand({
        TableName: tableName,
        FilterExpression: "#type = :orderType AND user_phone = :phone",
        ExpressionAttributeValues: { ":orderType": "order", ":phone": phone },
        ProjectionExpression: "orderId, created_at, updated_at, #status, paymentStatus, total",
        ExpressionAttributeNames: { "#type": "type", "#status": "status" },
      }));
      items = legacy.Items || [];
    }

    const matches = items
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 25);
    res.json(matches);
  } catch (err) {
    console.error("Phone Order Lookup Error:", err);
    res.status(500).json({ message: "Could not find orders right now. Please try again." });
  }
});

// Get User Orders
app.get("/api/user/orders", userAuth, async (req, res) => {
  const params = {
    TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
    FilterExpression: "#type = :otype AND user_id = :uid",
    ExpressionAttributeNames: { "#type": "type" },
    ExpressionAttributeValues: { 
      ":otype": "order",
      ":uid": req.user.sub
    }
  };

  try {
    const data = await ddbDocClient.send(new ScanCommand(params));
    res.json(data.Items.sort((a,b) => new Date(b.created_at) - new Date(a.created_at)));
  } catch (err) {
    console.error("Fetch Orders Error:", err);
    res.status(500).json({ message: "Error fetching orders" });
  }
});

// --- DELIVERY DEMAND ROUTES ---

// Submit delivery request for unsupported areas
app.post("/api/delivery/demand", async (req, res) => {
  const { name, phone, address, pincode, city } = req.body;
  
  if (!name || !phone || !pincode) {
    return res.status(400).json({ message: "Name, phone and pincode are required" });
  }

  const demandId = `DEMAND#${Date.now()}#${pincode}`;
  const demand = {
    suitId: demandId,
    type: "delivery_demand",
    name,
    phone,
    address,
    pincode,
    city,
    status: "New",
    admin_notes: "",
    created_at: new Date().toISOString()
  };

  const params = {
    TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
    Item: demand
  };

  try {
    await ddbDocClient.send(new PutCommand(params));
    res.status(201).json({ message: "Request received. We will notify you when we expand!" });
  } catch (err) {
    console.error("Delivery Demand Save Error:", err);
    res.status(500).json({ message: "Error saving request" });
  }
});

// Get all delivery demands (Admin only)
app.get("/api/admin/delivery/demands", adminAuth, async (req, res) => {
  const params = {
    TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
    FilterExpression: "#type = :dtype",
    ExpressionAttributeNames: { "#type": "type" },
    ExpressionAttributeValues: { ":dtype": "delivery_demand" }
  };

  try {
    const data = await ddbDocClient.send(new ScanCommand(params));
    res.json(data.Items.sort((a,b) => new Date(b.created_at) - new Date(a.created_at)));
  } catch (err) {
    console.error("Fetch Demands Error:", err);
    res.status(500).json({ message: "Error fetching delivery demands" });
  }
});

// Route to validate a pincode and get delivery fee
app.get("/api/delivery/validate/:pincode", async (req, res) => {
  const { pincode } = req.params;
  const details = getDeliveryDetails(pincode);
  res.json(details);
});

// --- COUPON ROUTES ---

// Get all coupons (Admin only)
app.get("/api/admin/coupons", adminAuth, async (req, res) => {
  const params = {
    TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
    FilterExpression: "#type = :coupon",
    ExpressionAttributeNames: { "#type": "type" },
    ExpressionAttributeValues: { ":coupon": "coupon" }
  };

  try {
    const data = await ddbDocClient.send(new ScanCommand(params));
    res.json(data.Items);
  } catch (err) {
    res.status(500).json({ message: "Error fetching coupons" });
  }
});

// Create/Update Coupon (Admin only)
app.post("/api/admin/coupons", adminAuth, async (req, res) => {
  const { code, discount, type, min_purchase, usage_limit, expires_at, description, category_ids = [] } = req.body;
  
  if (!code || !discount) {
    return res.status(400).json({ message: "Code and discount are required" });
  }
  const discountValue = Number(discount);
  if (!Number.isFinite(discountValue) || discountValue <= 0 || (type === "percent" && discountValue > 100)) {
    return res.status(400).json({ message: "Enter a valid coupon discount" });
  }
  const validCategoryIds = new Set(PRODUCT_TAXONOMY.map(category => category.id));
  const safeCategoryIds = Array.isArray(category_ids)
    ? [...new Set(category_ids.filter(categoryId => validCategoryIds.has(categoryId)))]
    : [];

  const couponKey = `COUPON#${code.toUpperCase()}`;
  let existingCoupon;
  try {
    const existing = await ddbDocClient.send(new GetCommand({
      TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
      Key: { suitId: couponKey },
    }));
    existingCoupon = existing.Item;
  } catch (err) {
    console.error("Coupon lookup before save failed:", err);
  }

  const coupon = {
    suitId: couponKey,
    type: "coupon",
    code: code.toUpperCase(),
    discount: discountValue,
    discount_type: type || "flat", // "flat" or "percent"
    min_purchase: parseFloat(min_purchase) || 0,
    usage_limit: parseInt(usage_limit) || null,
    used_count: existingCoupon?.used_count || 0,
    category_ids: safeCategoryIds,
    expires_at: expires_at || null,
    description: description || "",
    created_at: existingCoupon?.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const params = {
    TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
    Item: coupon,
  };

  try {
    await ddbDocClient.send(new PutCommand(params));
    res.status(201).json(coupon);
  } catch (err) {
    res.status(500).json({ message: "Error saving coupon" });
  }
});

// Delete Coupon (Admin only)
app.delete("/api/admin/coupons/:code", adminAuth, async (req, res) => {
  const params = {
    TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
    Key: { suitId: `COUPON#${req.params.code.toUpperCase()}` },
  };

  try {
    await ddbDocClient.send(new DeleteCommand(params));
    res.json({ message: "Coupon deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: "Error deleting coupon" });
  }
});

// Validate Coupon (Public/User)
app.post("/api/coupons/validate", async (req, res) => {
  const { code, subtotal, items = [] } = req.body;
  
  if (!code) return res.status(400).json({ message: "Coupon code is required" });

  const params = {
    TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
    Key: { suitId: `COUPON#${code.toUpperCase()}` },
  };

  try {
    const data = await ddbDocClient.send(new GetCommand(params));
    const coupon = data.Item;

    if (!coupon || coupon.type !== "coupon") {
      return res.status(404).json({ message: "Invalid coupon code" });
    }

    // Check expiration
    if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
      return res.status(400).json({ message: "Coupon has expired" });
    }

    const targetedCategories = Array.isArray(coupon.category_ids) ? coupon.category_ids : [];
    let eligibleSubtotal = Number(subtotal || 0);
    if (targetedCategories.length > 0) {
      const requestedItems = Array.isArray(items) ? items.filter(item => item?.suitId) : [];
      const verifiedProducts = await Promise.all(requestedItems.map(async item => {
        const productResult = await ddbDocClient.send(new GetCommand({
          TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
          Key: { suitId: item.suitId },
        }));
        return { item, product: productResult.Item };
      }));
      eligibleSubtotal = verifiedProducts.reduce((sum, { item, product }) => {
        if (!product || !targetedCategories.includes(product.product_category || DEFAULT_PRODUCT_CATEGORY)) return sum;
        return sum + (Number(product.price || 0) * Math.max(1, Number(item.quantity || 1)));
      }, 0);
    }

    if (targetedCategories.length > 0 && eligibleSubtotal <= 0) {
      return res.status(400).json({ message: "This coupon does not apply to products in your cart" });
    }

    // Minimum purchase applies only to products in the selected categories.
    if (eligibleSubtotal < coupon.min_purchase) {
      return res.status(400).json({ 
        message: `Min purchase of ₹${coupon.min_purchase} required on eligible products`
      });
    }

    // Check usage limit
    if (coupon.usage_limit && coupon.used_count >= coupon.usage_limit) {
      return res.status(400).json({ message: "Coupon usage limit reached" });
    }

    res.json({ ...coupon, eligible_subtotal: eligibleSubtotal });
  } catch (err) {
    res.status(500).json({ message: "Error validating coupon" });
  }
});

// Get public coupons (Public)
app.get("/api/coupons", async (req, res) => {
  const params = {
    TableName: process.env.AWS_DYNAMODB_TABLE_NAME
  };

  console.log(`[SERVICE_COUPONS] Scanning table: ${params.TableName}`);

  try {
    const data = await ddbDocClient.send(new ScanCommand(params));
    const items = data.Items || [];
    
    // Find active coupons using multiple detection strategies
    const now = new Date();
    const activeCoupons = items.filter(c => {
      // 1. Detection: Must be type 'coupon' OR have COUPON# prefix
      const isCoupon = c.type === 'coupon' || (c.suitId && String(c.suitId).startsWith('COUPON#'));
      if (!isCoupon) return false;

      // 2. Expiry check: Keep if no expiry, or if expiry is in the future
      if (!c.expires_at) return true;
      try {
        const expiryDate = new Date(c.expires_at);
        return isNaN(expiryDate.getTime()) || expiryDate > now;
      } catch (e) {
        return true; // Keep if date parsing is ambiguous
      }
    });

    console.log(`[SERVICE_COUPONS] Found ${items.length} total items. Identified ${activeCoupons.length} active coupons.`);
    res.json(activeCoupons);
  } catch (err) {
    console.error("[SERVICE_COUPONS] Scan Error:", err);
    res.status(500).json({ message: "Error fetching coupons", error: err.message });
  }
});

// --- HOME BANNER ROUTES ---

// The product-photo carousel is intentionally stored separately from campaign
// banners. It has one portrait image and two short, independently coloured
// caption lines per item.
app.get("/api/hero-images", async (req, res) => {
  try {
    const data = await ddbDocClient.send(new ScanCommand({
      TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
      FilterExpression: "#type = :heroImage",
      ExpressionAttributeNames: { "#type": "type" },
      ExpressionAttributeValues: { ":heroImage": "home_hero_image" },
    }));
    const heroImages = (data.Items || [])
      .filter(item => item.active !== false)
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
    const linkedProductIds = [...new Set(heroImages.map(item => item.product_id).filter(Boolean))].slice(0, 100);
    let availableProductIds = new Set();

    if (linkedProductIds.length) {
      const products = await ddbDocClient.send(new BatchGetCommand({
        RequestItems: {
          [process.env.AWS_DYNAMODB_TABLE_NAME]: {
            Keys: linkedProductIds.map(suitId => ({ suitId })),
            ProjectionExpression: 'suitId, #type',
            ExpressionAttributeNames: { '#type': 'type' },
          },
        },
      }));
      availableProductIds = new Set((products.Responses?.[process.env.AWS_DYNAMODB_TABLE_NAME] || [])
        .filter(product => ['product', 'suit'].includes(product.type))
        .map(product => product.suitId));
    }

    res.json(heroImages.map(item => ({
      ...item,
      product_path: item.product_id && availableProductIds.has(item.product_id) ? `/product/${item.product_id}` : '',
    })));
  } catch (err) {
    console.error("Public Hero Image Fetch Error:", err);
    res.status(500).json({ message: "Error fetching home hero images" });
  }
});

app.get("/api/admin/hero-images", adminAuth, async (req, res) => {
  try {
    const data = await ddbDocClient.send(new ScanCommand({
      TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
      FilterExpression: "#type = :heroImage",
      ExpressionAttributeNames: { "#type": "type" },
      ExpressionAttributeValues: { ":heroImage": "home_hero_image" },
    }));
    res.json((data.Items || []).sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)));
  } catch (err) {
    console.error("Admin Hero Image Fetch Error:", err);
    res.status(500).json({ message: "Error fetching hero images" });
  }
});

app.post("/api/admin/hero-images", adminAuth, async (req, res) => {
  const {
    heroImageId, image, line_one = "Featured piece", line_two = "",
    line_one_color = "#FDE68A", line_two_color = "#FFFFFF",
    alt_text = "", active = true, sort_order = 0, product_id = "",
  } = req.body;

  if (!image) return res.status(400).json({ message: "Hero image is required" });

  const id = heroImageId || `HERO_IMAGE#${uuidv4()}`;
  const linkedProductId = String(product_id || '').trim();
  if (linkedProductId) {
    const linkedProduct = await ddbDocClient.send(new GetCommand({
      TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
      Key: { suitId: linkedProductId },
    }));
    if (!linkedProduct.Item || !['product', 'suit'].includes(linkedProduct.Item.type)) {
      return res.status(400).json({ message: 'The selected product is no longer listed in inventory' });
    }
  }
  let existing;
  if (heroImageId) {
    const result = await ddbDocClient.send(new GetCommand({
      TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
      Key: { suitId: heroImageId },
    }));
    existing = result.Item;
  }

  const heroImage = {
    suitId: id,
    type: "home_hero_image",
    image,
    line_one: String(line_one ?? '').trim().slice(0, 60),
    line_two: String(line_two ?? '').trim().slice(0, 100),
    line_one_color: /^#[0-9a-f]{6}$/i.test(line_one_color) ? line_one_color.toUpperCase() : "#FDE68A",
    line_two_color: /^#[0-9a-f]{6}$/i.test(line_two_color) ? line_two_color.toUpperCase() : "#FFFFFF",
    alt_text: String(alt_text ?? '').trim().slice(0, 160),
    active: Boolean(active),
    sort_order: Number(sort_order) || 0,
    product_id: linkedProductId,
    created_at: existing?.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  try {
    await ddbDocClient.send(new PutCommand({ TableName: process.env.AWS_DYNAMODB_TABLE_NAME, Item: heroImage }));
    res.status(heroImageId ? 200 : 201).json(heroImage);
  } catch (err) {
    console.error("Hero Image Save Error:", err);
    res.status(500).json({ message: "Error saving hero image" });
  }
});

app.delete("/api/admin/hero-images/:heroImageId", adminAuth, async (req, res) => {
  try {
    await ddbDocClient.send(new DeleteCommand({
      TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
      Key: { suitId: decodeURIComponent(req.params.heroImageId) },
    }));
    res.json({ message: "Hero image deleted" });
  } catch (err) {
    console.error("Hero Image Delete Error:", err);
    res.status(500).json({ message: "Error deleting hero image" });
  }
});

// Public, scheduled banner feed used by the home hero.
app.get("/api/banners", async (req, res) => {
  try {
    const data = await ddbDocClient.send(new ScanCommand({
      TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
      FilterExpression: "#type = :banner",
      ExpressionAttributeNames: { "#type": "type" },
      ExpressionAttributeValues: { ":banner": "home_banner" },
    }));
    const now = Date.now();
    const banners = (data.Items || [])
      .filter(banner => banner.active !== false)
      .filter(banner => !banner.starts_at || new Date(banner.starts_at).getTime() <= now)
      .filter(banner => !banner.ends_at || new Date(banner.ends_at).getTime() >= now)
      .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
    res.json(banners);
  } catch (err) {
    console.error("Public Banner Fetch Error:", err);
    res.status(500).json({ message: "Error fetching home banners" });
  }
});

app.get("/api/admin/banners", adminAuth, async (req, res) => {
  try {
    const data = await ddbDocClient.send(new ScanCommand({
      TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
      FilterExpression: "#type = :banner",
      ExpressionAttributeNames: { "#type": "type" },
      ExpressionAttributeValues: { ":banner": "home_banner" },
    }));
    res.json((data.Items || []).sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0)));
  } catch (err) {
    console.error("Admin Banner Fetch Error:", err);
    res.status(500).json({ message: "Error fetching banners" });
  }
});

app.post("/api/admin/banners", adminAuth, async (req, res) => {
  const {
    bannerId, title, banner_kind = "general", desktop_image, mobile_image,
    alt_text = "", headline = "", animated_words = [], headline_suffix = "",
    headline_color = "#FFFFFF", animated_word_color = "#FCD34D", headline_suffix_color = "#FFFFFF",
    subheading = "", subheading_color = "#FFFFFF", overlay_color = "#000000", overlay_opacity = 78,
    cta_label = "", cta_background_color = "#FFFFFF", cta_text_color = "#1C1917",
    link_url = "", active = true, starts_at = null, ends_at = null, sort_order = 0,
  } = req.body;

  if (!title?.trim() || !desktop_image) {
    return res.status(400).json({ message: "Banner title and desktop image are required" });
  }
  if (starts_at && ends_at && new Date(starts_at) > new Date(ends_at)) {
    return res.status(400).json({ message: "Banner end date must be after its start date" });
  }

  const id = bannerId || `BANNER#${uuidv4()}`;
  let existing;
  if (bannerId) {
    const result = await ddbDocClient.send(new GetCommand({
      TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
      Key: { suitId: bannerId },
    }));
    existing = result.Item;
  }
  const banner = {
    suitId: id,
    type: "home_banner",
    title: String(title ?? '').trim().slice(0, 100),
    banner_kind: String(banner_kind ?? 'general').trim() || 'general',
    desktop_image,
    mobile_image: mobile_image || desktop_image,
    alt_text: String(alt_text ?? '').trim().slice(0, 160),
    headline: String(headline ?? '').trim().slice(0, 100),
    animated_words: (Array.isArray(animated_words) ? animated_words : String(animated_words).split(','))
      .map(word => String(word ?? '').trim().slice(0, 40))
      .filter(Boolean)
      .slice(0, 12),
    headline_suffix: String(headline_suffix ?? '').trim().slice(0, 100),
    headline_color: /^#[0-9a-f]{6}$/i.test(headline_color) ? headline_color.toUpperCase() : "#FFFFFF",
    animated_word_color: /^#[0-9a-f]{6}$/i.test(animated_word_color) ? animated_word_color.toUpperCase() : "#FCD34D",
    headline_suffix_color: /^#[0-9a-f]{6}$/i.test(headline_suffix_color) ? headline_suffix_color.toUpperCase() : "#FFFFFF",
    subheading: String(subheading ?? '').trim().slice(0, 280),
    subheading_color: /^#[0-9a-f]{6}$/i.test(subheading_color) ? subheading_color.toUpperCase() : "#FFFFFF",
    overlay_color: /^#[0-9a-f]{6}$/i.test(overlay_color) ? overlay_color.toUpperCase() : "#000000",
    overlay_opacity: Math.min(95, Math.max(20, Number(overlay_opacity) || 78)),
    cta_label: String(cta_label ?? '').trim().slice(0, 40),
    cta_background_color: /^#[0-9a-f]{6}$/i.test(cta_background_color) ? cta_background_color.toUpperCase() : "#FFFFFF",
    cta_text_color: /^#[0-9a-f]{6}$/i.test(cta_text_color) ? cta_text_color.toUpperCase() : "#1C1917",
    link_url: String(link_url ?? '').trim().slice(0, 500),
    active: Boolean(active),
    starts_at: starts_at || null,
    ends_at: ends_at || null,
    sort_order: Number(sort_order) || 0,
    created_at: existing?.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  try {
    await ddbDocClient.send(new PutCommand({ TableName: process.env.AWS_DYNAMODB_TABLE_NAME, Item: banner }));
    res.status(bannerId ? 200 : 201).json(banner);
  } catch (err) {
    console.error("Banner Save Error:", err);
    res.status(500).json({ message: "Error saving banner" });
  }
});

app.delete("/api/admin/banners/:bannerId", adminAuth, async (req, res) => {
  try {
    await ddbDocClient.send(new DeleteCommand({
      TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
      Key: { suitId: decodeURIComponent(req.params.bannerId) },
    }));
    res.json({ message: "Banner deleted" });
  } catch (err) {
    console.error("Banner Delete Error:", err);
    res.status(500).json({ message: "Error deleting banner" });
  }
});

// Image Upload Route
app.post("/api/admin/upload", adminAuth, upload.single("image"), async (req, res) => {
  if (!process.env.AWS_S3_BUCKET_NAME) {
    console.error("Missing AWS_S3_BUCKET_NAME in environment variables");
    return res.status(500).json({ message: "Server configuration error: Missing S3 Bucket Name" });
  }

  try {
    console.log("Starting S3 upload for:", req.file.originalname);
    const fileUrl = await uploadFileToS3(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );
    res.json({ url: fileUrl });
  } catch (err) {
    console.error("Critical Upload Error:", err);
    res.status(err.$metadata?.httpStatusCode || 500).json({ 
      message: err.message,
      code: err.code || err.name,
      requestId: err.$metadata?.requestId,
      note: "Check your Render Environment Variables for AWS credentials"
    });
  }
});

// Get all users (Admin only)
app.get("/api/admin/users", adminAuth, async (req, res) => {
  const params = {
    TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
    FilterExpression: "#type = :utype",
    ExpressionAttributeNames: { "#type": "type" },
    ExpressionAttributeValues: { ":utype": "user_profile" }
  };

  try {
    const data = await ddbDocClient.send(new ScanCommand(params));
    res.json(data.Items);
  } catch (err) {
    console.error("Fetch Users Error:", err);
    res.status(500).json({ message: "Error fetching users" });
  }
});

// Get all orders (Admin only)
app.get("/api/admin/orders", adminAuth, async (req, res) => {
  const params = {
    TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
    FilterExpression: "#type = :otype",
    ExpressionAttributeNames: { "#type": "type" },
    ExpressionAttributeValues: { ":otype": "order" }
  };

  try {
    const data = await ddbDocClient.send(new ScanCommand(params));
    res.json(data.Items);
  } catch (err) {
    console.error("Fetch Orders Error:", err);
    res.status(500).json({ message: "Error fetching orders" });
  }
});

// Update the operational state of a delivery expansion request.
app.patch("/api/admin/delivery/demands/:demandId", adminAuth, async (req, res) => {
  const allowedStatuses = ["New", "Contacted", "Planned", "Serviceable", "Closed"];
  const { status, admin_notes = "" } = req.body;

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ message: "Invalid delivery request status" });
  }

  try {
    const result = await ddbDocClient.send(new UpdateCommand({
      TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
      Key: { suitId: decodeURIComponent(req.params.demandId) },
      UpdateExpression: "SET #status = :status, #notes = :notes, #updated = :updated",
      ExpressionAttributeNames: {
        "#status": "status",
        "#notes": "admin_notes",
        "#updated": "updated_at",
      },
      ExpressionAttributeValues: {
        ":status": status,
        ":notes": String(admin_notes).trim().slice(0, 500),
        ":updated": new Date().toISOString(),
      },
      ReturnValues: "ALL_NEW",
    }));
    res.json(result.Attributes);
  } catch (err) {
    console.error("Delivery Demand Update Error:", err);
    res.status(500).json({ message: "Could not update delivery request" });
  }
});

// Confirm or advance an order after the store has contacted the customer.
app.patch("/api/admin/orders/:orderId/status", adminAuth, async (req, res) => {
  const allowedStatuses = ["Awaiting Confirmation", "Confirmed", "Shipped", "Delivered", "Cancelled"];
  const allowedPaymentStatuses = ["Unpaid", "Pending", "Paid", "Refunded"];
  const allowedPaymentMethods = ["cod", "cash", "upi", "phonepe", "bank_transfer", "card", "other"];
  const { status, paymentStatus, paymentMethod, notifyCustomer = true } = req.body;

  if (!allowedStatuses.includes(status)) {
    return res.status(400).json({ message: "Invalid order status" });
  }
  if (paymentStatus && !allowedPaymentStatuses.includes(paymentStatus)) {
    return res.status(400).json({ message: "Invalid payment status" });
  }
  if (paymentMethod && !allowedPaymentMethods.includes(paymentMethod)) {
    return res.status(400).json({ message: "Invalid payment method" });
  }

  const orderId = decodeURIComponent(req.params.orderId);
  const names = { "#status": "status", "#updated": "updated_at" };
  const values = { ":status": status, ":updated": new Date().toISOString() };
  let updateExpression = "SET #status = :status, #updated = :updated";

  if (paymentStatus) {
    names["#paymentStatus"] = "paymentStatus";
    values[":paymentStatus"] = paymentStatus;
    updateExpression += ", #paymentStatus = :paymentStatus";
    names["#paymentUpdatedAt"] = "payment_updated_at";
    values[":paymentUpdatedAt"] = new Date().toISOString();
    updateExpression += ", #paymentUpdatedAt = :paymentUpdatedAt";
  }

  if (paymentMethod) {
    names["#paymentMethod"] = "paymentMethod";
    values[":paymentMethod"] = paymentMethod;
    updateExpression += ", #paymentMethod = :paymentMethod";
  }

  if (paymentStatus === "Paid") {
    names["#paidAt"] = "paid_at";
    values[":paidAt"] = new Date().toISOString();
    updateExpression += ", #paidAt = if_not_exists(#paidAt, :paidAt)";
  } else if (paymentStatus) {
    names["#paidAt"] = "paid_at";
    updateExpression += " REMOVE #paidAt";
  }

  if (status === "Confirmed") {
    names["#confirmedAt"] = "confirmed_at";
    values[":confirmedAt"] = new Date().toISOString();
    updateExpression += ", #confirmedAt = :confirmedAt";
  }

  try {
    const result = await ddbDocClient.send(new UpdateCommand({
      TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
      Key: { suitId: `ORDER#${orderId}` },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: names,
      ExpressionAttributeValues: values,
      ReturnValues: "ALL_NEW",
    }));
    const whatsappNotification = notifyCustomer === false
      ? { sent: false, reason: "notification_not_requested" }
      : await sendOrderStatusWhatsApp(result.Attributes);
    const pushNotification = notifyCustomer === false
      ? { configured: true, sent: 0, reason: "notification_not_requested" }
      : await sendOrderStatusPush(result.Attributes);
    res.json({ ...result.Attributes, whatsappNotification, pushNotification });
  } catch (err) {
    console.error("Order Status Update Error:", err);
    res.status(500).json({ message: "Could not update order status" });
  }
});

// Health Check
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "Kamlesh Suits API" });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
