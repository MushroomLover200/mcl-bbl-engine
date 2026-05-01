const Engine = require('./mbe');

async function test() {
    const bbl = new Engine({
        username: '2025180071',
        password: 'SomePassword',
        debug: true,
        headless: false
    })

    await bbl.initialized;

    bbl.on('log', (data) => {
        console.log(data);
    })

    bbl.on('fetch:courses', (courses) => {
        console.log(courses);
    });

    await bbl.getCourses();
}

test();