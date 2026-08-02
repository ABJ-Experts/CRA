import { intBetween, money, percent, pick, seeded } from "./seeded";

/**
 * Datasets for the four Tables screens.
 *
 * Rows visible in each Pencil frame are transcribed VERBATIM and always come
 * first, so page one of every table is the design. Rows beyond that are
 * generated from a fixed seed in the same shape, which is what gives sorting,
 * filtering and pagination something real to act on. Regenerating is stable,
 * so a screenshot taken today matches one taken next week.
 */

export interface Product {
  id: string;
  no: number;
  sku: string;
  name: string;
  updatedAt: string;
  category: string;
  status: "Active" | "Inactive";
  quantity: number;
  revenue: string;
  price: string;
}

export interface Order {
  id: string;
  no: number;
  orderNo: string;
  trackingId: string;
  createdAt: string;
  source: string;
  status: "Opened" | "Closed" | "Delivered";
  quantity: number;
  price: string;
}

export interface Customer {
  id: string;
  no: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  orders: number;
  status: "Active" | "Inactive";
}

export interface Coin {
  id: string;
  no: number;
  name: string;
  symbol: string;
  price: string;
  marketCap: string;
  h1: number;
  h24: number;
  d7: number;
  d30: number;
}

/* -- transcribed from EaMnQ ------------------------------------------------ */
const SEED_PRODUCTS: Omit<Product, "id">[] = [
  { no: 1, sku: "11677454K", name: "Coach Tabby 26 for sale", updatedAt: "21 Aug 2022", category: "Gloves", status: "Inactive", quantity: 287, revenue: "$12,593", price: "$928.41" },
  { no: 2, sku: "K123561ML", name: "Dell Computer Monitor", updatedAt: "21 Aug 2022", category: "Activewear", status: "Active", quantity: 59, revenue: "$11,062", price: "$328.85" },
  { no: 3, sku: "UG1234123", name: "Heimer Miller Sofa (Mint Condition)", updatedAt: "21 Aug 2022", category: "Sports Outlet", status: "Active", quantity: 192, revenue: "$11,457", price: "$767.50" },
  { no: 4, sku: "11677454K", name: "Playstation 4 Limited Edition (with games)", updatedAt: "21 Aug 2022", category: "Belts", status: "Active", quantity: 112, revenue: "$2,536", price: "$219.78" },
];

/* -- transcribed from CTm6w ------------------------------------------------ */
const SEED_ORDERS: Omit<Order, "id">[] = [
  { no: 1, orderNo: "0000982551", trackingId: "1MwvM5j6J1bkvry", createdAt: "28 Nov 1988, 00:38", source: "Gloves", status: "Opened", quantity: 287, price: "$928.41" },
  { no: 2, orderNo: "0000982553", trackingId: "BrQv91mWzywzmvzg", createdAt: "25 Jan 2002, 07:10", source: "Activewear", status: "Closed", quantity: 59, price: "$328.85" },
  { no: 3, orderNo: "0000982542", trackingId: "BrQv91mWzywzmvzg", createdAt: "17 May 1996, 19:11", source: "Sports Outlet", status: "Delivered", quantity: 192, price: "$767.50" },
  { no: 4, orderNo: "0000982535", trackingId: "1MwvM5j6J1bkvry", createdAt: "24 Mar 2016, 09:37", source: "Belts", status: "Opened", quantity: 112, price: "$219.78" },
];

/* -- transcribed from O5lpFJ ----------------------------------------------- */
const SEED_CUSTOMERS: Omit<Customer, "id">[] = [
  { no: 1, firstName: "Stanislav", lastName: "Davis", email: "deanna.curtis@example.com", phone: "(480) 555-0103", orders: 287, status: "Inactive" },
  { no: 2, firstName: "Patrick", lastName: "Moore", email: "jackson.graham@example.com", phone: "(205) 555-0100", orders: 59, status: "Inactive" },
  { no: 3, firstName: "Dave", lastName: "Johnson", email: "debbie.baker@example.com", phone: "(704) 555-0127", orders: 192, status: "Active" },
  { no: 4, firstName: "Josh", lastName: "Lopez", email: "felicia.reid@example.com", phone: "(702) 555-0122", orders: 112, status: "Inactive" },
];

/* -- transcribed from A6MS4 ------------------------------------------------ */
const SEED_COINS: Omit<Coin, "id">[] = [
  { no: 1, name: "Bitcoin", symbol: "BTC", price: "$162.24", marketCap: "$95,630M", h1: 0.32, h24: -2.04, d7: 0.05, d30: -3.44 },
  { no: 2, name: "Ethereum", symbol: "ETH", price: "$745.70", marketCap: "$1,363B", h1: 1.77, h24: -9.12, d7: 7.26, d30: 2.65 },
  { no: 3, name: "Binance", symbol: "BNB", price: "$211.68", marketCap: "$1,644M", h1: -8.12, h24: -12.56, d7: 6.87, d30: 8.12 },
  { no: 4, name: "Shiba Inu", symbol: "SHIB", price: "$262.73", marketCap: "$95,630M", h1: 6.43, h24: 7.12, d7: -0.44, d30: 7.12 },
];

