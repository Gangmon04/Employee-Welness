'use strict';

const PMS_BASE_URL = 'https://pms.zohosolution.in/crm';
const CLIENT_ID = process.env.CLIENT_ID || '1000.EZPFZAMB3KX0U25576GGO0R7UHWZAM';
const CLIENT_SECRET = process.env.CLIENT_SECRET || 'b7b5cb21b9f01a92e74167c4084e87987a86460a48';
const SOID = process.env.SOID || 'Solution.60087134054';
const SCOPES = process.env.SCOPES || 'Solution.org.ALL,Solution.coql.READ,Solution.settings.ALL,Solution.modules.ALL,Solution.users.ALL';

let cachedToken = process.env.PMS_TOKEN || null;
let tokenExpiryTime = 0;

async function getAccessToken() {
	const now = Date.now();
	if (cachedToken && now < tokenExpiryTime) {
		return cachedToken;
	}

	try {
		const params = new URLSearchParams({
			grant_type: 'client_credentials',
			client_id: CLIENT_ID,
			client_secret: CLIENT_SECRET,
			scope: SCOPES,
			soid: SOID
		});

		const res = await fetch('https://accounts.zoho.in/oauth/v2/token', {
			method: 'POST',
			body: params
		});

		const rawText = await res.text();
		const data = JSON.parse(rawText);

		if (data.access_token) {
			cachedToken = data.access_token;
			tokenExpiryTime = now + ((data.expires_in || 3600) - 300) * 1000;
			return cachedToken;
		}
		console.warn('Zoho accounts token response error:', rawText.slice(0, 200));
	} catch (err) {
		console.warn('OAuth refresh error, using cached token if available:', err.message);
	}

	if (cachedToken) {
		return cachedToken;
	}

	throw new Error('Unable to authenticate with Zoho Accounts. Please try again later.');
}

/**
 * Server-side ZRC (Zoho REST Client) for Catalyst Serverless Functions.
 * Follows the standard Zoho CRM v8 REST client pattern.
 */
const zrc = {
	/**
	 * Low-level request dispatcher
	 */
	async request(method, path, body = null, options = {}) {
		let token = await getAccessToken();

		// Normalize CRM path: ensure /crm/v8 prefix if relative path provided
		let fullPath = path;
		if (!fullPath.startsWith('/crm/')) {
			const version = options.version || 'v8';
			fullPath = `/crm/${version}${fullPath.startsWith('/') ? fullPath : '/' + fullPath}`;
		}

		let url = `${PMS_BASE_URL.replace(/\/crm\/?$/, '')}${fullPath}`;

		// Append query parameters if options.params is supplied
		if (options.params && typeof options.params === 'object') {
			const q = new URLSearchParams();
			for (const [k, v] of Object.entries(options.params)) {
				if (v !== undefined && v !== null && v !== '') {
					q.set(k, String(v));
				}
			}
			const qs = q.toString();
			if (qs) {
				url += (url.includes('?') ? '&' : '?') + qs;
			}
		}

		const headers = {
			'Authorization': `Zoho-oauthtoken ${token}`,
			'Accept': 'application/json',
			...(options.headers || {})
		};

		const fetchOpts = {
			method: method.toUpperCase(),
			headers
		};

		if (body && ['POST', 'PUT', 'PATCH'].includes(fetchOpts.method)) {
			if (typeof body === 'object' && !(body instanceof Buffer)) {
				headers['Content-Type'] = 'application/json; charset=utf-8';
				fetchOpts.body = JSON.stringify(body);
			} else {
				fetchOpts.body = body;
			}
		}

		let res = await fetch(url, fetchOpts);

		// Handle token expiry / 401 retry
		if (res.status === 401 && !options._retried) {
			cachedToken = null;
			tokenExpiryTime = 0;
			token = await getAccessToken();
			headers['Authorization'] = `Zoho-oauthtoken ${token}`;
			res = await fetch(url, { ...fetchOpts, headers });
		}

		const contentType = res.headers.get('content-type') || '';
		let responseData = null;
		if (contentType.includes('application/json')) {
			responseData = await res.json().catch(() => null);
		} else {
			responseData = await res.text().catch(() => '');
		}

		return {
			status: res.status,
			ok: res.ok,
			data: responseData,
			headers: res.headers
		};
	},

	/**
	 * GET request via ZRC
	 */
	get(path, options = {}) {
		return this.request('GET', path, null, options);
	},

	/**
	 * POST request via ZRC
	 */
	post(path, body = {}, options = {}) {
		return this.request('POST', path, body, options);
	},

	/**
	 * PUT request via ZRC
	 */
	put(path, body = {}, options = {}) {
		return this.request('PUT', path, body, options);
	},

	/**
	 * PATCH request via ZRC
	 */
	patch(path, body = {}, options = {}) {
		return this.request('PATCH', path, body, options);
	},

	/**
	 * DELETE request via ZRC
	 */
	delete(path, options = {}) {
		return this.request('DELETE', path, null, options);
	},

	/**
	 * Execute a COQL (CRM Object Query Language) query via ZRC
	 * Endpoint: POST /crm/v8/coql
	 */
	async coql(selectQuery) {
		const cleanQuery = String(selectQuery).replace(/\s+/g, ' ').trim();
		return this.post('/crm/v8/coql', { select_query: cleanQuery });
	},

	/**
	 * Raw binary streaming request for images and photos
	 */
	async getRaw(path, options = {}) {
		let token = await getAccessToken();
		let url = path.startsWith('http') ? path : `${PMS_BASE_URL.replace(/\/crm\/?$/, '')}${path}`;
		const headers = {
			'Authorization': `Zoho-oauthtoken ${token}`,
			...(options.headers || {})
		};

		let res = await fetch(url, { method: 'GET', headers });
		if (res.status === 401 && !options._retried) {
			cachedToken = null;
			tokenExpiryTime = 0;
			token = await getAccessToken();
			headers['Authorization'] = `Zoho-oauthtoken ${token}`;
			res = await fetch(url, { method: 'GET', headers });
		}
		return res;
	}
};

module.exports = {
	zrc,
	getAccessToken,
	PMS_BASE_URL,
	CLIENT_ID,
	SOID
};
