import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const defaultModelId = process.env.SMART_ASSIST_MODEL_ID || 'sirasagi62/ruri-v3-70m-ONNX';
const modelRoot = process.env.SMART_ASSIST_MODEL_ROOT || '';
const wasmDir = path.join(root, 'resources', 'wasm');
const missing = [];

const wasmCount = fs.existsSync(wasmDir)
  ? fs.readdirSync(wasmDir).filter((name) => name.endsWith('.wasm')).length
  : 0;

if (!wasmCount) {
  missing.push('resources/wasm/*.wasm');
}

// v243 policy: model bodies are external by default. The Windows artifact should not
// include large ONNX files. When SMART_ASSIST_MODEL_ROOT is explicitly provided,
// validate that external model folder too.
if (modelRoot) {
  const modelDir = path.join(modelRoot, ...defaultModelId.split('/').filter(Boolean));
  const requiredFiles = [
    'config.json',
    'tokenizer.json',
    'tokenizer_config.json',
  ];

  for (const file of requiredFiles) {
    const fullPath = path.join(modelDir, file);
    if (!fs.existsSync(fullPath)) missing.push(fullPath);
  }

  const quantizedModelPath = path.join(modelDir, 'onnx', 'model_quantized.onnx');
  const plainModelPath = path.join(modelDir, 'onnx', 'model.onnx');
  const quantizedSize = fs.existsSync(quantizedModelPath) ? fs.statSync(quantizedModelPath).size : 0;
  const plainSize = fs.existsSync(plainModelPath) ? fs.statSync(plainModelPath).size : 0;
  if (quantizedSize < 10 * 1024 * 1024 && plainSize < 10 * 1024 * 1024) {
    missing.push(`${path.join(modelDir, 'onnx')} must contain model_quantized.onnx or model.onnx larger than 10MB.`);
  }
}

if (missing.length) {
  console.error('[transformer-resources] missing or invalid resources:');
  for (const item of missing) console.error(`- ${item}`);
  console.error('\nWASM must be included in the app. Model files are external by default; set SMART_ASSIST_MODEL_ROOT only when you want this script to validate a local model folder.');
  process.exitCode = 1;
} else {
  console.log('[transformer-resources] OK: WASM resources are ready.');
  console.log(`[transformer-resources] wasm files: ${wasmCount}`);
  if (modelRoot) {
    console.log(`[transformer-resources] external model checked: ${defaultModelId}`);
    console.log(`[transformer-resources] external model root: ${modelRoot}`);
  } else {
    console.log('[transformer-resources] external model mode: model files are configured at runtime from Smart Assist admin.');
  }
}
