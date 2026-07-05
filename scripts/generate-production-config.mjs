#!/usr/bin/env node
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const basePath = path.join(root, "wrangler.jsonc");
const examplePath = path.join(root, "wrangler.production.jsonc.example");
const productionPath = path.join(root, "wrangler.production.jsonc");

const requireConfig = process.argv.includes("--require");

function isCiBuild() {
  return (
    process.env.CI === "true" ||
    process.env.CF_PAGES === "1" ||
    process.env.WORKERS_CI === "1" ||
    fs.existsSync("/opt/buildhome")
  );
}

function shouldResolveProduction() {
  return requireConfig || isCiBuild();
}

function readDatabaseName() {
  const content = fs.readFileSync(basePath, "utf8");
  const match = content.match(/"database_name"\s*:\s*"([^"]+)"/);
  return match?.[1] ?? "ternssh";
}

function readIdsFromFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const d1Match = content.match(/"database_id"\s*:\s*"([^"]+)"/);
  const accountMatch = content.match(/"account_id"\s*:\s*"([^"]+)"/);

  const d1 = d1Match?.[1]?.trim();
  if (!d1 || d1 === "local-ternssh-db" || d1.includes("__")) {
    return null;
  }

  const account = accountMatch?.[1]?.trim();
  return {
    d1,
    account: account && !account.includes("__") ? account : undefined,
  };
}

function discoverD1FromCloudflare(databaseName) {
  try {
    const env = { ...process.env };
    const accountId =
      process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ||
      process.env.CF_ACCOUNT_ID?.trim();
    if (accountId) {
      env.CLOUDFLARE_ACCOUNT_ID = accountId;
    }

    console.log(
      `Looking up remote D1 database "${databaseName}" via wrangler d1 list...`,
    );

    const output = execSync("npx wrangler d1 list --json", {
      cwd: root,
      encoding: "utf8",
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const databases = JSON.parse(output);
    const matches = databases.filter((db) => db.name === databaseName);

    if (matches.length === 0) {
      console.warn(`No remote D1 database named "${databaseName}" found.`);
      return null;
    }

    if (matches.length > 1) {
      console.warn(
        `Multiple D1 databases named "${databaseName}", using ${matches[0].uuid}.`,
      );
    }

    console.log(
      `Auto-discovered D1 database "${databaseName}" → ${matches[0].uuid}`,
    );
    return {
      d1: matches[0].uuid,
      account: accountId || undefined,
    };
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? String(error.stderr)
        : "";
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Auto-discover D1 failed: ${stderr || message}`);
    return null;
  }
}

function resolveProductionIds() {
  const envD1 = process.env.D1_DATABASE_ID?.trim();
  if (envD1) {
    console.log("Using D1_DATABASE_ID from environment.");
    return {
      d1: envD1,
      account:
        process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ||
        process.env.CF_ACCOUNT_ID?.trim() ||
        undefined,
    };
  }

  if (shouldResolveProduction()) {
    const discovered = discoverD1FromCloudflare(readDatabaseName());
    if (discovered) return discovered;
  }

  if (fs.existsSync(productionPath)) {
    const fromFile = readIdsFromFile(productionPath);
    if (fromFile) {
      console.log("Using wrangler.production.jsonc.");
      return fromFile;
    }
  }

  return null;
}

function writeProductionFile(ids) {
  let content = fs.readFileSync(examplePath, "utf8");
  content = content.replaceAll("__D1_DATABASE_ID__", ids.d1);

  if (ids.account) {
    content = content.replaceAll("__CLOUDFLARE_ACCOUNT_ID__", ids.account);
  } else {
    content = content.replace(/^\s*"account_id": "__CLOUDFLARE_ACCOUNT_ID__",\n/m, "");
  }

  fs.writeFileSync(productionPath, content);
}

function patchWranglerJsonc(ids) {
  let content = fs.readFileSync(basePath, "utf8");

  if (!/"d1_databases"\s*:/.test(content)) {
    throw new Error("wrangler.jsonc is missing d1_databases configuration.");
  }

  const currentIdMatch = content.match(/"database_id"\s*:\s*"([^"]*)"/);
  const currentId = currentIdMatch?.[1];

  if (currentId === ids.d1) {
    return;
  }

  if (!currentIdMatch) {
    throw new Error("wrangler.jsonc is missing database_id in d1_databases.");
  }

  content = content.replace(
    /"database_id"\s*:\s*"[^"]*"/,
    `"database_id": "${ids.d1}"`,
  );

  if (ids.account) {
    if (/^\s*"account_id"/m.test(content)) {
      content = content.replace(
        /"account_id"\s*:\s*"[^"]*"/,
        `"account_id": "${ids.account}"`,
      );
    } else {
      content = content.replace(
        /("name"\s*:\s*"ternssh",\n)/,
        `$1  "account_id": "${ids.account}",\n`,
      );
    }
  } else {
    content = content.replace(/^\s*"account_id"\s*:\s*"[^"]*",\n/m, "");
  }

  fs.writeFileSync(basePath, content);
}

function printSetupHelp(databaseName) {
  console.error(
    [
      "Missing production D1 config for deploy.",
      "",
      "Cloudflare Workers Builds:",
      "  1. Ensure a D1 database named \"" + databaseName + "\" exists on this account",
      "  2. Build command:  npm run build",
      "  3. Deploy command: npm run cf:deploy",
      "",
      "Or set build environment variable:",
      "  D1_DATABASE_ID=<uuid from: wrangler d1 list>",
      "",
      "Local manual deploy:",
      "  npm run deploy:config && edit wrangler.production.jsonc && npm run deploy",
    ].join("\n"),
  );
}

console.log(
  `[generate-production-config] ci=${isCiBuild()} require=${requireConfig}`,
);

const ids = resolveProductionIds();

if (!ids) {
  if (shouldResolveProduction()) {
    printSetupHelp(readDatabaseName());
    process.exit(1);
  }

  console.log("Skipping production Wrangler config (local development).");
  process.exit(0);
}

writeProductionFile(ids);
patchWranglerJsonc(ids);
console.log(`Wrote ${path.relative(root, productionPath)}`);
if (readIdsFromFile(basePath)?.d1 === ids.d1) {
  console.log(`Production D1 binding (${ids.d1}) ready.`);
} else {
  console.log(`Applied production D1 binding (${ids.d1}) to wrangler.jsonc for deploy.`);
}
