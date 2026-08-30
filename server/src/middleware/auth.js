/**
 * Middleware JWT — menerjemahkan `Authorization: Bearer <token>` menjadi
 * req.auth = { sub, role }.
 */
import jwt from "jsonwebtoken";

export function requireAuth(req, res, next) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Token tidak ada." } });
  try {
    req.auth = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Sesi berakhir. Silakan masuk ulang." } });
  }
}

export function requireAdmin(req, res, next) {
  if (req.auth?.role !== "admin")
    return res.status(403).json({ ok: false, error: { code: "FORBIDDEN", message: "Khusus admin." } });
  next();
}

export const signToken = (user) =>
  jwt.sign({ sub: user._id.toString(), role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES || "24h",
  });
