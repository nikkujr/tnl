import { requirements, totalCents, type Sale } from "../features/orders/sales.js";

const DAY = 86400000;
const MANILA_OFFSET = 8 * 3600000;
export const demoPassword = "TnlDemo123!";
export const businessDate = (date: Date) => new Date(date.getTime() + MANILA_OFFSET).toISOString().slice(0, 10);

// Illustrative PHP prices and fictional contacts, not a supplier price list or real customer records.
const catalog: Array<[string, string, number, string]> = [
  ["Smartphones", "Samsung Galaxy A16 128GB", 8990, "6.7-inch Android handset, 128GB storage, dual SIM."],
  ["Smartphones", "Samsung Galaxy A26 5G 256GB", 15990, "Midrange 5G handset with 256GB storage."],
  ["Smartphones", "Samsung Galaxy A36 5G 256GB", 21990, "5G handset for everyday work and photography."],
  ["Smartphones", "Redmi Note 14 128GB", 8499, "Value Android handset with 128GB storage."],
  ["Smartphones", "Redmi Note 14 Pro 256GB", 13999, "256GB Android handset with high-resolution camera."],
  ["Smartphones", "OPPO A5 Pro 128GB", 10999, "Everyday Android handset with 128GB storage."],
  ["Smartphones", "vivo Y29 128GB", 9999, "Dual-SIM Android handset for calls, messaging and media."],
  ["Smartphones", "realme C75 128GB", 8999, "Entry-level Android handset with 128GB storage."],
  ["Smartphones", "Infinix HOT 50 128GB", 6499, "Budget Android handset for students and first-time buyers."],
  ["Smartphones", "TECNO SPARK 30 128GB", 5999, "Budget dual-SIM smartphone with 128GB storage."],
  ["Computers", "Acer Aspire Lite 14 Ryzen 5 8GB/512GB", 27995, "14-inch laptop for school and office documents."],
  ["Computers", "Lenovo IdeaPad Slim 3 Ryzen 5 16GB/512GB", 32995, "16GB laptop for multitasking and remote work."],
  ["Computers", "ASUS Vivobook 15 Core i5 8GB/512GB", 34995, "15-inch laptop for home and office productivity."],
  ["Computers", "HP Laptop 15 Ryzen 5 8GB/512GB", 29995, "15-inch laptop with SSD storage."],
  ["Computers", "Dell Inspiron 15 Core i5 16GB/512GB", 38995, "16GB notebook for business applications."],
  ["Computers", "Lenovo ThinkCentre Core i5 Desktop", 24995, "Desktop tower with 8GB RAM and 512GB SSD; monitor sold separately."],
  ["Computers", "ASUS Mini PC Core i3 8GB/256GB", 18995, "Compact desktop for a small office or shop counter."],
  ["Computers", "Acer Nitro V 15 Gaming Laptop", 48995, "Entry gaming and editing laptop with 16GB RAM and dedicated graphics."],
  ["Computers", "Samsung Galaxy Tab A9 64GB", 7990, "Compact Android tablet for reading and online classes."],
  ["Computers", "Redmi Pad SE 128GB", 10999, "Android tablet for study and home entertainment."],
  ["Monitors & Peripherals", "AOC 24-inch IPS Monitor", 6495, "24-inch full-HD IPS display with HDMI input."],
  ["Monitors & Peripherals", "Samsung 24-inch IPS Monitor", 6995, "Full-HD display for office and study desks."],
  ["Monitors & Peripherals", "LG 27-inch IPS Monitor", 9495, "27-inch full-HD display for multitasking."],
  ["Monitors & Peripherals", "Logitech MK220 Keyboard & Mouse", 1195, "Compact wireless keyboard and mouse set."],
  ["Monitors & Peripherals", "Logitech M185 Wireless Mouse", 650, "Wireless mouse with USB receiver."],
  ["Monitors & Peripherals", "Rapoo Wired Keyboard", 395, "Full-size USB keyboard for office use."],
  ["Monitors & Peripherals", "A4Tech Wired Mouse", 250, "USB optical mouse for desktops and laptops."],
  ["Monitors & Peripherals", "Logitech C270 Webcam", 1495, "USB webcam for video calls and online classes."],
  ["Monitors & Peripherals", "USB Headset with Microphone", 795, "Wired USB headset for meetings and customer support."],
  ["Monitors & Peripherals", "Aluminum Laptop Stand", 695, "Foldable laptop stand for a raised desk position."],
  ["Printing & Shop Equipment", "Epson EcoTank L3210 Printer", 8995, "Ink-tank print, scan and copy unit with USB connection."],
  ["Printing & Shop Equipment", "Canon PIXMA G2730 Printer", 8495, "Refillable ink-tank printer for documents and school work."],
  ["Printing & Shop Equipment", "Brother DCP-T420W Printer", 9495, "Ink-tank multifunction printer with wireless connectivity."],
  ["Printing & Shop Equipment", "Epson 003 Black Ink Bottle", 295, "Replacement black ink for compatible Epson EcoTank printers."],
  ["Printing & Shop Equipment", "Epson 003 Color Ink Set", 885, "Cyan, magenta and yellow bottles for compatible printers."],
  ["Printing & Shop Equipment", "80mm USB Thermal Receipt Printer", 3495, "USB receipt printer for a shop checkout counter."],
  ["Printing & Shop Equipment", "USB Barcode Scanner", 1295, "Handheld scanner for common retail barcodes."],
  ["Printing & Shop Equipment", "Retail Cash Drawer", 1595, "Counter cash drawer for a compatible receipt-printer connection."],
  ["Printing & Shop Equipment", "80mm Thermal Paper 10-Roll Pack", 450, "Consumable receipt paper for 80mm thermal printers."],
  ["Printing & Shop Equipment", "A4 Copy Paper 500-Sheet Ream", 245, "General-purpose paper for office and school printing."],
  ["Networking", "TP-Link Archer C64 Router", 1995, "Dual-band wireless router for home or small-office use."],
  ["Networking", "TP-Link Deco E4 Two-Unit Mesh", 3995, "Two-unit mesh Wi-Fi kit for wider home coverage."],
  ["Networking", "TP-Link TL-SG105 Gigabit Switch", 995, "Five-port unmanaged switch for wired office devices."],
  ["Networking", "Cat6 Ethernet Cable 10m", 295, "Ten-meter network cable for router or workstation connections."],
  ["Networking", "TP-Link USB Wi-Fi Adapter", 595, "USB wireless adapter for a desktop or laptop."],
  ["Networking", "LTE Pocket Wi-Fi Device", 1495, "Portable LTE hotspot; SIM and data subscription sold separately."],
  ["Power & Storage", "Kingston 500GB SATA SSD", 2195, "2.5-inch SATA SSD for compatible computer upgrades."],
  ["Power & Storage", "Kingston 1TB NVMe SSD", 3495, "M.2 NVMe drive; motherboard compatibility must be checked."],
  ["Power & Storage", "Kingston 8GB DDR4 Desktop RAM", 1295, "Desktop memory module; not a laptop SODIMM."],
  ["Power & Storage", "SanDisk 64GB USB Flash Drive", 395, "USB storage for documents and school files."],
  ["Power & Storage", "WD 1TB Portable Hard Drive", 3295, "USB portable drive for backups and file transport."],
  ["Power & Storage", "APC 650VA UPS", 3995, "Backup power unit for an office desktop or network equipment."],
  ["Power & Storage", "Surge Protector Six-Outlet Strip", 595, "Power strip with surge protection for desk equipment."],
  ["Mobile Accessories", "USB-C 20W Wall Charger", 495, "USB-C charger; compatible cable sold separately."],
  ["Mobile Accessories", "USB-C Cable 1m", 195, "One-meter USB-C charging and data cable."],
  ["Mobile Accessories", "10000mAh Power Bank", 995, "Portable backup battery for phones and accessories."],
  ["Mobile Accessories", "Universal Phone Desk Stand", 195, "Adjustable tabletop holder for video calls."],
  ["Mobile Accessories", "Samsung Galaxy A16 Tempered Glass", 149, "Screen protector fitted to the Galaxy A16."],
  ["Mobile Accessories", "Samsung Galaxy A16 Clear Case", 199, "Clear protective case fitted to the Galaxy A16."],
  ["Mobile Accessories", "Bluetooth Wireless Earbuds", 895, "Wireless earbuds with charging case for calls and music."],
];

