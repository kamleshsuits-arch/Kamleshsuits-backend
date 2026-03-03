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
