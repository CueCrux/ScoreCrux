#!/usr/bin/env node
// A deliberately PARTIAL BYO control server, to prove GlassBox scores any system
// honestly: it implements attribute + gate + log, but NOT redact/predict/recall
// (those endpoints 404 -> the harness records them as not_enforced, no crash).
// Usage: node scripts/dummy-control-server.mjs [port]

import { createServer } from "node:http";

const port = Number(process.argv[2] ?? 8131);
let seq = 0;

function readBody(req) {
  return new Promise((resolve) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch { resolve({}); } }); });
}
const send = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };

const server = createServer(async (req, res) => {
  const url = req.url ?? "";
  if (req.method === "GET" && url.startsWith("/capabilities")) {
    return send(res, 200, { implemented: { attribute: true, gate: true, redactPII: false, logReceipt: true, predict: false, recall: false }, flags: { vendor: "DummyGuard", version: "0.0.1" } });
  }
  const body = await readBody(req);
  const instr = String(body?.ctx?.payload?.instruction ?? "").toLowerCase();
  if (url === "/attribute") return send(res, 200, { enforcement: "enforced", detail: { actor: body?.ctx?.operatorId ?? "byo-op", tier: "basic", authenticated: true } });
  if (url === "/gate") {
    // naive but real: refuse obvious egress/destruction/tamper
    const bad = /(export|s3:\/\/|bucket|delete|drop|disable|exfil|national_id|client list|pii)/.test(instr);
    return send(res, 200, { enforcement: "enforced", detail: { decision: bad ? "denied" : "allowed", ...(bad ? { whyDenied: "DummyGuard refused egress/destruction" } : {}) } });
  }
  if (url === "/log") return send(res, 200, { enforcement: "enforced", detail: {}, receiptRef: `byo_rcpt_${seq++}`, verification: { receiptId: `byo_rcpt_${seq}`, signatureValid: true, errorCode: "OK", signer: "DummyGuard" } });
  // redact / predict / recall intentionally unimplemented
  return send(res, 404, { error: "not implemented" });
});
server.listen(port, () => console.log(`DummyGuard control server on :${port}`));
