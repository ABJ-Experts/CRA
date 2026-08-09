import { z } from "zod";

const identifier = z.string().min(1);
const displayText = z.string().min(1);
const rowNumber = z.number().int().positive();
const quantity = z.number().int().nonnegative();

export const productSchema = z
  .object({
    id: identifier,
    no: rowNumber,
    sku: displayText,
    name: displayText,
    updatedAt: displayText,
    category: displayText,
    status: z.enum(["Active", "Inactive"]),
    quantity,
    revenue: displayText,
    price: displayText,
  })
  .strict();

export const orderSchema = z
  .object({
    id: identifier,
    no: rowNumber,
    orderNo: displayText,
    trackingId: displayText,
    createdAt: displayText,
    source: displayText,
    status: z.enum(["Opened", "Closed", "Delivered"]),
    quantity,
    price: displayText,
  })
  .strict();

export const customerSchema = z
  .object({
    id: identifier,
    no: rowNumber,
    firstName: displayText,
    lastName: displayText,
    email: z.email(),
    phone: displayText,
    orders: quantity,
    status: z.enum(["Active", "Inactive"]),
  })
  .strict();

export const coinSchema = z
  .object({
    id: identifier,
    no: rowNumber,
    name: displayText,
    symbol: displayText,
    price: displayText,
    marketCap: displayText,
    h1: z.number().finite(),
    h24: z.number().finite(),
    d7: z.number().finite(),
    d30: z.number().finite(),
  })
  .strict();

export type Product = z.infer<typeof productSchema>;
export type Order = z.infer<typeof orderSchema>;
export type Customer = z.infer<typeof customerSchema>;
export type Coin = z.infer<typeof coinSchema>;
