# MBE
It uses playwright to interact with the BBL website. 

## Prerequisites
* You must have NodeJS 22+ installed
* Playwright Firefox must be installed
```
npx playwright install firefox
```


## **Sample usage**:
```
// initialize an engine object
const bbl = new Engine({
    username: '2025180071',
    password: 'SomePassword',
    debug: true,
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
The engine automatically hides courses from previous terms.