const Engine = require('./mbe');

async function test() {
    const bbl = await Engine.create({
        username: process.argv[2], // hello!
        password: process.argv[3],
        debug: true
    });


    console.log(bbl._getCurrentTerm());
    bbl.on('log', (data) => {
        console.log(data);
    })

    // let announcements = await bbl.getAnnouncements();
    // console.log(`Fetched ${announcements.length} announcements from all courses.`);

    // Fetch calendar events: 14 days into the future, 7 days into the past
    const calendarEvents = await bbl.getCalendar(14, 7);
    console.log(`Fetched ${calendarEvents.length} calendar events.`);
    
    // Optional: Print a few events to verify
    calendarEvents.slice(0, 3).forEach(event => {
        console.log(`- [${new Date(event.startDate).toLocaleString()}] [${new Date(event.endDate).toLocaleString()}] ${event.title}`);
    });

    // Fetch pending activities (active but no attempts)
    const pendingActivities = await bbl.getPendingActivities(30);
    console.log(`Fetched ${pendingActivities.length} pending activities.`);
    pendingActivities.forEach(act => {
        console.log(`- [PENDING] ${act.title} (Due: ${new Date(act.endDate).toLocaleString()})`);
    });

    await bbl.close();
}

test();