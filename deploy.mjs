import { copyFileSync, cpSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import 'dotenv/config';

const PLUGIN_DIR = process.env.OBSIDIAN_PLUGIN_DIR || './dist';

console.log('Deploying plugin files to:', PLUGIN_DIR);

// Ensure plugin directory exists
if (!existsSync(PLUGIN_DIR)) {
    console.log('Creating plugin directory...');
    mkdirSync(PLUGIN_DIR, { recursive: true });
}

// Copy main plugin files
const filesToCopy = [
    'main.js',
    'manifest.json',
    'styles.css',
    'pdf.worker.min.js'
];

for (const file of filesToCopy) {
    try {
        copyFileSync(file, join(PLUGIN_DIR, file));
        console.log(`✓ Copied ${file}`);
    } catch (error) {
        console.error(`✗ Failed to copy ${file}:`, error.message);
    }
}

// Copy pkg directory
try {
    const pkgDest = join(PLUGIN_DIR, 'pkg');
    if (!existsSync(pkgDest)) {
        mkdirSync(pkgDest, { recursive: true });
    }
    cpSync('pkg', pkgDest, { recursive: true });
    console.log('✓ Copied pkg directory');
} catch (error) {
    console.error('✗ Failed to copy pkg directory:', error.message);
}

console.log('\nDeployment complete!');
