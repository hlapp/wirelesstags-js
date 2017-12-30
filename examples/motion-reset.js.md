## Actuating a sensor

Simple script that demonstrates how to actuate a sensor (if it can be
actuated, such as arming, disarming, or resetting).

You can query `sensor.canArm()` and `sensor.canDisarm()` for whether a sensor
can be armed and disarmed, respectively. Tags with motion, light, Reed, and
PIR sensors report a motion event (test with `tag.hasEventSensor()`) if
they are armed, and their motion status (`Opened`, `Moved`) can be reset.
(By default, they will reset by their configured timeout unless "closed" again.)

Here, we find a tag (or the tags) whose name matches the name specified by
the user, then for each tag get its `event` sensor and reset its motion
status. If we can't find a matching tag, or if the matching tag doesn't have
an event sensor, we print a corresponding error message, and otherwise log
when the reset is successful and complete.

### Create platform object

    var Platform = require('wirelesstags');
    var platform = Platform.create();

### Obtain name to match from command line

    var tagToReset = process.argv[2];

If no name was specified, let's print an informative message and exit:

    if (tagToReset === undefined) {
        console.log("Usage: node motion-reset.js <name of tag>");
        console.log();
        console.log("Resets the motion status of (armed) tags with the given name.");
        process.exit(1); // eslint-disable-line no-process-exit
    }

### Sign in -> find tag(s) -> sensor(s) -> actuate

    platform.signin(Platform.loadConfig()).then(

The [discoverTags()]{@link WirelessTagPlatform#discoverTags} method allows us
to supply a query. (This won't make this faster, because the filtering is
still client-side, but it saves a few lines of code.)

        () => platform.discoverTags({ name: tagToReset })
    ).then((tags) => {

Check whether there are tags matching the name, then filter by those that
report motion events, and ensure we are left with something to work with.
Note that throwing an exception will reject the promise at that point.

        if (tags.length === 0) {
            throw new Error(`error: can't find tag with name ${tagToReset}`);
        }
        tags = tags.filter((t) => t.hasEventSensor());
        if (tags.length === 0) {
            throw new Error(`error: tag(s) "${tagToReset}" does not sense motion events`);
        }

Normally, we would discover all sensors for a tag before doing something
with the sensors, as that ensures their configuration is fully loaded.
However, here we only need to deal with one sensor, and we want to neither
access nor modify its configuration. Hence, we use `tag.createSensor()` to
obtain the tag's `event` sensor (we have already ascertained that it has one),
and then simply call it's `reset()` method.

        let proms = [];
        tags.forEach((t) => proms.push(t.createSensor('event').reset()));
        return Promise.all(proms);

Note that the API calls to actuate the sensors will all run in parallel. If
you have many tags with the same name, you may want to use rate-limiting.
Note also that `Promise.all()` will reject and not wait for others as soon
as one of the promises rejects. To still complete the reset for other tags
if one has failed, use an implementation that waits for all promises to have
settled.

Finally, report success or failure:

    }).then((sensors) => {
        sensors.forEach(
            (sensor) => console.log(`reset motion status for ${sensor.wirelessTag.name}`)
        );
    }).catch((err) => {
        // eslint-disable-next-line wrap-regex
        if (err && err.message && (/^error:/.test(err.message))) {
            console.error(err.message);
            process.exitCode = 2;
        } else {
            console.error(err.stack ? err.stack : err);
            process.exitCode = 128;
        }
    });
