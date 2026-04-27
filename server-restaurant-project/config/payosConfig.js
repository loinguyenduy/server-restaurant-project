import { PayOS } from "@payos/node";
import dotenv from "dotenv";
dotenv.config();

const payOSInstance = new PayOS({
    clientId: process.env.PAYOS_CLIENT_ID,
    apiKey: process.env.PAYOS_API_KEY,
    checksumKey: process.env.PAYOS_CHECKSUM_KEY
});

export default payOSInstance;