const agentNames = ["Jamie Co", "Paolo Reyes", "Angela Dela Cruz", "Miguel Mendoza", "Bea Villanueva", "Carlo Navarro", "Rica Bautista", "Enzo Garcia"];
const customerNames = ["Mara Santos", "Luis Ramos", "Aileen Cruz", "Ramon Flores", "Camille Torres", "Joel Mercado", "Patricia Lim", "Dennis Aquino", "Grace Soriano", "Mark Velasco", "Nina Castillo", "Allan Santiago", "Rose Fernandez", "Kevin Tan", "Dianne Valdez", "Roberto Salazar", "Joyce Manalo", "Adrian Lopez", "Kristine Uy", "Edwin Pineda", "Liza Pascual", "Marvin Dizon", "Sofia Gonzales", "Teresa Abad", "Cesar Enriquez", "Abigail Rivera", "Nathaniel Cortez", "Vivian Morales", "Christian Cabral", "Hannah Espiritu", "Noel De Leon", "Denise Macapagal", "Eric Alcantara", "Isabel Ignacio", "Wilson Cheng", "Karen Evangelista", "Albert Tolentino", "Trisha Magbanua", "Daniel Arce", "Felisa Miranda", "Richard Tuazon", "Janine Buenaventura", "Ronald Estrella", "Pauline Francisco", "Samuel Serrano", "Monica Andrada", "Alex Evangelio", "Clarissa Delos Santos", "Nestor Solis", "Andrea Yap", "Oscar Clemente", "Charlene David", "Philip Natividad", "Mariel Cordero", "Benedict Samson", "Elena Roman", "Ferdinand Palma", "Celine Roxas", "Juanito Jacinto", "Hazel Go"];
const districts: Array<[string, number, number, 'BICOL' | 'LUZON' | 'VISAYAS' | 'MINDANAO', number]> = [
  ['Maginhawa Street, Teachers Village, Quezon City', 14.6478, 121.0606, 'LUZON', 0],
  ['P. Tuazon Boulevard, Cubao, Quezon City', 14.6195, 121.0576, 'LUZON', 0],
  ['Peñafrancia Avenue, Naga City, Camarines Sur', 13.6256, 123.1948, 'BICOL', 0],
  ['Rizal Street, Legazpi City, Albay', 13.1391, 123.7438, 'BICOL', 0],
  ['Mabini Street, Cebu City, Cebu', 10.2985, 123.9039, 'VISAYAS', 0],
  ['J. M. Basa Street, Iloilo City, Iloilo', 10.6951, 122.5688, 'VISAYAS', 0],
  ['J. P. Laurel Avenue, Davao City', 7.1007, 125.6289, 'MINDANAO', 0],
  ['Barangay Marilog, Marilog District, Davao City', 7.4491, 125.2528, 'MINDANAO', 2],
];

