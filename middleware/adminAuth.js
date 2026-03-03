import { CognitoJwtVerifier } from "aws-jwt-verify";
import dotenv from "dotenv";

dotenv.config();

// Create the verifier
const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.COGNITO_USER_POOL_ID,
  tokenUse: "id", // Usually Admin groups are in the ID token or Access token
  clientId: process.env.COGNITO_CLIENT_ID,
});

/**
 * Middleware to verify Cognito JWT and check for 'Admin' group membership.
 */
export const adminAuth = async (req, res, next) => {
  console.log("AdminAuth middleware triggered for:", req.method, req.url);
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    // Verify the token
    const payload = await verifier.verify(token);

    // Check if the user is in the 'Admin' group or is the hardcoded admin email
    const groups = payload["cognito:groups"] || [];
    const email = payload["email"];
    
    if (groups.includes("Admin") || email === "sanjayrathi575@gmail.com") {
      req.user = payload; // Attach user info to request
      next();
    } else {
      return res.status(403).json({ message: "Forbidden: Access denied for non-admin users" });
    }
  } catch (err) {
    console.error("Token verification failed:", err.message);
    return res.status(401).json({ message: "Invalid or expired token" });
  }
};
