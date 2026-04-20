#!/usr/bin/env node
import process from "node:process";

async function main(): Promise<void> {
  console.log("shopify-changelog-check: scaffold only — pipeline lands in M2+");
  process.exitCode = 0;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
