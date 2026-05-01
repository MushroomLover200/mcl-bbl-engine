const { EventEmitter } = require('events');
const SessionManager = require('./lib/SessionManager');
const APIClient = require('./lib/APIClient');

/**
 * The Engine class acts as a facade, coordinating browser automation 
 * and API interactions.
 */
class Engine extends EventEmitter {
    /**
     * @param {object} options - Configuration options.
     * @param {string} options.username - Blackboard username.
     * @param {string} options.password - Blackboard password.
     * @param {boolean} [options.debug=false] - Debug mode (non-headless).
     * @param {number} [options.refreshInterval=900000] - Cookie refresh interval in ms (default 15m).
     */
    constructor({
        username,
        password,
        debug = false,
        refreshInterval = 1000 * 60 * 15
    }) {
        super();
        
        this.session = new SessionManager({
            username,
            password,
            isHeadless: !debug
        });

        this.api = new APIClient();

        this._setupForwarding();
        this.initialized = this.session.initialize().then(() => {
            this.session.startSessionKeepAlive(refreshInterval);
            return true;
        });
    }

    _setupForwarding() {
        // Forward logs and errors
        this.session.on('log', (data) => this.emit('log', data));
        this.api.on('log', (data) => this.emit('log', data));
        
        this.session.on('error', (err) => {
            this._log('ERROR', err.message);
            this.emit('error', err);
        });

        // Sync session data to API client
        this.session.on('cookie:update', (cookie) => {
            this._log('DEBUG', 'Session cookie updated.');
            this.api.setSession({ cookie });
        });

        this.session.on('userData:update', (userData) => {
            this._log('DEBUG', 'User data acquired.');
            this.api.setSession({ userData });
        });

        // Forward data events
        this.session.on('fetch:assignments', (data) => this.emit('fetch:assignments', data));
        this.api.on('fetch:courses', (data) => this.emit('fetch:courses', data));
    }

    /**
     * Internal logging helper.
     * @private
     */
    _log(level, message) {
        this.emit('log', { date: Date.now(), level, message });
    }

    /**
     * Fetches activity stream (triggers assignments event).
     */
    async getActivities() {
        this._log('DEBUG', 'Triggering getActivities via browser.');
        return this.session.getActivities();
    }

    /**
     * Fetches courses list.
     */
    async getCourses() {
        this._log('DEBUG', 'Triggering getCourses via API.');
        return this.api.getCourses();
    }

    /**
     * Closes the engine and cleans up resources.
     */
    async close() {
        this._log('INFO', 'Closing Engine.');
        await this.session.close();
    }
}

module.exports = Engine;