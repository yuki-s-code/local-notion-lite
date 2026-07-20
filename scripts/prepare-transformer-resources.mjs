import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const wasmDir = path.join(root, 'resources', 'wasm');
const candidates = [
  path.join(root, 'node_modules', 'onnxruntime-web', 'dist'),
  path.join(root, 'node_modules', '@huggingface', 'transformers', 'dist'),
];

fs.mkdirSync(wasmDir, { recursive: true });
let copied = 0;

for (const dir of candidates) {
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.wasm')) continue;
    fs.copyFileSync(path.join(dir, file), path.join(wasmDir, file));
    copied += 1;
  }
}

console.log(`[transformer-resources] copied wasm files: ${copied}`);
console.log(`[transformer-resources] wasm dir: ${wasmDir}`);
console.log('[transformer-resources] v238 external model mode: model files are not packaged. Configure modelRoot in Smart Assist admin.');
