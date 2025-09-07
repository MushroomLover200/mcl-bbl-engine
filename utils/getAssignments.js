/**
 * Processes a raw LMS activity stream object and transforms it into a clean, structured JSON format.
 *
 * @param {object} streamDataObject The raw JSON object from the LMS API.
 * @returns {object} An object containing a structured array of unique activities, conforming to the specified schema.
 */
function getActivitiesAsJson(streamDataObject) {
    // Basic validation to ensure we have the necessary data structure.
    if (!streamDataObject || !streamDataObject.sv_streamEntries || !streamDataObject.sv_extras) {
        console.error("Invalid or incomplete data object provided.");
        return { activities: [] }; // Return the default empty structure
    }

    // 1. Create a Course Name Lookup Map for easy conversion of IDs to names.
    const courseMap = new Map();
    if (streamDataObject.sv_extras.sx_courses) {
        for (const course of streamDataObject.sv_extras.sx_courses) {
            courseMap.set(course.id, course.name);
        }
    }

    // 2. Filter, map, and transform the stream entries.
    const allActivities = streamDataObject.sv_streamEntries
        // We only care about entries that are actual course activities (assignments, tests, etc.).
        .filter(entry => entry.providerId === 'bb-nautilus')
        // Filter for entries that are Assignments ('UA') or Tests ('TE').
        .filter(entry => {
            const type = entry.itemSpecificData?.notificationDetails?.sourceType;
            return type === 'UA' || type === 'TE';
        })
        // 3. Map the filtered data to conform to the target schema.
        .map(entry => {
            const details = entry.itemSpecificData;
            const notificationDetails = details.notificationDetails;

            return {
                activityName: details.title || 'Untitled Activity',
                courseName: courseMap.get(entry.se_courseId) || 'Unknown Course',
                type: notificationDetails.sourceType === 'UA' ? 'Assignment' : 'Test',
                // Provide the ISO string if the date exists, otherwise null. JSON handles null correctly.
                dueDate: notificationDetails.dueDate || null,
                givenDate: notificationDetails.startDate || null,
            };
        });

    // 4. Remove duplicates. An activity can appear multiple times (e.g., 'AVAIL', 'DUE').
    // We create a unique key for each activity based on its name and course.
    const uniqueActivities = Array.from(
        new Map(allActivities.map(act => [`${act.activityName}-${act.courseName}`, act])).values()
    );

    // 5. Return the final object in the required format.
    return {
        activities: uniqueActivities,
    };
}

module.exports = getActivitiesAsJson;