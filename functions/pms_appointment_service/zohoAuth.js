'use strict';

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const SOID = process.env.SOID;
const SCOPES = process.env.SCOPES;

let cachedToken = null;
let tokenExpiryTime = 0;
let pendingTokenPromise = null;
let rateLimitedUntil = 0;

/**
 * Fetches and caches the Zoho OAuth token via Client Credentials (auto-refreshes every 55 mins).
 */
async function getAccessToken() {
	const now = Date.now();
	if (cachedToken && now < tokenExpiryTime) {
		return cachedToken;
	}

	// 1. If rate-limited recently and we have an existing token, reuse it
	if (now < rateLimitedUntil && cachedToken) {
		return cachedToken;
	}

	// 2. Deduplicate concurrent token requests
	if (pendingTokenPromise) {
		return pendingTokenPromise;
	}

	pendingTokenPromise = (async () => {
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
			let data = {};
			try { data = JSON.parse(rawText); } catch (pe) {}

			if (data.access_token) {
				cachedToken = data.access_token;
				tokenExpiryTime = Date.now() + ((data.expires_in || 3600) - 300) * 1000;
				return cachedToken;
			}

			if (rawText.includes('too many requests')) {
				rateLimitedUntil = Date.now() + 30000;
			}

			console.warn('Zoho accounts token response error:', rawText.slice(0, 200));
		} catch (err) {
			console.warn('OAuth refresh error, using cached token if available:', err.message);
		} finally {
			pendingTokenPromise = null;
		}

		if (cachedToken) {
			return cachedToken;
		}

		throw new Error('Unable to authenticate with Zoho Accounts. Please try again later.');
	})();

	return pendingTokenPromise;
}

function clearAccessToken() {
	cachedToken = null;
	tokenExpiryTime = 0;
}

module.exports = {
	getAccessToken,
	clearAccessToken
};
