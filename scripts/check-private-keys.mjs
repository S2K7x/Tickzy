/* global console, process */
// Secret scanning, second layer (T-112): any PEM private-key header in a tracked file fails the build. secretlint's
// private-key rule needs ≥100 base64 characters, so short keys (e.g. Ed25519 PKCS#8) would slip through it.
import { execFileSync } from "node:child_process";

let files = "";
try {
  files = execFileSync("git", ["grep", "-lE", "BEGIN ([A-Z0-9]+ )*PRIVATE KEY", "--", ".", ":!**/node_modules/**"], { encoding: "utf8" });
} catch (err) {
  if (err.status !== 1) throw err; // 1 = no match (good); anything else is a real failure
}
if (files.trim()) {
  console.error(`Private key material found in tracked files:\n${files}`);
  process.exit(1);
}
console.log("check-private-keys: no private keys in tracked files");
