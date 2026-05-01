const Engine = require('./mbe');

async function test() {
    const bbl = await Engine.create({
        username: '2025180071',
        password: 'SomePassword',
        debug: true
    });

    bbl.on('log', (data) => {
        console.log(data);
    })

    bbl.on('fetch:courses', (courses) => {
        console.log(courses);
    });

    await bbl.getCourses();
}

test();