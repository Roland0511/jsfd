const fs = require('fs');
const path = require('path');
const os = require('os');

// Cache directory setup - use user's home directory for npm package
const CACHE_DIR = path.join(os.homedir(), '.jafd', 'cache');
const CACHE_ASSETS_DIR = path.join(CACHE_DIR, 'assets');
const CACHE_DOCS_DIR = path.join(CACHE_DIR, 'docs');

function ensureCacheDirs() {
    if (!fs.existsSync(CACHE_DIR)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
    }
    if (!fs.existsSync(CACHE_ASSETS_DIR)) {
        fs.mkdirSync(CACHE_ASSETS_DIR, { recursive: true });
    }
    if (!fs.existsSync(CACHE_DOCS_DIR)) {
        fs.mkdirSync(CACHE_DOCS_DIR, { recursive: true });
    }
}

function getCacheDocPath(docToken, isSheet = false, sheetName = null) {
    if (isSheet && sheetName) {
        const sanitizedSheetName = sheetName.replace(/[<>:"/\\|?*]+/g, '_').trim();
        return path.join(CACHE_DOCS_DIR, `${docToken}_${sanitizedSheetName}.csv`);
    }
    const ext = isSheet ? 'csv' : 'md';
    return path.join(CACHE_DOCS_DIR, `${docToken}.${ext}`);
}

function isCacheValid(docToken, isSheet = false) {
    // For sheet, we check if at least one sheet file exists and is fresh
    if (isSheet) {
        try {
            const files = fs.readdirSync(CACHE_DOCS_DIR, { withFileTypes: true });
            const now = Date.now();
            for (const file of files) {
                if (file.isFile() && file.name.startsWith(`${docToken}_`) && file.name.endsWith('.csv')) {
                    const stat = fs.statSync(path.join(CACHE_DOCS_DIR, file.name));
                    if ((now - stat.mtimeMs) < 3600000) {
                        return true;
                    }
                }
            }
        } catch (e) {
            // Ignore errors
        }
        return false;
    }

    const docPath = getCacheDocPath(docToken, false);
    if (!fs.existsSync(docPath)) {
        return false;
    }
    // Check if cache is younger than 1 hour (3600000 ms)
    const stat = fs.statSync(docPath);
    const now = Date.now();
    return (now - stat.mtimeMs) < 3600000;
}

function sanitizeSheetName(name) {
    return name.replace(/[<>:"/\\|?*]+/g, '_').trim();
}

module.exports = {
    CACHE_DIR,
    CACHE_ASSETS_DIR,
    CACHE_DOCS_DIR,
    ensureCacheDirs,
    getCacheDocPath,
    isCacheValid,
    sanitizeSheetName
};
