## Using polling to auto-update sensor data

Simple example script that demonstrates how to use the polling updater
to update tag data automatically when there is an update. Unlike the
auto-update loop based on the update interval configured for each tag
(see {@tutorial read-sensors.js}), this method should capture events
triggered by armed sensors within a short amount of time.

The code in this tutorial is also available as a JavaScript file
(generated automatically from this tutorial) that can be run with
`nodejs`. See the [`examples/`] directory of the package.

### Principle flow

The principle flow is taken straight from {@tutorial read-sensors.js}:

1. Connect to cloud.
2. Find [tag managers]{@link WirelessTagManager}.
3. For each tag manager, find its associated [tags]{@link WirelessTag}.
4. For each tag, find its [sensors]{@link WirelessTagSensor}.
5. Hand sensors over to the TagUpdater instance for auto-updating.
6. When there is new data for a tag, do something useful with the
   data. Here we simply log useful properties for each sensor and tag
   (see {@tutorial read-sensors.js}).
7. Continue updating for a set period of time.

### Create platform object

    var Platform = require('wirelesstags');
    var platform = Platform.create();

### Create tag updater

Here we determine which tag updater we use. Here we want to use the
one that uses polling.

    var TagUpdater = require('wirelesstags/plugins/polling-updater');

### Set up event handlers

In this implementation here we use mostly event handlers to proceed
once the initial [connect()]{@link WirelessTagPlatform#connect}
succeeds. One could equally well use `Promise`-chaining (via
`.then()`). Note that if we do not use callbacks, it is a good idea to
`.catch()` rejected promises, because otherwise errors thrown will be
invisible.

How long to keep looping?

    const END_AFTER = 30 * 60 * 1000; // value is in milliseconds

In the `connect` event handler, trigger discovery of tag managers (see
[discoverTagManagers()]{@link WirelessTagPlatform#discoverTagManagers}):


    platform.on('connect', () => {
        console.log("connected to Wireless Tag cloud");
        platform.discoverTagManagers().catch(
            (err) => { console.error(err.stack ? err.stack : err);
        });
    });

Create the updater instance:

    let updater = new TagUpdater();

The `discover` handler for the platform will receive tag a manager
object on each event.

    platform.on('discover', (manager) => {
        console.log("found manager", manager.name, manager.mac);

Next, we install an event handlers for the tag manager's `discover`
event, which will be fired for each associated tag. For each
discovered tag, install event handlers for `discover` (fired for each
of their sensors) and `data` events (fired each time its data is
updated). This is the same sequence as in {@tutorial read-sensors.js}.
Once event handlers for the tag are installed, ask the tag to find its
sensors.

        manager.on('discover', (tag) => {
            logTag(tag);
            tag.on('discover', (sensor) => { logSensor(sensor); });
            tag.on('data', (tagObj) => {
                logTag(tagObj);
                tagObj.eachSensor(logSensor);
            });
            tag.discoverSensors().catch((e) => {
                console.error(e.stack ? e.stack : e);
                throw e;
            });
        });

Now ask the tag manager to find associated tags (which will trigger
the tag `discover` events and above handler). When done, register all
tags with the update instance, and start polling for updates.

        manager.discoverTags().
            then((tags) => {
                updater.addTags(tags);
                updater.startUpdateLoop();
                setTimeout(updater.stopUpdateLoop.bind(updater), END_AFTER);
                return tags; // only needed if we kept chaining
            }).
            catch((e) => { console.error(e.stack ? e.stack : e) });
    }); // end of platform.on()

### Connect to platform

Once the event handlers are set up, connect to the platform. This is
the same as in {@tutorial read-sensors.js}.

    platform.connect(Platform.loadConfig()).
        catch((e) => { console.error(e.stack ? e.stack : e) });

### Do something with tags and sensors

The actions for tags and sensors here are simply copied from {@tutorial read-sensors.js}.

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
