const { firefox } = require('playwright');
const { EventEmitter } = require('events');
const { getString } = require('../utils');

const BASE_URL = 'https://mcl.blackboard.com';
const API_BASE = `${BASE_URL}/learn/api/v1`;

/**
 * Handles browser lifecycle, authentication, and session maintenance.
 */
class SessionManager extends EventEmitter {
    constructor({ username, password, isHeadless }) {
        super();
        this.username = username;
        this.password = password;
        this.isHeadless = isHeadless;

        this.browser = null;
        this.context = null;
        this.page = null;
        this.cookie = null;
        this.userData = null;
        this.refreshInterval = null;
    }

    _log(level, message) {
        this.emit('log', { date: Date.now(), level, message });
    }

    async initialize() {
        try {
            this._log('INFO', 'SessionManager initialization started.');
            this.browser = await firefox.launch({
                headless: this.isHeadless,
                ignoreHTTPSErrors: true
            });

            this.context = await this.browser.newContext();
            this.page = await this.context.newPage();
            
            await this.page.goto(BASE_URL);
            this._setupNetworkInterception();

            await Promise.race([
                this.page.waitForSelector('h1.welcome', { timeout: 10000 }).catch(() => {}),
                this.page.waitForURL('**/ultra', { timeout: 10000 }).catch(() => {})
            ]);

            const loginPageHeader = '<h1 class="welcome">Login to Mapúa MCL Blackboard</h1>';
            const content = await this.page.content();
            
            if (content.includes(loginPageHeader)) {
                this._log('INFO', 'User not logged in, proceeding with login.');
                await this.login();
                this._log('INFO', 'Login successful.');
            } else {
                this._log('INFO', 'User is already logged in.');
            }
            
            await this.refreshCookie();
            return true;
        } catch (error) {
            this._log('ERROR', `Initialization failed: ${error.message}`);
            throw error;
        }
    }

    async login() {
        try {
            const cookieButton = this.page.getByRole('button', { name: 'OK' });
            if (await cookieButton.isVisible({ timeout: 2000 })) {
                await cookieButton.click();
            }
        } catch {} // this is to accept the privacy policy, the try catch block is in place cause sometimes it's not there.

        await this.page.getByRole('textbox', { name: 'Username' }).fill(this.username);
        await this.page.getByRole('textbox', { name: 'Password' }).fill(this.password);
        await this.page.getByRole('button', { name: 'Sign In', exact: true }).click();
        
        await this.page.waitForURL('**/ultra', { timeout: 15000 });
        try {
            await this.page.waitForLoadState('networkidle', { timeout: 5000 });
        } catch {} // this stupid try catch block is just to wait for things to load a bit, but sometimes bbl loads endlessly...
    }

    _setupNetworkInterception() {
        this.page.on('response', async (response) => {
            const url = response.url();
            const method = response.request().method();

            if (url.startsWith(`${BASE_URL}/ultra`) && method === 'GET') {
                try {
                    const responseBody = await response.text();
                    const userDataString = getString(responseBody, 'user: ', ',\n');
                    if (userDataString) {
                        this.userData = JSON.parse(userDataString);
                        this.emit('userData:update', this.userData);
                    }
                } catch (error) {
                    this._log('DEBUG', `Failed to parse userData: ${error.message}`);
                }
            }
        });
    }

    async refreshCookie() {
        if (!this.context) return;
        const cookies = await this.context.cookies();
        this.cookie = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        this.emit('cookie:update', this.cookie);
        return this.cookie;
    }

    startSessionKeepAlive(intervalMs = 900000) {
        if (this.refreshInterval) clearInterval(this.refreshInterval);
        this.refreshInterval = setInterval(() => {
            this._log('DEBUG', 'Performing periodic cookie refresh.');
            this.refreshCookie().catch(err => this.emit('error', err));
        }, intervalMs);
    }

    async close() {
        if (this.refreshInterval) clearInterval(this.refreshInterval);
        if (this.browser) await this.browser.close();
    }
}

module.exports = SessionManager;