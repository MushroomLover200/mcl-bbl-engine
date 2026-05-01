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
        // Automatically forward events from internal modules
        this._proxyEvents(this.session, ['log', 'error', 'userData:update', 'cookie:update']);
        this._proxyEvents(this.api, ['log', 'error', 'fetch:courses']);

        // Specialized sync logic (internal orchestration)
        this.session.on('cookie:update', (cookie) => {
            this._log('DEBUG', 'Session cookie updated.');
            this.api.setSession({ cookie });
        });

        this.session.on('userData:update', (userData) => {
            this._log('DEBUG', 'User data acquired.');
            this.api.setSession({ userData });
        });
    }

    /**
     * Proxies a list of events from a source emitter to this instance.
     * @param {EventEmitter} source - The source event emitter.
     * @param {string[]} events - List of event names to proxy.
     * @private
     */
    _proxyEvents(source, events) {
        events.forEach(event => {
            source.on(event, (...args) => this.emit(event, ...args));
        });
    }

    /**
     * Internal logging helper.
     * @private
     */
    _log(level, message) {
        this.emit('log', { date: Date.now(), level, message });
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