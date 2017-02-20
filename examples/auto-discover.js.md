## Using polling to auto-discover tags

The polling updater (see {@tutorial auto-update-polling.js}) can (since v0.6.0) be used in "discovery mode". In this mode, all tag updates returned by the polling API endpoint are reported as tag objects with a `data` event, whether a tag has been previously registered for receiving updates or not. This can be used to receive data updates on any tag accessible to the account, including tags dynamically added since the program first started.

In this mode, it is up to the application to either register newly discovered tags with the updater (which in essence caches the tag objects, and thus all additional state, such as their sensors), or to initialize each object from scratch. The former saves time between receiving the tag object and having access to all sensor data, whereas the latter keeps the memory footprint low even with thousands of tags.

The code in this tutorial is also available as a JavaScript file
(generated automatically from this tutorial) that can be run with
`nodejs`. See the [`examples/`] directory of the package.

### Principle flow

The principle flow is similar to {@tutorial auto-update-polling.js},
except that there is no need to first find tag manager and tag objects. 

1. Connect to cloud.
2. Create polling tag updater, enabling discovery mode.
3. Register event handler for `data` event.
4. If the `data` event fires, discover the tag's sensors. (Optionally,
   register handler for tag's `data` event, and register tag for
   receiving future updates from the updater.)
5. Do something useful with the new data. Here we simply log useful
   properties for each sensor and tag (see {@tutorial
   read-sensors.js}).
6. Continue updating for a set period of time.

### Create platform object

    var Platform = require('wirelesstags');
    var platform = Platform.create();

### Create tag updater

For this we need to use the polling updater.

    var TagUpdater = require('wirelesstags/plugins/polling-updater');
    // must pass either 'platform' or 'options.factory' in discovery mode
    var updater = new TagUpdater(platform, { discoveryMode: true });

How long to keep looping?

    const END_AFTER = 30 * 60 * 1000; // value is in milliseconds

### Connect to platform

For a better overview, we will use the Promise-based API for the
principle flow here:

    var connect = platform.connect(Platform.loadConfig());

### Create and install event handler for updates

Next, we create and then install an event handler for the `data`
event. We write this so that it doesn't matter whether the event is
fired by the tag updater object or a tag, which allows changing the
code to register (cache) auto-discovered tag objects without changing
anything about the event handler.

    function dataHandler(tag) {
        // We can register new tag objects so their sensors don't need rediscovering
        // However, this is optional, so feel free to comment it out.
        if (tag.eachSensor().length === 0) {
            tag.on('data', dataHandler);
            updater.addTags(tag);
        }
        // tag.discoverSensors() always promises _all_ of the tag's sensors,
        // so is robust to whether they were already discovered previously
        tag.discoverSensors().then((sensors) => {
            logTag(tag);
            sensors.forEach(logSensor);
        }).catch((e) => { console.error(e.stack ? e.stack : e); });
    }

Then we register the handler with the updater for its `data` event:

    updater.on('data', dataHandler);

### Start auto-update loop

Once `platform.connect()` has succeeded, we can start the auto-update
loop (which now is an auto-discovery with update) loop.


    connect.then(() => {
        updater.startUpdateLoop();
        // also stop after set duration
        setTimeout(updater.stopUpdateLoop.bind(updater), END_AFTER);
    }).catch((e) => { console.error(e.stack ? e.stack : e) });


### Do something with tags and sensors

The actions for tags and sensors here are simply copied from {@tutorial read-sensors.js}.

```js
function logTag(tag) {
    console.log("Tag", tag.name, "(slaveId=" + tag.slaveId + ")",
                "of", tag.wirelessTagManager.name,
                "(mac=" + tag.wirelessTagManager.mac + ")");
    // console.log(".. properties:", tag.toString());
}

function logSensor(sensor) {
    console.log("..", sensor.sensorType,
                "of", sensor.wirelessTag.name + ":");
    console.log("    reading:", sensor.reading);
    if (sensor.eventState !== undefined) {
        console.log("    state:", sensor.eventState);
        console.log("    armed:", sensor.isArmed());
    }
    // console.log("... sensor properties:", sensor.toString());
}
```

[`examples/`]: https://github.com/hlapp/wirelesstags-js/tree/master/examples
