"use strict";

/** 
 * Simple example script that demonstrates how to use the polling
 * updater to update tag data automatically when there is an
 * update. Unlike the auto-update loop based on the update interval
 * configured for each tag, this method should capture events
 * triggered from armed sensors within a short amount of time.
 *
 * The principle flow is similar to the interval-based auto-updating
 * example: 
 *
 * 1. Connect to cloud, find tag managers.
 * 2. For each tag manager, find its associated tags.
 * 3. For each tag, find its sensors.
 * 4. Once we have all tags for a tag manager, hand them over to the
 *    TagUpdater instance for auto-updating.
 * 5. When there is new data for a tag, log useful properties for each
 *    of its sensors (here: reading, event state (such as "Too High"
 *    for temperature), and whether it is armed (meaning that events
 *    trigger alerts, such as push notification).
 * 6. Keep auto-updating for a set period of time.
 * 
 * The implementation here uses mostly event handlers to proceed once
 * the initial connect() succeeds. One could equally well use
 * mostly Promise-chaining (via .then()).
 *
 * Both tag and sensor objects override the .toString() method to
 * produce a compact stringified-JSON representation of their key
 * properties, so dumping this to the terminal can be informative.
 * Uncomment the corresponding lines in the code below to do so.
 */
var Platform = require('../'),
    platform = Platform.create(),
    TagUpdater = require('../plugins/polling-updater');

const END_AFTER = 30 * 60 * 1000; // value is in milliseconds

platform.on('connect', () => {
    console.log("connected to Wireless Tag cloud");
    platform.discoverTagManagers().
        catch((e) => { console.error(e.stack ? e.stack : e) });
});

let updater = new TagUpdater();
platform.on('discover', (manager) => {
    console.log("found manager", manager.name, manager.mac);
    manager.on('discover', (tag) => {
        logTag(tag);
        tag.on('discover', (sensor) => { logSensor(sensor); });
        tag.on('data', (tag) => { logTag(tag); tag.eachSensor(logSensor); });
        tag.discoverSensors().
            catch((e) => { console.error(e.stack ? e.stack : e); throw e; });
    });
    manager.discoverTags().
        then((tags) => {
            updater.addTags(tags);
            updater.startUpdateLoop();
            setTimeout(updater.stopUpdateLoop.bind(updater), END_AFTER);
            return tags; // only needed if we kept chaining
        }).
        catch((e) => { console.error(e.stack ? e.stack : e) });
});

platform.connect(Platform.loadConfig()).
    catch((e) => { console.error(e.stack ? e.stack : e) });

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
