import { Upload } from "@aws-sdk/lib-storage";
import { s3Client } from "./awsClient.js";
import dotenv from "dotenv";

dotenv.config();

/**
 * Uploads a file buffer to S3.
 * @param {Buffer} fileBuffer - The file content.
 * @param {string} fileName - Destination file name.
 * @param {string} mimeType - File MIME type.
 * @returns {Promise<string>} - The public URL of the uploaded file.
 */
export const uploadFileToS3 = async (fileBuffer, fileName, mimeType) => {
  const bucketName = process.env.AWS_S3_BUCKET_NAME;

  try {
    const sanitizedFileName = fileName.replace(/\s+/g, '-');
    const upload = new Upload({
      client: s3Client,
      params: {
        Bucket: bucketName,
        Key: `products/${Date.now()}-${sanitizedFileName}`,
        Body: fileBuffer,
        ContentType: mimeType,
      },
    });

    const result = await upload.done();
    
    // Return the Location provided by AWS SDK (standard public URL)
    return result.Location;
  } catch (err) {
    console.error("S3 Upload Full Error:", {
      message: err.message,
      code: err.code,
      requestId: err.$metadata?.requestId,
      status: err.$metadata?.httpStatusCode
    });
    // Throw the original error so the route handler knows the real cause
    throw err;
  }
};
