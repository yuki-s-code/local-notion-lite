import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const requiredPackages = [
  '@duckdb/node-api/package.json',
  '@duckdb/node-bindings/package.json',
  '@duckdb/node-bindings-win32-x64/package.json',
];

for (const packageName of requiredPackages) {
  try {
    require.resolve(packageName);
  } catch {
    throw new Error(`Windows用DuckDB依存「${packageName}」がありません。Windows環境で npm install を実行してからパッケージ化してください。Macでは GitHub Actions の Windows ビルドを利用してください。`);
  }
}

let bindingPath;
try {
  bindingPath = require.resolve('@duckdb/node-bindings-win32-x64/duckdb.node');
} catch {
  throw new Error('Windows x64 用 DuckDB ネイティブバインディング（duckdb.node）が見つかりません。');
}
const dllPath = path.join(path.dirname(bindingPath), 'duckdb.dll');
if (!fs.existsSync(dllPath)) {
  throw new Error(`DuckDB DLL が見つかりません: ${dllPath}`);
}
console.log(`DuckDB Windows native files verified: ${bindingPath}`);
console.log('Next step: npm run rebuild:native (rebuilds better-sqlite3 and @duckdb/node-bindings for Electron).');
