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
  UpdateCommand, 
  DeleteCommand 
} from "@aws-sdk/lib-dynamodb";
import { adminAuth } from "./middleware/adminAuth.js";
import { userAuth } from "./middleware/userAuth.js";
import { uploadFileToS3 } from "./libs/s3Service.js";
import { sendOrderNotification } from "./libs/emailService.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

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
  
  const sanitized = {
    title: String(data.title || "Untitled Asset").trim(),
    description: String(data.description || "").trim(),
    price: parseFloat(data.price) || 0,
    discount: parseInt(data.discount) || 0,
    mrp: parseFloat(data.mrp) || parseFloat(data.price) || 0,
    stock: parseInt(data.stock) || 0,
    type: String(data.type || "suit"),
    image: String(data.image || ""),
    images: Array.isArray(data.images) ? data.images : [],
    colors: Array.isArray(data.colors) ? data.colors : [],
    categories: Array.isArray(data.categories) ? data.categories : [],
    fabric_family: String(data.fabric_family || "").trim(),
    fabric_category: String(data.fabric_category || "").trim(),
    session: String(data.session || "").trim(),
    rating: parseFloat(data.rating) || 4.1,
    reviews: parseInt(data.reviews) || 26,
  };

  if (!sanitized.title) errors.push("Title is required");
  if (sanitized.price < 0) errors.push("Price cannot be negative");
  
  return { sanitized, errors };
};

// --- PUBLIC ROUTES ---

// Get all products
app.get("/api/products", async (req, res) => {
  const params = {
    TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
    FilterExpression: "#type = :suit",
    ExpressionAttributeNames: { "#type": "type" },
    ExpressionAttributeValues: { ":suit": "suit" }
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
    'type', 'image', 'images', 'colors', 'categories', 
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

// Place New Order
app.post("/api/user/orders", userAuth, async (req, res) => {
  const { items, address, subtotal, total, paymentMethod } = req.body;
  
  if (!items || !address || !total) {
    return res.status(400).json({ message: "Order details are incomplete" });
  }

  const orderId = `ORD-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
  
  const order = {
    suitId: `ORDER#${orderId}`,
    type: "order",
    orderId,
    user_id: req.user.sub,
    user_email: req.user.email,
    items,
    address,
    subtotal,
    total,
    paymentMethod,
    status: "Pending",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const params = {
    TableName: process.env.AWS_DYNAMODB_TABLE_NAME,
    Item: order,
  };

  try {
    // 1. Save to DynamoDB
    await ddbDocClient.send(new PutCommand(params));
    
    // 2. Send Email Notifications (Fire and forget or wait depending on reliability needs)
    // We wait here to ensure we can tell the user if something went wrong with the core flow
    const emailResult = await sendOrderNotification({
      user: { email: req.user.email, sub: req.user.sub },
      address,
      items,
      subtotal,
      total,
      paymentMethod,
      orderId
    });

    if (!emailResult.success) {
      console.warn("Order saved but emails failed to send:", emailResult.error);
    }

    res.status(201).json({ 
      message: "Order placed successfully", 
      orderId,
      emailSent: emailResult.success 
    });
  } catch (err) {
    console.error("Order Placement Error:", err);
    res.status(500).json({ message: "Error placing order", error: err.message });
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
  const { code, discount, type, min_purchase, usage_limit, expires_at, description } = req.body;
  
  if (!code || !discount) {
    return res.status(400).json({ message: "Code and discount are required" });
  }

  const coupon = {
    suitId: `COUPON#${code.toUpperCase()}`,
    type: "coupon",
    code: code.toUpperCase(),
    discount: parseFloat(discount),
    discount_type: type || "flat", // "flat" or "percent"
    min_purchase: parseFloat(min_purchase) || 0,
    usage_limit: parseInt(usage_limit) || null,
    used_count: 0,
    expires_at: expires_at || null,
    description: description || "",
    created_at: new Date().toISOString(),
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
  const { code, subtotal } = req.body;
  
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

    // Check min purchase
    if (subtotal < coupon.min_purchase) {
      return res.status(400).json({ 
        message: `Min purchase of ₹${coupon.min_purchase} required for this coupon` 
      });
    }

    // Check usage limit
    if (coupon.usage_limit && coupon.used_count >= coupon.usage_limit) {
      return res.status(400).json({ message: "Coupon usage limit reached" });
    }

    res.json(coupon);
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

// Image Upload Route
app.post("/api/admin/upload", adminAuth, upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "No file uploaded" });

  try {
    const fileUrl = await uploadFileToS3(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype
    );
    res.json({ url: fileUrl });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Health Check
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "Kamlesh Suits API" });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
