#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const stylesRoot = path.join(root, "src", "renderer", "src", "styles");
const entryFile = path.join(stylesRoot, "app.css");
const cssFilePattern = /\.css$/i;
const importPattern = /@import\s+(?:url\()?\s*["']([^"']+)["']\s*\)?\s*;/g;

function display(file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function stripComments(source, file) {
  let output = "";
  let inComment = false;
  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];
    if (!inComment && current === "/" && next === "*") {
      inComment = true;
      output += "  ";
      index += 1;
      continue;
    }
    if (inComment && current === "*" && next === "/") {
      inComment = false;
      output += "  ";
      index += 1;
      continue;
    }
    output += inComment && current !== "\n" ? " " : current;
  }
  if (inComment) throw new Error(`${display(file)}: unterminated CSS comment`);
  if (/\*\//.test(output)) throw new Error(`${display(file)}: stray CSS comment terminator`);
  return output;
}

function assertBalancedBraces(source, file) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (!escaped && char === quote) quote = null;
      escaped = !escaped && char === "\\";
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      escaped = false;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth < 0) throw new Error(`${display(file)}: unexpected closing brace at offset ${index}`);
    }
  }
  if (depth !== 0) throw new Error(`${display(file)}: unbalanced CSS braces (${depth})`);
}

async function listCssFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return listCssFiles(full);
    return entry.isFile() && cssFilePattern.test(entry.name) ? [full] : [];
  }));
  return nested.flat();
}

async function validateImports(file, source) {
  const imports = [];
  importPattern.lastIndex = 0;
  let match;
  while ((match = importPattern.exec(source))) {
    const request = match[1];
    if (!request.startsWith(".")) continue;
    const target = path.resolve(path.dirname(file), request);
    try {
      const stat = await fs.stat(target);
      if (!stat.isFile()) throw new Error("not a file");
    } catch {
      throw new Error(`${display(file)}: missing @import target ${request}`);
    }
    imports.push(target);
  }
  return imports;
}

async function main() {
  const files = await listCssFiles(stylesRoot);
  const importedByEntry = await validateImports(entryFile, await fs.readFile(entryFile, "utf8"));
  const importedSet = new Set(importedByEntry.map((file) => path.resolve(file)));
  const failures = [];

  for (const file of files) {
    try {
      const source = await fs.readFile(file, "utf8");
      const withoutComments = stripComments(source, file);
      assertBalancedBraces(withoutComments, file);
      await validateImports(file, withoutComments);
      if (file !== entryFile && !importedSet.has(path.resolve(file))) {
        failures.push(`${display(file)}: stylesheet is not imported from app.css`);
      }
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (failures.length) {
    console.error("Style checks failed:");
    failures.forEach((failure) => console.error(`- ${failure}`));
    process.exitCode = 1;
    return;
  }
  console.log(`Style checks passed (${files.length} stylesheet files).`);
}

await main();
