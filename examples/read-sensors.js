"use strict";

/** 
 * Simple example script that demonstrates what might be a
 * typical flow for reading sensors.
 * 
 * The principle flow is the following:
 *
 * 1. Connect to cloud.
 * 2. Find tag managers.
 * 3. For each tag manager, find its associated tags.
 * 4. For each tag, find its sensors.
 * 5. For each tag and its sensors, log useful properties (for
 *    sensors, reading, event state (such as "Too High" for
 *    temperature), and whether it is armed (meaning that events
 *    trigger alerts, such as push notification).
 * 6. Keep looping for a set period of time by updating the data for
 *    each tag at the interval configured for each tag. Log sensor
 *    properties every time data for the respective tag is updated.
 * 
 * The implementation here uses mostly event handlers to proceed once
 * the initial connect() succeeds. One could equally well use
 * Promise-chaining (via `.then()`).
 *
 * Both tag and sensor objects override the .toString() method to
 * produce a compact stringified-JSON representation of their key
 * properties, so dumping this to the terminal can be informative.
 * Uncomment the corresponding lines in the code below to do so.
 *
 * @module
 */

var Platform = require('../'),
    platform = Platform.create();

const END_AFTER = 30 * 60 * 1000; // value is in milliseconds

platform.on('connect', () => {
    console.log("connected to Wireless Tag cloud");
    platform.discoverTagManagers().
        catch((e) => { console.error(e.stack ? e.stack : e) });
});
platform.on('discover', (manager) => {
    console.log("found manager", manager.name, manager.mac);
    manager.on('discover', (tag) => {
        logTag(tag);
        tag.on('discover', (sensor) => { logSensor(sensor); });
        tag.on('data', (tag) => { logTag(tag); tag.eachSensor(logSensor); });
        tag.discoverSensors().
            then((sensors) => {
                tag.startUpdateLoop();
                setTimeout(tag.stopUpdateLoop.bind(tag), END_AFTER);
                return sensors;  // only needed if we kept chaining
            }).
            catch((e) => { console.error(e.stack ? e.stack : e); throw e; });
    });
    manager.discoverTags().catch((e) => {console.error(e.stack ? e.stack : e)});
});

platform.connect(Platform.loadConfig()).
    catch((e) => { console.error(e.stack ? e.stack : e) });

/** Logs properties of the given tag. */
function logTag(tag) {
    console.log("Tag", tag.name, "(slaveId=" + tag.slaveId + ")");
    // console.log(".. properties:", tag.toString());
}

/** Logs properties of the given sensor. */
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
