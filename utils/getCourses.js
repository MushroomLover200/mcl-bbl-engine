/**
 * Processes a raw LMS course enrollment object and transforms it into a clean, structured JSON format.
 *
 * @param {object} coursesDataObject The raw JSON object from the LMS API's courses endpoint.
 * @returns {object} An object containing a structured array of courses, conforming to the specified schema.
 */
function getCoursesAsJson(coursesDataObject) {
  // Basic validation to ensure the data has the 'results' array.
  if (!coursesDataObject || !Array.isArray(coursesDataObject.results)) {
    console.error("Invalid or incomplete course data object provided. 'results' array is missing.");
    return { courses: [] }; // Return the default empty structure
  }

  // Map over the 'results' array to extract and format course information.
  const courses = coursesDataObject.results
    // We only want actual courses, not organizations.
    .filter(enrollment => enrollment.course && !enrollment.course.isOrganization)
    .map(enrollment => {
      const courseDetails = enrollment.course;
      return {
        // 'courseId' from the top-level course object (e.g., "IT101-1.CIS103.1T.25.26")
        courseId: courseDetails.courseId,
        // 'name' provides the full, human-readable name of the course
        courseName: courseDetails.name,
        // 'id' is the internal Blackboard ID (e.g., "_55137_1")
        id: courseDetails.id,
      };
    });

  // Return the final object in the required format.
  return {
    courses: courses,
  };
}

module.exports = getCoursesAsJson