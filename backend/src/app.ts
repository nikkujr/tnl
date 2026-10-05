import cors from "cors";
import express from "express";
import helmet from "helmet";
import { config } from "./config.js";
import authRoutes from "./features/auth/route.js";
import accountRoutes from "./features/account/route.js";
import categoryRoutes from "./features/categories/route.js";
import agentRoutes from "./features/agents/route.js";
import performanceRoutes from "./features/performance/route.js";
import campaignRoutes from "./features/campaigns/route.js";
import commissionRoutes from "./features/commissions/route.js";
import leadRoutes from "./features/leads/route.js";
import customerRoutes from "./features/customers/route.js";
import dashboardRoutes from "./features/dashboard/route.js";
import reportRoutes from "./features/reports/route.js";
import importRoutes from "./features/imports/route.js";
import orderRoutes from "./features/orders/route.js";
import productRoutes from "./features/products/route.js";
import trackingRoutes from "./features/tracking/route.js";
import { deliveryRouter, customerDeliveryRouter } from "./features/delivery/route.js";
import { employeeRouter } from "./features/delivery/employees.js";
import { errorHandler, notFound } from "./shared/http.js";
import packageRoutes from "./features/packages/route.js";
import catalogRoutes from "./features/catalog/route.js";
import customerAuthRoutes from "./features/customer-auth/route.js";
import {
  customerRouter,
  staffRouter,
} from "./features/customer-portal/route.js";
import {
  automationRouter,
  notificationRouter,
} from "./features/automations/route.js";

export const app = express();
app.set("trust proxy", config.TRUST_PROXY);
app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: config.corsOrigins, credentials: false }));
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api/v1/packages", packageRoutes);
app.use("/api/v1/catalog", catalogRoutes);
app.use("/api/v1/customer-auth", customerAuthRoutes);
app.use("/api/v1/delivery", deliveryRouter);
app.use("/api/v1/delivery-employees", employeeRouter);
app.use("/api/v1/customer/orders", customerDeliveryRouter);
app.use("/api/v1/customer", customerRouter);
app.use("/api/v1/requests", staffRouter);
app.use("/api/v1/automations", automationRouter);
app.use("/api/v1/notifications", notificationRouter);
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/account", accountRoutes);
app.use("/api/v1/agents", agentRoutes);
app.use("/api/v1/performance", performanceRoutes);
app.use("/api/v1/campaigns", campaignRoutes);
app.use("/api/v1/commissions", commissionRoutes);
app.use("/api/v1/leads", leadRoutes);
app.use("/api/v1/categories", categoryRoutes);
app.use("/api/v1/dashboard", dashboardRoutes);
app.use("/api/v1/reports", reportRoutes);
app.use("/api/v1/customers", customerRoutes);
app.use("/api/v1/products", productRoutes);
app.use("/api/v1/orders", orderRoutes);
app.use("/api/v1/imports", importRoutes);
app.use("/api/v1/tracking", trackingRoutes);
app.use(notFound);
app.use(errorHandler);
