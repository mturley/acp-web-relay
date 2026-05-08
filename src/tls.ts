import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { generate } from "selfsigned";

const CERT_FILE = "cert.pem";
const KEY_FILE = "key.pem";

export interface TlsFiles {
  key: string;
  cert: string;
}

export async function ensureCert(dir: string): Promise<TlsFiles> {
  await mkdir(dir, { recursive: true });

  const certPath = join(dir, CERT_FILE);
  const keyPath = join(dir, KEY_FILE);

  if (existsSync(certPath) && existsSync(keyPath)) {
    const [cert, key] = await Promise.all([
      readFile(certPath, "utf-8"),
      readFile(keyPath, "utf-8"),
    ]);
    return { key, cert };
  }

  console.error("  Generating self-signed TLS certificate...");

  const notAfterDate = new Date();
  notAfterDate.setFullYear(notAfterDate.getFullYear() + 5);

  const attrs = [{ name: "commonName", value: "acp-web-relay" }];
  const pems = await generate(attrs, {
    keySize: 2048,
    algorithm: "sha256",
    notAfterDate,
  });

  await Promise.all([
    writeFile(certPath, pems.cert, "utf-8"),
    writeFile(keyPath, pems.private, "utf-8"),
  ]);

  console.error("  Certificate saved to ~/.acp-web-relay/");

  return { key: pems.private, cert: pems.cert };
}