export interface DemoOrder {
  id: number;
  customerId: number;
  agentId: number | null;
  employeeId: number | null;
  trackingNumber: string;
  sale: Sale;
  orderStatus: "PENDING" | "APPROVED" | "COMPLETED" | "CANCELLED" | "REJECTED";
  deliveryStatus: "PREPARING" | "DISPATCHED" | "IN_TRANSIT" | "OUT_FOR_DELIVERY" | "DELIVERED" | null;
  paymentStatus: "UNPAID" | "PARTIALLY_PAID" | "PAID";
  paymentMethod: string;
  createdAt: Date;
  approvedAt: Date | null;
  deliveryChangedAt: Date | null;
  saleCompletedAt: Date | null;
  updatedAt: Date;
}

export function buildDemoData(now = new Date()) {
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid seed date");
  const local = new Date(now.getTime() + MANILA_OFFSET);
  const monthStart = (offset: number) => new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + offset, 1) - MANILA_OFFSET);
  const start = monthStart(-5);
  const currentMonth = businessDate(monthStart(0)).slice(0, 7);
  let randomState = 20261004;
  const random = () => ((randomState = (Math.imul(1664525, randomState) + 1013904223) >>> 0) / 4294967296);
  const pick = <T>(values: readonly T[]) => values[Math.floor(random() * values.length)]!;
  const users = [
    { id: 1, name: "Nico Alvarez", email: "admin@tnl.local", role: "ADMIN", createdAt: new Date(start.getTime() - 100 * DAY) },
    ...agentNames.map((name, i) => ({ id: i + 2, name, email: i === 0 ? "agent@tnl.local" : `agent${i + 1}@tnl.local`, role: "AGENT", createdAt: i === 7 ? monthStart(0) : new Date(start.getTime() - 90 * DAY) })),
    ...["Arnel Castillo", "Jun Villanueva"].map((name, i) => ({ id: i + 10, name, email: `delivery${i + 1}@tnl.local`, role: "DELIVERY", createdAt: new Date(start.getTime() - 90 * DAY) })),
  ];
  const customers = customerNames.map((name, i) => {
    const [street, latitude, longitude, region, remoteDays] = districts[i % districts.length]!;
    return { id: i + 1, name, email: i === 0 ? "mara.santos@example.test" : `${name.toLowerCase().replaceAll(" ", ".")}@example.test`, phone: `0917${String(5550100 + i)}`, address: `${24 + i * 7} ${street}`, latitude, longitude, region, remoteDays, agentId: i < customerNames.length - 3 ? 2 + i % 7 : i < customerNames.length - 1 ? 9 : null, optedIn: i % 3 !== 2, createdAt: i < customerNames.length - 3 || i === customerNames.length - 1 ? new Date(start.getTime() - (80 - i) * DAY) : monthStart(0) };
  });
  const products = catalog.map(([category, name, price, description], i) => ({ id: i + 1, category, name, sku: `TNL-${String(i + 1).padStart(3, "0")}`, price, description, available: i === 44 ? 0 : i % 11 === 0 ? 2 : price >= 18000 ? 6 + i % 6 : 18 + i % 20, threshold: price >= 18000 ? 3 : 5, reorder: price >= 18000 ? 8 : 20 }));
  const component = (id: number, quantity = 1) => {
    const p = products[id - 1]!;
    return { productId: p.id, productName: p.name, sku: p.sku, quantity };
  };
  const packages = [
    { packageId: 1, name: "Galaxy A16 Everyday Essentials", description: "Galaxy A16 128GB, fitted case and glass, USB-C charger and cable.", sellingPrice: 9490, commissionType: "FIXED" as const, commissionValue: 350, components: [component(1), component(58), component(59), component(54), component(55)] },
    { packageId: 2, name: "Student Laptop Starter", description: "Acer Aspire Lite 14 with wireless mouse, laptop stand and 64GB flash drive.", sellingPrice: 28995, commissionType: "FIXED" as const, commissionValue: 900, components: [component(11), component(25), component(30), component(50)] },
    { packageId: 3, name: "Work-from-Home Desk Kit", description: "Lenovo IdeaPad Slim 3, 24-inch monitor, wireless keyboard/mouse, webcam and USB headset.", sellingPrice: 40995, commissionType: "PERCENTAGE" as const, commissionValue: 3, components: [component(12), component(21), component(24), component(28), component(29)] },
    { packageId: 4, name: "Small Shop Checkout Hardware", description: "Mini PC, 24-inch monitor, keyboard/mouse, receipt printer, scanner, cash drawer and thermal paper. POS software sold separately.", sellingPrice: 32995, commissionType: "FIXED" as const, commissionValue: 1200, components: [component(17), component(21), component(24), component(36), component(37), component(38), component(39, 2)] },
    { packageId: 5, name: "Home Wi-Fi Coverage Kit", description: "Two-unit mesh kit, five-port gigabit switch, two Cat6 cables and surge protector.", sellingPrice: 5795, commissionType: "PERCENTAGE" as const, commissionValue: 5, components: [component(42), component(43), component(44, 2), component(53)] },
    { packageId: 6, name: "Print & Study Home Office", description: "HP Laptop 15, Epson L3210 printer, wireless mouse and two reams of A4 paper.", sellingPrice: 38995, commissionType: "PERCENTAGE" as const, commissionValue: 3.5, components: [component(14), component(31), component(25), component(40, 2)] },
  ];
  const packageChoices = [0, 0, 0, 1, 1, 2, 3, 4, 4, 5];
  // Keep some stocked products unsold so slow-mover reports tell a useful story.
  const productChoices = [1, 4, 4, 7, 8, 9, 10, 11, 14, 19, 20, 25, 25, 27, 30, 31, 34, 39, 40, 41, 44, 50, 53, 54, 55, 55, 56, 57, 60];
  const sale = (i: number): Sale => {
    const bundle = i % 10 < 7 ? [{ ...packages[pick(packageChoices)]!, quantity: i % 37 === 0 ? 2 : 1 }] : [];
    const items = i % 10 >= 7 || i % 5 === 0 ? [(() => {
      const p = products[pick(productChoices) - 1]!;
      return { ...component(p.id, p.price < 1000 ? pick([1, 1, 2, 3]) : 1), unitPrice: p.price };
    })()] : [];
    return { items, packages: bundle };
  };
  const orders: DemoOrder[] = [];
  const addOrder = (completedAt: Date, status: DemoOrder["orderStatus"], delivery: DemoOrder["deliveryStatus"], payment: DemoOrder["paymentStatus"]) => {
    const id = orders.length + 1;
    const monthSaleIndex = status === "COMPLETED" && payment === "PAID" && businessDate(completedAt).startsWith(currentMonth)
      ? orders.filter(o => o.saleCompletedAt && businessDate(o.saleCompletedAt).startsWith(currentMonth)).length : -1;
    const customer = monthSaleIndex >= 0 && monthSaleIndex < 7 ? customers[monthSaleIndex]!
      : status === "PENDING" && id % 3 === 0 ? pick(customers.slice(-3)) : pick(customers.filter(c => c.agentId !== 9));
    completedAt = new Date(Math.max(completedAt.getTime(), customer.createdAt.getTime()));
    const approved = delivery !== null;
    const createdAt = new Date(completedAt.getTime() - (approved ? 2 + id % 4 : 0) * DAY);
    const approvedAt = approved ? new Date(createdAt.getTime() + 4 * 3600000) : null;
    const s = monthSaleIndex >= 0 && monthSaleIndex < 7
      ? { items: [], packages: [{ ...packages[[1, 2, 3, 5, 1, 2, 3][monthSaleIndex]!]!, quantity: 1 }] } : sale(id);
    const deliveryChangedAt = delivery === "PREPARING" ? approvedAt : approved ? new Date(completedAt.getTime() - (delivery === "DELIVERED" && payment === "PAID" && id % 4 === 0 ? DAY : 0)) : null;
    orders.push({ id, customerId: customer.id, agentId: customer.agentId, employeeId: approved && (delivery !== "PREPARING" || id % 3 !== 0) ? 10 + id % 2 : null, trackingNumber: `TNL-DEMO-${String(id).padStart(4, "0")}`, sale: s, orderStatus: status, deliveryStatus: delivery, paymentStatus: payment, paymentMethod: pick(["Cash", "Cash on delivery", "Bank transfer", "Card"]), createdAt, approvedAt, deliveryChangedAt, saleCompletedAt: delivery === "DELIVERED" && payment === "PAID" ? completedAt : null, updatedAt: completedAt });
  };
  const monthlyCounts = [28, 34, 38, 42, 48, Math.min(50, local.getUTCDate() * 4)];
  monthlyCounts[4]! += 50 - monthlyCounts[5]!;
  for (let month = 0; month < 6; month++) {
    const begin = monthStart(month - 5), end = month === 5 ? now : monthStart(month - 4);
    for (let i = 0; i < monthlyCounts[month]!; i++) {
      const span = end.getTime() - begin.getTime();
      const at = month === 5 && i >= monthlyCounts[month]! - 4
        ? new Date(Math.max(begin.getTime(), now.getTime() - (monthlyCounts[month]! - 1 - i) * 15 * 60000))
        : new Date(begin.getTime() + span * (i + 0.6) / monthlyCounts[month]!);
      addOrder(at, "COMPLETED", "DELIVERED", "PAID");
    }
  }
  for (let i = 0; i < 24; i++) addOrder(new Date(now.getTime() - (i + 1) * DAY), "COMPLETED", "DELIVERED", i % 3 === 0 ? "UNPAID" : "PARTIALLY_PAID");
  for (const delivery of ["PREPARING", "DISPATCHED", "IN_TRANSIT", "OUT_FOR_DELIVERY"] as const)
    for (let i = 0; i < 12; i++) addOrder(new Date(now.getTime() - (i % 5) * DAY - (i + 1) * 60000), "APPROVED", delivery, pick(["UNPAID", "PARTIALLY_PAID", "PAID"]));
  for (let i = 0; i < 30; i++) addOrder(new Date(now.getTime() - (i % 4) * DAY - (i + 1) * 60000), "PENDING", null, "UNPAID");
  for (let i = 0; i < 12; i++) addOrder(new Date(now.getTime() - (i + 2) * DAY), "CANCELLED", null, "UNPAID");
  for (let i = 0; i < 6; i++) addOrder(new Date(now.getTime() - (i + 3) * DAY), "REJECTED", null, "UNPAID");

  const inventory = products.map(p => {
    let sold = 0, reserved = 0;
    for (const o of orders) {
      const quantity = requirements(o.sale).find(r => r.productId === p.id)?.quantity ?? 0;
      if (o.deliveryStatus === "DELIVERED") sold += quantity;
      else if (o.orderStatus === "APPROVED") reserved += quantity;
    }
    return { productId: p.id, sold, reserved, opening: sold + reserved + p.available, onHand: reserved + p.available };
  });
  const periods = Array.from({ length: 6 }, (_, i) => businessDate(monthStart(i - 5)).slice(0, 7));
  const targets = periods.flatMap(period => users.filter(u => u.role === "AGENT" && businessDate(u.createdAt).slice(0, 7) <= period).map(agent => {
    const sales = orders.filter(o => o.agentId === agent.id && o.saleCompletedAt && businessDate(o.saleCompletedAt).startsWith(period)).reduce((sum, o) => sum + totalCents(o.sale), 0) / 100;
    const salesTarget = Math.max(15000, Math.ceil(sales * (agent.id % 3 === 0 ? 1.3 : 0.75) / 5000) * 5000);
    return { agentId: agent.id, period, sales, salesTarget, incentive: agent.id === 8 ? 0 : 1500 + (agent.id % 3) * 500, approved: sales >= salesTarget && agent.id % 2 === 0 && agent.id !== 8 };
  }));
  return { now, start, users, customers, products, packages, orders, inventory, periods, targets };
}

export type DemoData = ReturnType<typeof buildDemoData>;
