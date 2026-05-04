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

    // console.log(await bbl.getPendingActivities(10));
    // let sections = (await bbl.getCourseSections('_60658_1'));

    // // console.log(sections[1]);
    // console.log(await bbl.getCourseObjectChildren('_60658_1', '_2604699_1'));

    for (let course of (await bbl.getCourses())) {
        // console.log(course);
        console.log(await bbl.getCourseContents(course.id, true))
    }
    await bbl.close();
}

test();