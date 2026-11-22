#!/usr/bin/env node
/**
 * Verifies Chrome extension identity from a CRX3 file.
 * Does NOT require or expose the private signing key.
 */
import crypto from "node:crypto";
import fs from "node:fs";

function crx3PublicKeys(buf) {
  if (buf.subarray(0, 4).toString() !== "Cr24") throw new Error("Not a CRX");
  const version = buf.readUInt32LE(4);
  if (version !== 3) throw new Error(`Unsupported CRX version ${version}`);
  const headerSize = buf.readUInt32LE(8);
  const header = buf.subarray(12, 12 + headerSize);
  // CRX3 header is a binary protobuf; public keys appear as raw SPKI blobs.
  // Heuristic: find DER SEQUENCE (0x30) of plausible SPKI length containing rsaEncryption OID.
  const keys = [];
  const oid = Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01]);
  let i = 0;
  while (i < header.length - 40) {
    if (header[i] === 0x30) {
      const lenByte = header[i + 1];
      let len;
      let headerLen;
      if (lenByte < 0x80) {
        len = lenByte;
        headerLen = 2;
      } else if (lenByte === 0x82) {
        len = (header[i + 2] << 8) | header[i + 3];
        headerLen = 4;
      } else if (lenByte === 0x81) {
        len = header[i + 2];
        headerLen = 3;
      } else {
        i += 1;
        continue;
      }
      const total = headerLen + len;
      if (total > 64 && total < 3000 && i + total <= header.length) {
        const candidate = header.subarray(i, i + total);
        if (candidate.includes(oid)) keys.push(candidate);
        i += total;
        continue;
      }
    }
    i += 1;
  }
  return keys;
}

function extensionIdFromSpki(spki) {
  const hash = crypto.createHash("sha256").update(spki).digest();
  return [...hash.subarray(0, 16)]
    .flatMap((b) => [b >> 4, b & 0xf])
    .map((n) => String.fromCharCode(n + "a".charCodeAt(0)))
    .join("");
}

const crxPath = process.argv[2];
const expectedId = process.argv[3] || "mmnpdojjfbdjgjgpdmmmilbighjehfee";
if (!crxPath) {
  console.error("Usage: node scripts/verify-extension-id.mjs <file.crx> [expectedId]");
  process.exit(2);
}

const buf = fs.readFileSync(crxPath);
const keys = crx3PublicKeys(buf);
const ids = keys.map(extensionIdFromSpki);
const match = ids.includes(expectedId);

console.log(
  JSON.stringify(
    {
      crxPath,
      expectedId,
      publicKeyCount: keys.length,
      derivedIds: ids,
      match,
    },
    null,
    2,
  ),
);

process.exit(match ? 0 : 1);
