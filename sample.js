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

    const courses = await bbl.getCourses();
    console.log('Fetched Courses:', courses);
    
    await bbl.close();
}

test();