const { firefox } = require('playwright');
const getAssignments = require('./utils/getAssignments');
const getString = require('./utils/getString');
const getCourses = require('./utils/getCourses');
const { EventEmitter } = require('events');

const BASE_URL = 'https://mcl.blackboard.com';
const API_BASE = `${BASE_URL}/learn/api/v1`;

/**
 * The Engine class automates interactions with the Blackboard learning platform.
 */
class Engine extends EventEmitter {
    constructor({
        username,
        password,
        debug = false
    }) {
        super();
        this.username = username;
        this.password = password;
        this.isHeadless = !debug;

        this.browser = null;
        this.page = null;
        this.cookie = null;
        this.userData = null;

        this.browserActionQueue = [];
        this.apiActionQueue = [];
        this.isBrowserReady = false;
        this.isApiReady = false;
        this.isProcessingBrowserQueue = false;
        this.isProcessingApiQueue = false;

        this.initialized = this.initialize();
    }

    /**
     * Closes the browser and cleans up resources.
     */
    async close() {
        this._log('INFO', 'Closing browser and cleaning up resources.');
        if (this.browser) {
            await this.browser.close();
        }
        this.isBrowserReady = false;
        this.isApiReady = false;
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

    /**
     * Initializes the Playwright browser, sets up network interception,
     * and performs the initial login if necessary.
     * @returns {Promise<boolean>} A promise that resolves to true upon successful initialization.
     */
    async initialize() {
        try {
            this._log('INFO', 'Engine initialization started.');
            this.browser = await firefox.launch({
                headless: this.isHeadless,
                ignoreHTTPSErrors: true
            });

            this.page = await this.browser.newPage();
            await this.page.goto(BASE_URL);
            this._setupNetworkInterception();

            // Wait for either the login header or the post-login ultra page
            await Promise.race([
                this.page.waitForSelector('h1.welcome', { timeout: 10000 }).catch(() => {}),
                this.page.waitForURL('**/ultra', { timeout: 10000 }).catch(() => {})
            ]);

            const loginPageHeader = '<h1 class="welcome">Login to Mapúa MCL Blackboard</h1>';
            const content = await this.page.content();
            const isNotLoggedIn = content.includes(loginPageHeader);

            if (!isNotLoggedIn) {
                this._log('INFO', 'User is already logged in.');
            } else {
                this._log('INFO', 'User not logged in, proceeding with login.');
                await this.login();
                this._log('INFO', 'Login successful.');
            }
            
            this.isBrowserReady = true;
            this._log('INFO', 'Browser is ready. Processing browser action queue.');
            this._tryProcessBrowserQueue();

            return true;
        } catch (error) {
            this._log('ERROR', `Initialization failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Handles the user login process on the Blackboard page.
     */
    async login() {
        try {
            const cookieButton = this.page.getByRole('button', { name: 'OK' });
            if (await cookieButton.isVisible({ timeout: 2000 })) {
                await cookieButton.click();
                this._log('DEBUG', 'Clicked cookie consent button.');
            }
        } catch {
            this._log('DEBUG', 'Cookie consent banner check failed or not found.');
        }

        await this.page.getByRole('textbox', { name: 'Username' }).fill(this.username);
        await this.page.getByRole('textbox', { name: 'Password' }).fill(this.password);
        await this.page.getByRole('button', { name: 'Sign In', exact: true }).click();
        
        try {
            await this.page.waitForURL('**/ultra', { timeout: 15000 });
            await this.page.waitForLoadState('networkidle', { timeout: 5000 });
        } catch (error) {
            this._log('WARN', `Login post-navigation check timed out: ${error.message}`);
        }
    }

    /**
     * Enqueues an action to navigate to the "Activity" stream page.
     */
    async getActivities() {
        this._log('DEBUG', 'Queueing browser action: getActivities');
        const action = async () => {
            this._log('INFO', 'Navigating to Activity page.');
            await this.page.getByRole('link', { name: 'Activity' }).click();
        };
        this.browserActionQueue.push(action);
        this._tryProcessBrowserQueue();
    }

    /**
     * Enqueues an action to fetch the user's course list via the Blackboard API.
     */
    async getCourses() {
        this._log('DEBUG', 'Queueing API action: getCourses');
        const action = async () => {
            this._log('INFO', 'Fetching courses via API.');
            const url = `${API_BASE}/users/${this.userData.id}/memberships?expand=course.effectiveAvailability,course.permissions,courseRole&includeCount=true&limit=10000`;

            try {
                const response = await this._fetchWithBBLCookies(url);
                if (!response.ok) {
                    throw new Error(`API request failed with status ${response.status}`);
                }
                const responseData = await response.json();
                const courses = getCourses(responseData);
                this.emit('fetch:courses', courses);
                this._log('INFO', 'Successfully fetched and processed courses.');
            } catch (error) {
                this._log('ERROR', `Failed to fetch or process courses: ${error.message}`);
            }
        };
        this.apiActionQueue.push(action);
        this._tryProcessApiQueue();
    }

    /**
     * A wrapper for the global fetch API that automatically includes the current session cookie.
     * @param {string|URL|Request} url - The URL to fetch.
     * @param {RequestInit} [options] - Optional fetch options.
     * @returns {Promise<Response>} The fetch response.
     * @private
     */
    async _fetchWithBBLCookies(url, options = {}) {
        if (!this.cookie) {
            throw new Error('Cannot fetch: Session cookie is not available.');
        }

        const headers = new Headers(options.headers || {});
        headers.set('cookie', this.cookie);

        return fetch(url, {
            ...options,
            headers: headers
        });
    }
    
    /**
     * Attempts to process the browser action queue if it's ready and not already being processed.
     * @private
     */
    async _tryProcessBrowserQueue() {
        if (!this.isBrowserReady || this.isProcessingBrowserQueue) {
            return;
        }

        this.isProcessingBrowserQueue = true;
        while (this.browserActionQueue.length > 0) {
            const action = this.browserActionQueue.shift();
            try {
                await action();
            } catch (error) {
                this._log('ERROR', `Browser action failed: ${error.message}`);
            }
        }
        this.isProcessingBrowserQueue = false;
    }

    /**
     * Attempts to process the API action queue if credentials are ready and it's not already being processed.
     * @private
     */
    async _tryProcessApiQueue() {
        if (!this.isApiReady || this.isProcessingApiQueue) {
            return;
        }

        this.isProcessingApiQueue = true;
        while (this.apiActionQueue.length > 0) {
            const action = this.apiActionQueue.shift();
            try {
                await action();
            } catch (error) {
                this._log('ERROR', `API action failed: ${error.message}`);
            }
        }
        this.isProcessingApiQueue = false;
    }


    /**
     * Sets up network request and response interception.
     * @private
     */
    _setupNetworkInterception() {
        this.page.route(`${BASE_URL}/**`, async (route) => {
            const headers = await route.request().allHeaders();
            if (headers.cookie) {
                this.cookie = headers.cookie;
            }
            await route.continue();
            this._checkApiReady();
        });

        this.page.on('response', async (response) => {
            const url = response.url();
            const method = response.request().method();

            if (url.startsWith(`${BASE_URL}/ultra`) && method === 'GET') {
                try {
                    const responseBody = await response.text();
                    const userDataString = getString(responseBody, 'user: ', ',\n');
                    if (userDataString) {
                        this.userData = JSON.parse(userDataString);
                        this._checkApiReady();
                    }
                } catch (error) {
                    this._log('DEBUG', `Failed to parse userData: ${error.message}`);
                }
                return;
            }

            if (url === `${API_BASE}/streams/ultra` && method === 'POST') {
                this._handleActivityStreamResponse(response);
            }
        });
    }
    
    /**
     * Checks if both cookie and user data are available, and if so,
     * marks the API as ready and triggers the queue processor.
     * @private
     */
    _checkApiReady() {
        if (this.isApiReady) return; // Only run once

        if (this.cookie && this.userData) {
            this.isApiReady = true;
            this._log('INFO', 'API credentials acquired. API queue is now ready.');
            this._tryProcessApiQueue();
        }
    }

    /**
     * Processes the response from the activity stream API endpoint.
     * @param {import('playwright').Response} response
     * @private
     */
    async _handleActivityStreamResponse(response) {
        try {
            const requestData = await response.request().postDataJSON();
            let streamItemType;

            if (requestData.providers?.bb_deployment && Object.keys(requestData.providers).length < 3) {
                streamItemType = 'assignments';
            }
            
            switch (streamItemType) {
                case 'assignments': {
                    const responseData = await response.json();
                    const assignments = getAssignments(responseData);
                    this.emit('fetch:assignments', assignments);
                    this._log('INFO', 'Fetched and processed assignments from activity stream.');
                    break;
                }
                default: break;
            }
        } catch (error) {
            this._log('ERROR', `Error processing activity stream response: ${error.message}`);
        }
    }
}

module.exports = Engine;