const CATEGORIES = ["Gloves", "Activewear", "Sports Outlet", "Belts", "Footwear", "Outerwear", "Accessories"] as const;
const PRODUCT_NAMES = ["Sony WH-1000XM5 Headphones", "Herman Miller Aeron Chair", "Apple Studio Display", "Nikon Z6 II Body", "Weber Kettle Grill", "Bose SoundLink Flex", "Anker 737 Power Bank", "Logitech MX Master 3S", "Dyson V15 Detect", "Keychron Q1 Keyboard"] as const;
const FIRST = ["Amara", "Noah", "Priya", "Mateo", "Zoe", "Ibrahim", "Lena", "Kai", "Rosa", "Elias"] as const;
const LAST = ["Whitfield", "Okafor", "Nakamura", "Alvarez", "Bergstrom", "Haddad", "Lindqvist", "Mensah", "Petrov", "Ferrari"] as const;
const COINS_MORE = [["Solana", "SOL"], ["Cardano", "ADA"], ["Polkadot", "DOT"], ["Chainlink", "LINK"], ["Avalanche", "AVAX"], ["Polygon", "MATIC"], ["Litecoin", "LTC"], ["Uniswap", "UNI"], ["Stellar", "XLM"], ["Cosmos", "ATOM"]] as const;

const rid = (prefix: string, i: number) => `${prefix}-${i + 1}`;

export const PRODUCTS: Product[] = (() => {
  const rand = seeded(1337);
  const out: Product[] = SEED_PRODUCTS.map((p, i) => ({ ...p, id: rid("prd", i) }));
  for (let i = SEED_PRODUCTS.length; i < 96; i++) {
    const qty = intBetween(rand, 8, 480);
    out.push({
      id: rid("prd", i),
      no: i + 1,
      sku: `${intBetween(rand, 10000000, 99999999)}${pick(rand, ["K", "ML", "UG", "TZ"])}`,
      name: pick(rand, PRODUCT_NAMES),
      updatedAt: `${intBetween(rand, 1, 28)} ${pick(rand, ["Jan", "Mar", "May", "Aug", "Oct", "Dec"])} 202${intBetween(rand, 2, 5)}`,
      category: pick(rand, CATEGORIES),
      status: rand() > 0.35 ? "Active" : "Inactive",
      quantity: qty,
      revenue: money(intBetween(rand, 1200, 24000)),
      price: money(intBetween(rand, 40, 1600) + rand(), 2),
    });
  }
  return out;
})();

export const ORDERS: Order[] = (() => {
  const rand = seeded(4242);
  const out: Order[] = SEED_ORDERS.map((o, i) => ({ ...o, id: rid("ord", i) }));
  for (let i = SEED_ORDERS.length; i < 120; i++) {
    out.push({
      id: rid("ord", i),
      no: i + 1,
      orderNo: `00009${intBetween(rand, 10000, 99999)}`,
      trackingId: Array.from({ length: 15 }, () => "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ0123456789"[intBetween(rand, 0, 57)]).join(""),
      createdAt: `${intBetween(rand, 1, 28)} ${pick(rand, ["Jan", "Mar", "May", "Aug", "Oct", "Dec"])} 20${intBetween(rand, 10, 24)}, ${String(intBetween(rand, 0, 23)).padStart(2, "0")}:${String(intBetween(rand, 0, 59)).padStart(2, "0")}`,
      source: pick(rand, CATEGORIES),
      status: pick(rand, ["Opened", "Closed", "Delivered"] as const),
      quantity: intBetween(rand, 4, 420),
      price: money(intBetween(rand, 40, 1900) + rand(), 2),
    });
  }
  return out;
})();

export const CUSTOMERS: Customer[] = (() => {
  const rand = seeded(9001);
  const out: Customer[] = SEED_CUSTOMERS.map((c, i) => ({ ...c, id: rid("cus", i) }));
  for (let i = SEED_CUSTOMERS.length; i < 84; i++) {
    const first = pick(rand, FIRST);
    const last = pick(rand, LAST);
    out.push({
      id: rid("cus", i),
      no: i + 1,
      firstName: first,
      lastName: last,
      email: `${first.toLowerCase()}.${last.toLowerCase()}@example.com`,
      phone: `(${intBetween(rand, 200, 799)}) 555-0${String(intBetween(rand, 100, 199))}`,
      orders: intBetween(rand, 3, 320),
      status: rand() > 0.4 ? "Active" : "Inactive",
    });
  }
  return out;
})();

export const COINS: Coin[] = (() => {
  const rand = seeded(777);
  const out: Coin[] = SEED_COINS.map((c, i) => ({ ...c, id: rid("coin", i) }));
  for (let i = SEED_COINS.length; i < 60; i++) {
    const [name, symbol] = COINS_MORE[(i - SEED_COINS.length) % COINS_MORE.length] as readonly [string, string];
    const swing = () => Number((rand() * 24 - 12).toFixed(2));
    out.push({
      id: rid("coin", i),
      no: i + 1,
      name: i < SEED_COINS.length + COINS_MORE.length ? name : `${name} ${Math.floor(i / COINS_MORE.length)}`,
      symbol,
      price: money(intBetween(rand, 5, 900) + rand(), 2),
      marketCap: `$${intBetween(rand, 120, 9800)}${pick(rand, ["M", "B"])}`,
      h1: swing(),
      h24: swing(),
      d7: swing(),
      d30: swing(),
    });
  }
  return out;
})();

export { percent };
