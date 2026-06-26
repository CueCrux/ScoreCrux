// GlassBox — receipt signing + verification (Art 12).
//
// Every governed action produces an Ed25519-signed receipt over the canonical
// JSON of the action, chained by prev_hash so a run is tamper-evident and
// replayable from receipts alone. The CueCrux daemon signs natively; when it is
// reachable the adapter prefers a daemon receipt (signer="crux-daemon"), else it
// falls back to this bench-local signer (signer="glassbox-local"). Either way the
// receipt is cryptographically verifiable — the `signer` field keeps provenance
// transparent.

import { createHash, generateKeyPairSync, sign as edSign, verify as edVerify, createPublicKey } from "node:crypto";

export interface SignedReceipt {
  receiptId: string;
  alg: "ed25519";
  signer: string;
  keyId: string;
  signedAt: string;
  payloadHash: string; // sha256 hex of canonical(payload)
  prevHash: string;
  signature: string; // base64
}

/** Deterministic, key-sorted JSON for stable hashing. */
export function canonicalJson(obj: unknown): string {
  const seen = new WeakSet();
  const norm = (v: any): any => {
    if (v && typeof v === "object") {
      if (seen.has(v)) return null;
      seen.add(v);
      if (Array.isArray(v)) return v.map(norm);
      return Object.keys(v).sort().reduce((acc, k) => { acc[k] = norm(v[k]); return acc; }, {} as any);
    }
    return v;
  };
  return JSON.stringify(norm(obj));
}

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

export class ReceiptSigner {
  readonly signer: string;
  readonly publicKeyPem: string;
  readonly keyId: string;
  private privateKey;
  private prevHash = "genesis";
  private seq = 0;

  constructor(signer = "glassbox-local") {
    this.signer = signer;
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    this.privateKey = privateKey;
    this.publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
    this.keyId = sha256Hex(this.publicKeyPem).slice(0, 16);
  }

  sign(payload: unknown): SignedReceipt {
    const canonical = canonicalJson(payload);
    const payloadHash = sha256Hex(canonical);
    const signedAt = new Date().toISOString();
    const receiptId = `rcpt_${this.signer}_${this.seq++}_${payloadHash.slice(0, 8)}`;
    // sign over (payloadHash || prevHash || receiptId) so the chain is bound in
    const message = Buffer.from(`${payloadHash}.${this.prevHash}.${receiptId}.${signedAt}`);
    const signature = edSign(null, message, this.privateKey).toString("base64");
    const receipt: SignedReceipt = {
      receiptId, alg: "ed25519", signer: this.signer, keyId: this.keyId,
      signedAt, payloadHash, prevHash: this.prevHash, signature,
    };
    this.prevHash = payloadHash;
    return receipt;
  }
}

/** Verify a receipt against the original payload + the signer's public key. */
export function verifyReceipt(receipt: SignedReceipt, payload: unknown, publicKeyPem: string): boolean {
  try {
    const payloadHash = sha256Hex(canonicalJson(payload));
    if (payloadHash !== receipt.payloadHash) return false;
    const message = Buffer.from(`${receipt.payloadHash}.${receipt.prevHash}.${receipt.receiptId}.${receipt.signedAt}`);
    return edVerify(null, message, createPublicKey(publicKeyPem), Buffer.from(receipt.signature, "base64"));
  } catch {
    return false;
  }
}
