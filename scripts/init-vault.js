import fs from 'fs-extra';
import path from 'node:path';
const root = process.argv[2];
if (!root) {
    console.error('Usage: npm run init:vault -- "Z:\\YourAppVault"');
    process.exit(1);
}
for (const dir of ['pages', 'attachments', 'locks', 'backups', 'local-cache']) {
    fs.ensureDirSync(path.join(root, dir));
}
const manifest = path.join(root, 'manifest.json');
if (!fs.pathExistsSync(manifest)) {
    fs.writeJsonSync(manifest, { version: 1, updatedAt: new Date().toISOString(), pages: [] }, { spaces: 2 });
}
console.log(`Initialized vault: ${root}`);
