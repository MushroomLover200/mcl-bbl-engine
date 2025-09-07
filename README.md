# MBE
It uses playwright to interact with the BBL website. Events are fired to signal that the object has been encountered, i.e assignments/courses list.
## **Sample usage**:
```
// initialize an engine object
const bbl = new Engine({
    username: '2025180071',
    password: 'SomePassword',
    debug: true,
})
```

## **Events**:
``fetch:assginments`` **Returns an array of assignment objects**
``fetch:courses`` **Returns an array of courses objects**



## More features to come!
This project was rushed because I wanted to reorganize my study system. Microsoft teams notifications not giving a single notification is hell!