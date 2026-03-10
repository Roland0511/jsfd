const fs = require('fs');
const path = require('path');
const os = require('os');

// Robust .env loading
const possibleEnvPaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(os.homedir(), '.jsfd', '.env'),
  path.resolve(os.homedir(), '.env'),
  path.resolve(__dirname, '../.env')
];

let envLoaded = false;
for (const envPath of possibleEnvPaths) {
  if (fs.existsSync(envPath)) {
    try {
      require('dotenv').config({ path: envPath, quiet: true });
      envLoaded = true;
      break;
    } catch (e) {
      // Ignore load error
    }
  }
}

let config = {};
try {
    const possibleConfigPaths = [
        path.resolve(process.cwd(), 'jsfd.json'),
        path.resolve(process.cwd(), 'config.json'),
        path.resolve(os.homedir(), '.jsfd', 'config.json'),
        path.resolve(__dirname, '../config.json')
    ];
    for (const configPath of possibleConfigPaths) {
        if (fs.existsSync(configPath)) {
            config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
            break;
        }
    }
} catch (e) {
    console.warn('[FeishuClient] Failed to load config.json:', e.message);
}

const APP_ID = config.app_id || process.env.FEISHU_APP_ID;
const APP_SECRET = config.app_secret || process.env.FEISHU_APP_SECRET;

// Token cache files in user's home directory
const TOKEN_CACHE_FILE = path.resolve(os.homedir(), '.jsfd', 'cache', 'feishu_token.json');
const TOKEN_CACHE_FILE_LAGECY = TOKEN_CACHE_FILE;

/**
 * Robust Fetch with Retry (Exponential Backoff)
 */
async function fetchWithRetry(url, options = {}, retries = 3) {
    const timeoutMs = options.timeout || 15000;
    
    for (let i = 0; i < retries; i++) {
        let timeoutId;
        try {
            const controller = new AbortController();
            timeoutId = setTimeout(() => controller.abort(), timeoutMs);
            const fetchOptions = { ...options, signal: controller.signal };
            delete fetchOptions.timeout; 

            const res = await fetch(url, fetchOptions);
            clearTimeout(timeoutId);

            if (!res.ok) {
                // Rate Limiting (429)
                if (res.status === 429) {
                    const retryAfter = res.headers.get('Retry-After');
                    let waitMs = 1000 * Math.pow(2, i);
                    if (retryAfter) waitMs = parseInt(retryAfter, 10) * 1000;
                    console.warn(`[FeishuClient] Rate limited. Waiting ${waitMs}ms...`);
                    await new Promise(r => setTimeout(r, waitMs));
                    continue; 
                }
                
                // Do not retry 4xx errors (except 429), usually auth or param errors
                if (res.status >= 400 && res.status < 500) {
                    const errBody = await res.text();
                    throw new Error(`HTTP ${res.status} [${url}]: ${errBody}`);
                }
                throw new Error(`HTTP ${res.status} ${res.statusText} [${url}]`);
            }
            return res;
        } catch (e) {
            if (timeoutId) clearTimeout(timeoutId);
            if (e.name === 'AbortError') e.message = `Timeout (${timeoutMs}ms) [${url}]`;
            
            // Don't retry if it's a permanent error
            if (e.message.includes('HTTP 4') && !e.message.includes('429')) throw e;
            
            if (i === retries - 1) throw e;
            const delay = 1000 * Math.pow(2, i);
            console.warn(`[FeishuClient] Fetch failed (${e.message}) [${url}]. Retrying in ${delay}ms...`);
            await new Promise(r => setTimeout(r, delay));
        }
    }
}

/**
 * Get Tenant Access Token (Cached)
 */
async function getToken(forceRefresh = false) {
    const now = Math.floor(Date.now() / 1000);

    const cacheFile = fs.existsSync(TOKEN_CACHE_FILE_LAGECY) ? TOKEN_CACHE_FILE_LAGECY : TOKEN_CACHE_FILE;

    if (!forceRefresh && fs.existsSync(cacheFile)) {
        try {
            const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
            const expiry = cached.expire || cached.expireTime;
            if (cached.token && expiry > now + 60) return cached.token;
        } catch (e) {}
    }

    if (!APP_ID || !APP_SECRET) {
      throw new Error("Missing app_id or app_secret. Please set FEISHU_APP_ID and FEISHU_APP_SECRET environment variables or create a config.json file.");
    }

    try {
        const res = await fetchWithRetry('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET })
        });
        const data = await res.json();

        if (data.code !== 0) throw new Error(`API Error: ${data.msg}`);
        
        try {
            const cacheData = { token: data.tenant_access_token, expire: now + data.expire };
            const cacheDir = path.dirname(TOKEN_CACHE_FILE);
            if (!fs.existsSync(cacheDir)) {
                fs.mkdirSync(cacheDir, { recursive: true });
            }
            fs.writeFileSync(TOKEN_CACHE_FILE, JSON.stringify(cacheData, null, 2));
        } catch (e) {}

        return data.tenant_access_token;
    } catch (e) {
        console.error('[FeishuClient] Failed to get token:', e.message);
        throw e;
    }
}

/**
 * Authenticated Fetch with Auto-Refresh
 */
async function fetchWithAuth(url, options = {}) {
    let token = await getToken();
    let headers = { ...options.headers, 'Authorization': `Bearer ${token}` };
    
    try {
        let res = await fetchWithRetry(url, { ...options, headers });
        
        // Handle JSON Logic Errors (200 OK but code != 0)
        const clone = res.clone();
        try {
            const data = await clone.json();
            // Codes for invalid token: 99991663, 99991664, 99991661, 99991668
            if ([99991663, 99991664, 99991661, 99991668].includes(data.code)) {
                throw new Error('TokenExpired');
            }
        } catch (jsonErr) {
            // If response isn't JSON or TokenExpired, ignore here
            if (jsonErr.message === 'TokenExpired') throw jsonErr;
        }
        
        return res;

    } catch (e) {
        if (e.message.includes('HTTP 401') || e.message === 'TokenExpired') {
            console.warn(`[FeishuClient] Token expired. Refreshing...`);
            token = await getToken(true);
            headers = { ...options.headers, 'Authorization': `Bearer ${token}` };
            return await fetchWithRetry(url, { ...options, headers });
        }
        throw e;
    }
}

module.exports = { 
  getToken, 
  getTenantAccessToken: getToken, 
  fetchWithRetry, 
  fetchWithAuth 
};
