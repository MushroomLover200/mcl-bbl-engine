const { firefox } = require('playwright');
const { EventEmitter } = require('events');
const getString = require('../utils/getString');
const getAssignments = require('../utils/getAssignments');

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

    /**
     * Emits a standardized log event.
     * @param {'INFO'|'DEBUG'|'WARN'|'ERROR'} level - The severity level of the log.
     * @param {string} message - The log message.
     * @private
     */
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
            const isNotLoggedIn = content.includes(loginPageHeader);

            if (isNotLoggedIn) {
                this._log('INFO', 'User not logged in, proceeding with login.');
                await this.login();
                this._log('INFO', 'Login successful.');
            } else {
                this._log('INFO', 'User is already logged in.');
            }
            
            // Initial cookie grab
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
                this._log('DEBUG', 'Clicked cookie consent button.');
            }
        } catch {}

        await this.page.getByRole('textbox', { name: 'Username' }).fill(this.username);
        await this.page.getByRole('textbox', { name: 'Password' }).fill(this.password);
        await this.page.getByRole('button', { name: 'Sign In', exact: true }).click();
        
        await this.page.waitForURL('**/ultra', { timeout: 15000 });
        await this.page.waitForLoadState('networkidle', { timeout: 5000 });
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

            if (url === `${API_BASE}/streams/ultra` && method === 'POST') {
                this._handleActivityStreamResponse(response);
            }
        });
    }

    async _handleActivityStreamResponse(response) {
        try {
            const requestData = await response.request().postDataJSON();
            let streamItemType;

            if (requestData.providers?.bb_deployment && Object.keys(requestData.providers).length < 3) {
                streamItemType = 'assignments';
            }
            
            if (streamItemType === 'assignments') {
                const responseData = await response.json();
                const assignments = getAssignments(responseData);
                this.emit('fetch:assignments', assignments);
                this._log('INFO', 'Fetched assignments via activity stream.');
            }
        } catch (error) {
            this._log('ERROR', `Error processing activity stream: ${error.message}`);
        }
    }

    async refreshCookie() {
        if (!this.context) return;
        const cookies = await this.context.cookies();
        this.cookie = cookies.map(c => `${c.name}=${c.value}`).join('; ');
        this.emit('cookie:update', this.cookie);
        return this.cookie;
    }

    startSessionKeepAlive(intervalMs = 1000 * 60 * 15) { // Default 15 mins
        if (this.refreshInterval) clearInterval(this.refreshInterval);
        this.refreshInterval = setInterval(() => {
            this._log('DEBUG', 'Performing periodic cookie refresh.');
            this.refreshCookie().catch(err => this.emit('error', err));
        }, intervalMs);
    }

    async getActivities() {
        if (!this.page) return;
        this._log('INFO', 'Navigating to Activity page.');
        await this.page.getByRole('link', { name: 'Activity' }).click();
    }

    async close() {
        if (this.refreshInterval) clearInterval(this.refreshInterval);
        if (this.browser) await this.browser.close();
    }
}

module.exports = SessionManager;