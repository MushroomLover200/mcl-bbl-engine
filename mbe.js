const { firefox } = require('playwright');
const getAssignments = require('./utils/getAssignments');
const getString = require('./utils/getString');
const getCourses = require('./utils/getCourses');
const { EventEmitter } = require('events');

/**
 * The Engine class automates interactions with the Blackboard learning platform.
 * It handles login, data fetching, and emits events for different data types.
 * It now includes robust queuing systems for browser and API actions to ensure
 * sequential execution and prevent race conditions.
 * @extends EventEmitter
 */
class Engine extends EventEmitter {
    // Expected shape of the userData object after it's fetched.
    // userData = { emailAddress, familyName, givenName, uuid, foundationsId, userName, id, institutionEmail };

    /**
     * @param {object} options - The configuration options for the engine.
     * @param {string} options.username - The username for Blackboard.
     * @param {string} options.password - The password for Blackboard.
     * @param {boolean} [options.debug=false] - If true, runs the browser in non-headless mode for debugging.
     */
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

        // --- Queueing System State ---
        this.browserActionQueue = [];
        this.apiActionQueue = [];
        this.isBrowserReady = false;
        this.isApiReady = false;
        this.isProcessingBrowserQueue = false;
        this.isProcessingApiQueue = false;
        // ---

        this.initialized = this.initialize();
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
        this._log('INFO', 'Engine initialization started.');
        this.browser = await firefox.launch({
            headless: this.isHeadless,
            ignoreHTTPSErrors: true
        });

        this.page = await this.browser.newPage();
        await this.page.goto('https://mcl.blackboard.com/');
        this._setupNetworkInterception();

        const loginPageHeader = '<h1 class="welcome">Login to Mapúa MCL Blackboard</h1>';
        const isNotLoggedIn = (await this.page.content()).includes(loginPageHeader);

        if (!isNotLoggedIn) {
            this._log('INFO', 'User is already logged in.');
        } else {
            this._log('INFO', 'User not logged in, proceeding with login.');
            await this.login();
            this._log('INFO', 'Login successful.');
        }
        
        // Signal that the browser is ready and process any queued browser actions.
        this.isBrowserReady = true;
        this._log('INFO', 'Browser is ready. Processing browser action queue.');
        this._tryProcessBrowserQueue();

        return true;
    }

    /**
     * Handles the user login process on the Blackboard page.
     */
    async login() {
        try {
            await this.page.getByRole('button', { name: 'OK' }).click({ timeout: 5000 });
            this._log('DEBUG', 'Clicked cookie consent button.');
        } catch {
            this._log('DEBUG', 'Cookie consent banner not found, skipping.');
        }

        await this.page.getByRole('textbox', { name: 'Username' }).fill(this.username);
        await this.page.getByRole('textbox', { name: 'Password' }).fill(this.password);
        await this.page.getByRole('button', { name: 'Sign In', exact: true }).click();
        
        try {
            await this.page.waitForLoadState('networkidle', { timeout: 10000 });
        } catch {
            this._log('WARN', 'Network did not become idle after login, continuing anyway.');
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
            const url = `https://mcl.blackboard.com/learn/api/v1/users/${this.userData.id}/memberships?expand=course.effectiveAvailability,course.permissions,courseRole&includeCount=true&limit=10000`;

            try {
                const response = await fetch(url, { headers: { cookie: this.cookie } });
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
        this.page.route(/https:\/\/mcl\.blackboard\.com\//, async (route) => {
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

            if (url === 'https://mcl.blackboard.com/ultra' && method === 'GET') {
                try {
                    const responseBody = await response.text();
                    const userDataString = getString(responseBody, 'user: ', ',\n');
                    if (userDataString) {
                        this.userData = JSON.parse(userDataString);
                        this._checkApiReady();
                    }
                } catch { /* Ignore parsing errors */ }
                return;
            }

            if (url === 'https://mcl.blackboard.com/learn/api/v1/streams/ultra' && method === 'POST') {
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