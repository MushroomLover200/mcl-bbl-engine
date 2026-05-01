const { EventEmitter } = require('events');
const SessionManager = require('./lib/SessionManager');
const APIClient = require('./lib/APIClient');

/**
 * The Engine class acts as a facade, coordinating browser automation 
 * and API interactions.
 */
class Engine extends EventEmitter {
    /**
     * Static factory method for clean initialization.
     */
    static async create(options) {
        const engine = new Engine(options);
        await engine.initialized;
        return engine;
    }

    constructor({
        username,
        password,
        debug = false,
        refreshInterval = 900000
    }) {
        super();
        
        this.session = new SessionManager({
            username,
            password,
            isHeadless: !debug
        });

        this.api = new APIClient();
        this.isBusy = false;

        this._setupForwarding();
        
        this.initialized = this.session.initialize().then(() => {
            this.session.startSessionKeepAlive(refreshInterval);
            return true;
        });
    }

    _setupForwarding() {
        this._proxyEvents(this.session, ['log', 'error', 'userData:update', 'cookie:update']);
        this._proxyEvents(this.api, ['log', 'error', 'fetch:courses']);

        this.session.on('cookie:update', (cookie) => this.api.setSession({ cookie }));
        this.session.on('userData:update', (userData) => this.api.setSession({ userData }));
    }

    _proxyEvents(source, events) {
        events.forEach(event => {
            source.on(event, (...args) => this.emit(event, ...args));
        });
    }

    _log(level, message) {
        this.emit('log', { date: Date.now(), level, message });
    }

    /**
     * Fetches courses list directly.
     * Returns false if another operation is in progress.
     * @returns {Promise<object[]|boolean>}
     */
    async getCourses() {
        if (this.isBusy) {
            this._log('WARN', 'Engine is busy. Operation cancelled.');
            return false;
        }
        
        this.isBusy = true;
        try {
            return await this.api.getCourses();
        } finally {
            this.isBusy = false;
        }
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