# MBE
Helps you interact with the blackboard learning platform programmatically (MCL only).

## Prerequisites
* You must have NodeJS 22+ installed

```
npm install
```


## **Sample usage**:
```
// initialize an engine object
const bbl = new Engine({
    username: '2025180071',
    password: 'SomePassword'
})

// getCalendar allows us to fetch calendar activities from the past and future
// getCalendar(daysFromNow, daysToNow)
// -- daysFromNow - how many days to today (to the future)
// -- daysToNow - how many days from today (to today, from the past)


// fetch courses
const courses = await bbl.getCourses();

// fetch calendar events
const calendarEvents = await bbl.getCalendar(14, 7);

// fetches announcements from ALL courses in the current term
const announcements = getAnnouncements();
```

### Or

You can simply run sample.js.

``node sample.js 2025studentnumber password``

## Notes:
* The engine automatically hides courses from previous terms.
* **Term Boundaries**: It uses the following hardcoded date ranges to determine the current term:
* - 1st Term (1T): August 18 to November 28
* - 2nd Term (2T): November 29 to April 19 (the day before the 3rd term starts)
* - 3rd Term (3T): April 20 onwards (until the next academic year starts on August 18)