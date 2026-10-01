import type { RequestHandler } from "express";
export function rateLimit(limit = 20, windowMs = 15 * 60000): RequestHandler {
  const buckets = new Map<string, { count: number; until: number }>();
  return (req, res, next) => {
    const now = Date.now();
    if (buckets.size > 1000)
      for (const [key, value] of buckets)
        if (value.until < now) buckets.delete(key);
    const key = req.ip ?? "unknown";
    let bucket = buckets.get(key);
    if (!bucket || bucket.until < now) {
      bucket = { count: 0, until: now + windowMs };
      buckets.set(key, bucket);
    }
    if (++bucket.count > limit) {
      res.setHeader("Retry-After", Math.ceil((bucket.until - now) / 1000));
      res
        .status(429)
        .json({ error: { message: "Too many attempts. Try again later." } });
      return;
    }
    next();
  };
}
