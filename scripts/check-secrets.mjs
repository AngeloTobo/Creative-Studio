import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((file) => !file.endsWith("package-lock.json"));

const signatures = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ["GitHub token", /gh[pousr]_[A-Za-z0-9]{30,}/],
  ["OpenAI-style token", /sk-(?:proj-)?[A-Za-z0-9_-]{20,}/],
  ["Cloudflare API token", /(?:CF_API_TOKEN|CLOUDFLARE_API_TOKEN)\s*=\s*[^\s#][^\r\n]{15,}/],
  ["Creative Studio service token", /AFDFW_SERVICE_TOKEN\s*=\s*[^\s#][^\r\n]{15,}/],
  ["Creative Studio runner token", /csr_[A-Za-z0-9_-]{40,80}/],
];

const findings = [];
for (const file of files) {
  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const [label, signature] of signatures) {
    if (signature.test(content)) findings.push(`${file}: possible ${label}`);
  }
}

if (findings.length) {
  console.error(findings.join("\n"));
  process.exit(1);
}
console.log(`Secret signature scan clean across ${files.length} source files.`);
