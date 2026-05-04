const { EventEmitter } = require('events');
const SessionManager = require('./lib/SessionManager');
const APIClient = require('./lib/APIClient');
const { stripHtmlWithFormatting } = require('./utils/index');

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
        refreshInterval = 900000
    }) {
        super();

        this.currentTerm = this._getCurrentTerm();

        this.session = new SessionManager({
            username,
            password
        });

        this.api = new APIClient();
        this.isBusy = false;
        this.courses = null;

        this._setupForwarding();

        this.initialized = this.session.initialize().then(() => {
            this.session.startSessionKeepAlive(refreshInterval);
            return true;
        });
    }

    /**
     * Determines the current academic term and year based on the Asia/Manila timezone.
     * Caches the result to avoid recalculating unnecessarily.
     */
    _getCurrentTerm() {
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Manila',
            year: 'numeric',
            month: 'numeric',
            day: 'numeric'
        });
        const parts = formatter.formatToParts(now);
        const dateParts = {};
        parts.forEach(p => dateParts[p.type] = p.value);

        const year = parseInt(dateParts.year, 10);
        const month = parseInt(dateParts.month, 10); // 1-12
        const day = parseInt(dateParts.day, 10);

        // Academic Year Logic: Starts Aug 18
        let ayStartYear = year;
        if (month < 8 || (month === 8 && day < 18)) {
            ayStartYear = year - 1;
        }
        const ayEndYear = ayStartYear + 1;
        const academicYear = `${ayStartYear.toString().substring(2, 4)}.${ayEndYear.toString().substring(2, 4)}`;

        const currentDate = new Date(year, month - 1, day);
        const firstTermStart = new Date(ayStartYear, 7, 18); // Aug is index 7
        const firstTermEnd = new Date(ayStartYear, 10, 28);  // Nov is index 10
        const secondTermStart = new Date(ayStartYear, 10, 29);
        const thirdTermStart = new Date(ayEndYear, 3, 20);   // Apr is index 3

        let term;
        if (currentDate >= firstTermStart && currentDate <= firstTermEnd) {
            term = "1T";
        } else if (currentDate >= secondTermStart && currentDate < thirdTermStart) {
            term = "2T";
        } else {
            term = "3T";
        }

        return {
            term,
            academicYear,
            full: `${term}.${academicYear}`
        };
    }

    _setupForwarding() {
        this._proxyEvents(this.session, ['log', 'error', 'userData:update', 'cookie:update', 'xsrf:update']);
        this._proxyEvents(this.api, ['log', 'error', 'fetch:courses']);

        this.session.on('cookie:update', (cookie) => this.api.setSession({ cookie }));
        this.session.on('userData:update', (userData) => this.api.setSession({ userData }));
        this.session.on('xsrf:update', (xsrfToken) => this.api.setSession({ xsrfToken }));

        this.api.on('cookie:update', (setCookie) => this.session.updateCookies(setCookie));
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
     * Fetches courses list directly. Caches the result after the first fetch.
     * Returns false if another operation is in progress.
     * @param {boolean} forceRefresh - If true, bypasses the cache and fetches again.
     * @returns {Promise<object[]|boolean>}
     */
    async getCourses(forceRefresh = false) {
        if (!forceRefresh && this.courses) {
            return this.courses;
        }

        if (this.isBusy) {
            this._log('WARN', 'Engine is busy. Operation cancelled.');
            return false;
        }

        this.isBusy = true;
        try {
            const fetchedCourses = await this.api.getCourses();
            this.courses = fetchedCourses.filter((data) => {
                return data.originalId.indexOf(this._getCurrentTerm().full) >= 0;
            });
            return this.courses;
        } finally {
            this.isBusy = false;
        }
    }

    /**
     * Fetch the sections of a course, i.e the course content. Usually module 0 to module 3
     * @param {string} courseId 
     */
    async getCourseSections(courseId) {
        let response = await this.api._fetchWithBBLCookies(
            'https://mcl.blackboard.com/learn/api/v1/courses/' + courseId + '/contents/ROOT/children?limit=50'
        );

        return response.data.results.filter((val) => val.contentHandler === 'resource/x-bb-lesson'); // only gets the lessons (modules)
    }

    /**
     * 
     * @param {string} courseId - The course id
     * @param {string} itemId - The item id, i.e id of a module 
     */
    async getCourseObjectChildren(courseId, itemId) {
        let response = await this.api._fetchWithBBLCookies(
            'https://mcl.blackboard.com/learn/api/v1/courses/' + courseId + '/contents/' + itemId + '/children?@view=Summary&limit=50'
        );

        return response.data.results;
    }

    /**
     * Recursively fetches course contents to build a JSON tree.
     * Starts from course sections (lessons) and traverses into folders.
     * @param {string} courseId 
     * @param {boolean} asTreeString - If true, returns a string formatted like the `tree` command.
     * @returns {Promise<object[]|string>}
     */
    async getCourseContents(courseId, asTreeString = false) {
        this._log('INFO', `Building content tree for course ${courseId}`);
        let sections = await this.getCourseSections(courseId);

        // Filter out unwanted sections
        sections = sections.filter(item => {
            if (!item.title) return true;
            return !(
                item.title.includes('Technical Support') ||
                item.title.includes('Module 0') ||
                item.title.includes('Ask LEIA') ||
                item.title.includes('Academic and Student Support Services and Resources')
            );
        });

        const resolveChildren = async (items) => {
            for (let item of items) {
                // Lessons and folders can contain other items
                if (item.contentHandler === 'resource/x-bb-lesson' || item.contentHandler === 'resource/x-bb-folder') {
                    item.children = await this.getCourseObjectChildren(courseId, item.id);
                    await resolveChildren(item.children);
                }
            }
        };

        await resolveChildren(sections);

        if (asTreeString) {
            // Fetch courses to find the title for the root node
            const courses = await this.getCourses();
            const course = courses.find(c => c.id === courseId);
            const courseTitle = course ? course.courseName : courseId;
            return this._buildTreeString(courseTitle, sections);
        }

        return sections;
    }

    /**
     * Helper to recursively format the content tree into a string.
     */
    _buildTreeString(rootTitle, items, prefix = '') {
        let result = '';
        
        // Add root node if this is the initial call
        if (prefix === '') {
            result += `${rootTitle}\n`;
        }

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const isLast = i === items.length - 1;
            const pointer = isLast ? '└── ' : '├── ';
            
            const title = item.title || 'Untitled';
            const handler = item.contentHandler ? ` (${item.contentHandler})` : '';
            result += `${prefix}${pointer}${title}${handler}\n`;
            
            if (item.children && item.children.length > 0) {
                const childPrefix = prefix + (isLast ? '    ' : '│   ');
                result += this._buildTreeString(null, item.children, childPrefix);
            }
        }
        return result;
    }


    /**
     * Fetches announcements. If no courseId is provided, fetches from all courses in the current term.
     * @param {string} courseId - The specific course id (_dddddd_) to fetch from.
     * @param {boolean} unreadOnly - Whether to return only unread items or not, unread items only by default
     */
    async getAnnouncements(unreadOnly = true, courseId = '') {
        if (courseId) {
            this._log('INFO', `Fetching announcements for course ${courseId}`);
            const response = await this.api._fetchWithBBLCookies(
                `https://mcl.blackboard.com/learn/api/v1/courses/${courseId}/announcements?limit=10&offset=0&sort=startDateRestriction%28desc%29`
            );

            let results = response.data.results || [];
            if (unreadOnly) {
                results = results.filter(val => val.readStatus && val.readStatus.isRead === false);
            }
            return results;
        }

        this._log('INFO', 'No courseId provided. Fetching announcements for all current term courses.');
        const currentCourses = await this.getCourses();

        if (currentCourses.length === 0) {
            this._log('WARN', 'No courses found for the current term.');
            return [];
        }

        const announcementPromises = currentCourses.map(async (course) => {
            try {
                const response = await this.api._fetchWithBBLCookies(
                    `https://mcl.blackboard.com/learn/api/v1/courses/${course.id}/announcements?limit=10&offset=0&sort=startDateRestriction%28desc%29`
                );

                let results = response.data.results || [];

                // Inject course info into each announcement for context
                return results.map(ann => ({
                    ...ann,
                    courseCode: course.courseCode,
                    courseName: course.courseName
                }));
            } catch (err) {
                this._log('ERROR', `Failed to fetch announcements for ${course.courseCode}: ${err.message}`);
                return [];
            }
        });

        const allAnnouncements = await Promise.all(announcementPromises);
        // Flatten and sort by date descending
        let flattened = allAnnouncements
            .flat()
            .sort((a, b) => new Date(b.created || b.startDateRestriction) - new Date(a.created || a.startDateRestriction));

        if (unreadOnly) {
            flattened = flattened.filter(val => val.readStatus && val.readStatus.isRead === false);
        }

        return flattened;
    }

    /**
     * 
     * @param {boolean} readStatus 
     * @param {string} courseId 
     * @param {string} announcementId 
     * @returns 
     */
    async _setAnnouncementViewStatus(readStatus, courseId = '', announcementId = '') {

        if (courseId == '' || announcementId == '') return false;

        try {
            const response = await this.api._fetchWithBBLCookies(
                'https://mcl.blackboard.com/learn/api/v1/courses/' + courseId + '/announcements/' + announcementId + '/status',
                {
                    method: 'PUT',
                    body: { isRead: readStatus }
                }
            );
            return response.status >= 200 && response.status < 300;
        } catch (err) {
            this._log('ERROR', `Failed to set announcement status: ${err.message}`);
            return false;
        }
    }

    /**
     * 
     * @param {string} courseId 
     * @param {string} announcementId 
     */
    async readAnnouncement(courseId = '', announcementId = '') {
        return await this._setAnnouncementViewStatus(true, courseId, announcementId);
    }

    /**
     * 
     * @param {string} courseId 
     * @param {string} announcementId 
     * @returns 
     */
    async unreadAnnouncement(courseId = '', announcementId = '') {
        return await this._setAnnouncementViewStatus(false, courseId, announcementId);
    }

    /**
     * Fetches calendar events within a specific time range.
     * @param {number} daysFromNow - How many days in the future to fetch.
     * @param {number} [daysToNow=0] - How many days in the past to fetch.
     */
    async getCalendar(daysFromNow, daysToNow = 0) {
        this._log('INFO', `Fetching calendar from ${daysToNow} days ago to ${daysFromNow} days ahead`);

        const now = new Date();

        // Calculate since date (past)
        const sinceDate = new Date(now.getTime() - (daysToNow * 24 * 60 * 60 * 1000));
        // Calculate until date (future)
        const untilDate = new Date(now.getTime() + (daysFromNow * 24 * 60 * 60 * 1000));

        const since = encodeURIComponent(sinceDate.toISOString());
        const until = encodeURIComponent(untilDate.toISOString());

        const response = await this.api._fetchWithBBLCookies(
            `https://mcl.blackboard.com/learn/api/v1/calendars/calendarItems?since=${since}&until=${until}`
        );
        const calendar = response.data;

        return calendar.results || calendar;
    }

    /**
     * Fetches grades for a specific course and activity.
     * @param {string} courseId 
     * @param {string} activityId 
     * @returns {Promise<object>}
     */
    async getGrades(courseId = '', activityId = '') {
        if (!courseId || !activityId) return null;

        try {
            const response = await this.api._fetchWithBBLCookies(
                `https://mcl.blackboard.com/learn/api/v1/courses/${courseId}/gradebook/columns/${activityId}/grades`
            );
            return response.data;
        } catch (err) {
            // 404 usually means the grade column doesn't exist or isn't accessible yet, 
            // which we can treat as "no grades/attempts" for our purposes.
            if (err.response && err.response.status === 404) {
                return null;
            }
            this._log('ERROR', `Failed to fetch grades for course ${courseId}, activity ${activityId}: ${err.message}`);
            return null;
        }
    }

    /**
     * Fetches activities that are currently active (between start and end date)
     * and have no submission/attempts.
     * @param {number} daysAhead - How many days to look into the future for activities.
     * @returns {Promise<object[]>}
     */
    async getPendingActivities(daysAhead = 30) {
        this._log('INFO', `Fetching pending activities for the next ${daysAhead} days.`);

        const now = new Date();
        // Fetch calendar events
        const events = await this.getCalendar(daysAhead, 0);

        // Filter for gradable items that are within their time range
        const potentialActivities = events.filter(event => {
            if (event.itemSourceType !== 'blackboard.platform.gradebook2.GradableItem') return false;

            const start = new Date(event.startDate);
            const end = new Date(event.endDate);

            // "within the deadline (between start and end date)"
            // If start and end are same, it's a single point in time (deadline).
            // We consider it pending if we haven't passed the end date.
            if (start.getTime() === end.getTime()) {
                return now <= end;
            }

            return now >= start && now <= end;
        });

        const pending = [];
        for (const activity of potentialActivities) {
            const courseId = activity.calendarId;
            const activityId = activity.itemSourceId;

            const gradeInfo = await this.getGrades(courseId, activityId);

            // If the grade API explicitly says we can't create an attempt, skip it.
            if (gradeInfo && gradeInfo.permissions && gradeInfo.permissions.createAttempt === false) {
                continue;
            }

            // Check if there are no attempts
            const hasAttempts = gradeInfo &&
                gradeInfo.results &&
                gradeInfo.results.length > 0 &&
                gradeInfo.results[0].lastAttemptId !== null;

            if (!hasAttempts) {
                pending.push({
                    title: activity.title,
                    courseId,
                    activityId,
                    startDate: activity.startDate,
                    endDate: activity.endDate,
                    type: activity.dynamicCalendarItemProps.eventType,
                    calendarName: activity.calendarNameLocalizable ? activity.calendarNameLocalizable.rawValue : null
                });
            }
        }

        return pending;
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