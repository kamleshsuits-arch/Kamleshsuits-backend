
import { DynamoDBClient, DescribeTableCommand } from "@aws-sdk/client-dynamodb";
import dotenv from "dotenv";
dotenv.config();

const client = new DynamoDBClient({
  region: process.env.AWS_REGION || "ap-south-1",
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

async function main() {
  try {
    const data = await client.send(new DescribeTableCommand({ TableName: process.env.AWS_DYNAMODB_TABLE_NAME }));
    console.log(JSON.stringify(data.Table.KeySchema, null, 2));
  } catch (err) {
    console.error(err);
  }
}

main();
