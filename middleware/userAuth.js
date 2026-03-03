import { CognitoJwtVerifier } from "aws-jwt-verify";
import dotenv from "dotenv";

dotenv.config();

const verifier = CognitoJwtVerifier.create({
  userPoolId: process.env.COGNITO_USER_POOL_ID,
  tokenUse: "id",
  clientId: process.env.COGNITO_CLIENT_ID,
});

/**
 * Middleware to verify Cognito JWT for any authenticated user.
 * Attaches the decoded payload to req.user.
 */
export const userAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "No token provided" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const payload = await verifier.verify(token);
    req.user = payload; // sub is the unique user ID
    next();
  } catch (err) {
    console.error("User token verification failed:", err.message);
    return res.status(401).json({ message: "Invalid or expired user token" });
  }
};
