## Finding tags and logging sensor readings

Simple example script that demonstrates what might be a typical flow
for reading sensors and processing (here: logging) their sensor
readings.

The code in this tutorial is also available as a JavaScript file
(generated automatically from this tutorial) that can be run with
`nodejs`. See the [`examples/`] directory of the package.

### Principle flow

1. Connect to cloud.
2. Find [tag managers]{@link WirelessTagManager}.
3. For each tag manager, find its associated [tags]{@link WirelessTag}.
4. For each tag, find its [sensors]{@link WirelessTagSensor}.
5. For each tag and its sensors, log useful properties (for
   sensors, reading, event state (such as "Too High" for
   temperature), and whether it is armed (meaning that events
   trigger alerts, such as push notification).
6. Keep looping for a set period of time by updating the data for
   each tag at the interval configured for each tag. Log sensor
   properties every time data for the respective tag is updated.

### Create platform object

    var Platform = require('wirelesstags');
    var platform = Platform.create();

How long to keep looping?

    const END_AFTER = 30 * 60 * 1000; // value is in milliseconds

### Set up event handlers

In this implementation here we use mostly event handlers to proceed
once the initial [connect()]{@link WirelessTagPlatform#connect}
succeeds. One could equally well use `Promise`-chaining (via
`.then()`). Note that if we do not use callbacks, it is a good idea to
`.catch()` rejected promises, because otherwise errors thrown will be
invisible.

In the `connect` event handler, trigger discovery of tag managers (see
[discoverTagManagers()]{@link WirelessTagPlatform#discoverTagManagers}):

```js
platform.on('connect', () => {
    console.log("connected to Wireless Tag cloud");
    platform.discoverTagManagers().catch(
        (err) => { console.error(err.stack ? err.stack : err); });
});
```

The `discover` handler for the platform will receive tag a manager
object on each event.

    platform.on('discover', (manager) => {
        console.log("found manager", manager.name, manager.mac);

Next, we install an event handler for the tag manager's `discover` event,
which will be fired for each associated tag.

        manager.on('discover', (tag) => {
            logTag(tag);

Each tag will also fire `discover` events, for each sensor they have.

             tag.on('discover', (sensor) => { logSensor(sensor); });

Tags also fire a `data` event each time their data is updated (which
includes data for their sensors).

             tag.on('data', (tagObj) => {
                logTag(tagObj);
                tagObj.eachSensor(logSensor);
             });

Once event handlers for the tag are installed, ask the tag to find its
sensors. When that completes successfully, start the update loop for
this tag, and install a timeout that will stop it after the
preconfigured time. 

             tag.discoverSensors().then((sensors) => {
                 tag.startUpdateLoop();
                 setTimeout(tag.stopUpdateLoop.bind(tag), END_AFTER);
                 return sensors;  // only needed if we kept chaining
             }).catch((e) => {
                console.error(e.stack ? e.stack : e);
                throw e;
             });

Now ask the tag manager to find associated tags, which will trigger
the `discover` events for tags.

         }); // end of manager.on()

         manager.discoverTags().
             catch((e) => {console.error(e.stack ? e.stack : e)});
    }); // end of platform.on()

### Connect to platform

Once the event handlers are set up, connect to the platform. If
successful, this will trigger the `connect` event, from which the rest
proceeds.

    platform.connect(Platform.loadConfig()).
        catch((e) => { console.error(e.stack ? e.stack : e) });

### Do something with tags and sensors

The rest is defining the actions for tags and sensors. Here we just
log some of their properties, including sensors' reading and current
event state.

Both tag and sensor objects override the .toString() method to
produce a compact stringified-JSON representation of their key
properties, so dumping this to the terminal can be informative.
Uncomment the corresponding lines in the code below to do so.

```js
function logTag(tag) {
    console.log("Tag", tag.name, "(slaveId=" + tag.slaveId + ")");
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
