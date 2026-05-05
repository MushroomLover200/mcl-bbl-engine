const axios = require('axios');
const { EventEmitter } = require('events');

const BASE_URL = 'https://mcl.blackboard.com';

/**
 * Handles authentication and session maintenance using Axios.
 */
class SessionManager extends EventEmitter {
    constructor({ username, password }) {
        super();
        this.username = username;
        this.password = password;

        this.cookie = null;
        this.userData = null;
        this.refreshInterval = null;
        this.client = axios.create({
            baseURL: BASE_URL,
            withCredentials: true,
            maxRedirects: 0, // Handle redirects manually for cookie extraction
            validateStatus: function (status) {
                return status >= 200 && status < 400; // Resolve on 3xx as well
            },
            headers: {
                'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                'Accept-Language': 'en-US,en;q=0.9',
            }
        });
    }

    _log(level, message) {
        this.emit('log', { date: Date.now(), level, message });
    }

    _extractCookies(headers, existingCookies = '') {
        const setCookieHeaders = headers['set-cookie'];
        if (!setCookieHeaders) return existingCookies;

        const newCookies = setCookieHeaders.map(str => str.split(';')[0]);
        let cookieMap = new Map();
        
        if (existingCookies) {
             existingCookies.split('; ').forEach(cookieStr => {
                 const [name, ...val] = cookieStr.split('=');
                 if(name) cookieMap.set(name, val.join('='));
             });
        }
        
        newCookies.forEach(cookieStr => {
             const [name, ...val] = cookieStr.split('=');
             if(name) cookieMap.set(name, val.join('='));
        });

        this.cookie = Array.from(cookieMap.entries())
            .map(([name, val]) => `${name}=${val}`)
            .join('; ');
            
        return this.cookie;
    }

    _getXsrfToken() {
        if (!this.cookie) return null;
        const bbRouterMatch = this.cookie.match(/BbRouter=([^;]+)/);
        if (!bbRouterMatch) return null;
        
        const bbRouterVal = bbRouterMatch[1];
        const xsrfMatch = bbRouterVal.match(/xsrf:([^,]+)/);
        return xsrfMatch ? xsrfMatch[1] : null;
    }

    async initialize() {
        try {
            this._log('INFO', 'SessionManager initialization started (Axios).');

            // 1. Initial GET request to retrieve JSESSIONID and Nonce
            this._log('INFO', 'Sending initial GET request...');
            const getResponse = await this.client.get('/', {
                 headers: {
                     'Cookie': 'COOKIE_CONSENT_ACCEPTED=true'
                 }
            });
            
            this.cookie = this._extractCookies(getResponse.headers, 'COOKIE_CONSENT_ACCEPTED=true');

            // Extract Nonce from HTML
            const nonceMatch = getResponse.data.match(/name="blackboard\.platform\.security\.NonceUtil\.nonce\.ajax" value="([^"]+)"/);
            const nonce = nonceMatch ? nonceMatch[1] : '';

            if (!nonce) {
                this._log('WARN', 'Could not find security nonce in login page. Login might fail.');
            }

            // 2. POST request to login
            this._log('INFO', 'Sending POST request to login...');
            
            const loginData = new URLSearchParams({
                user_id: this.username,
                password: this.password,
                login: 'Sign In',
                action: 'login',
                new_loc: '',
                'blackboard.platform.security.NonceUtil.nonce.ajax': nonce
            });

            const postResponse = await this.client.post('/webapps/login/', loginData.toString(), {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Cookie': this.cookie,
                    'Origin': BASE_URL,
                    'Referer': `${BASE_URL}/`
                }
            });

            this.cookie = this._extractCookies(postResponse.headers, this.cookie);
            
            // Expected a 302 redirect on successful login
            if (postResponse.status !== 302 && !postResponse.headers.location) {
                this._log('ERROR', `Login failed: Status ${postResponse.status}. Expected redirect not found.`);
                console.log('DEBUG: Post Response Data:', postResponse.data.substring(0, 1000));
                throw new Error('Authentication failed.');
            }

            this._log('INFO', 'Login successful.');
            
            // 3. Get user data from ultra page
            await this._fetchUserData();
            
            this.emit('cookie:update', this.cookie);
            this.emit('xsrf:update', this._getXsrfToken());
            return true;
        } catch (error) {
            this._log('ERROR', `Initialization failed: ${error.message}`);
            throw error;
        }
    }

    async _fetchUserData() {
        this._log('INFO', 'Fetching user data...');
        const ultraResponse = await this.client.get('/ultra', {
             headers: {
                 'Cookie': this.cookie
             }
        });
        
        this.cookie = this._extractCookies(ultraResponse.headers, this.cookie);

        // Extract user data JSON object from the page script
        const userDataMatch = ultraResponse.data.match(/user:\s*(\{.*?\}),\n/);
        if (userDataMatch && userDataMatch[1]) {
             try {
                 this.userData = JSON.parse(userDataMatch[1]);
                 this.emit('userData:update', this.userData);
                 this._log('INFO', 'User data extracted successfully.');
             } catch (e) {
                 this._log('ERROR', `Failed to parse userData JSON: ${e.message}`);
             }
        } else {
             this._log('ERROR', 'Could not find user data in /ultra response.');
        }
    }

    async refreshCookie() {
        this._log('INFO', 'Refreshing session via /ultra...');
        try {
             const response = await this.client.get('/ultra', {
                 headers: {
                     'Cookie': this.cookie
                 }
            });
            this.cookie = this._extractCookies(response.headers, this.cookie);
            this.emit('cookie:update', this.cookie);
            this.emit('xsrf:update', this._getXsrfToken());
            return this.cookie;
        } catch (error) {
            this._log('ERROR', `Failed to refresh cookie: ${error.message}`);
        }
    }

    startSessionKeepAlive(intervalMs = 900000) {
        if (this.refreshInterval) clearInterval(this.refreshInterval);
        this.refreshInterval = setInterval(() => {
            this._log('DEBUG', 'Performing periodic session refresh.');
            this.refreshCookie().catch(err => this.emit('error', err));
        }, intervalMs);
    }

    updateCookies(setCookieHeaders) {
        if (!setCookieHeaders) return;
        
        // Normalize to array
        const headers = Array.isArray(setCookieHeaders) ? setCookieHeaders : [setCookieHeaders];
        
        this.cookie = this._extractCookies({ 'set-cookie': headers }, this.cookie);
        this.emit('cookie:update', this.cookie);
        this.emit('xsrf:update', this._getXsrfToken());
    }

    async close() {
        if (this.refreshInterval) clearInterval(this.refreshInterval);
        this._log('INFO', 'Session closed.');
    }
}

module.exports = SessionManager;