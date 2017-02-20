'use strict';

var Platform = require('wirelesstags');
var platform = Platform.create();

var TagUpdater = require('wirelesstags/plugins/polling-updater');

var END_AFTER = 30 * 60 * 1000; // value is in milliseconds

platform.on('connect', function () {
    console.log("connected to Wireless Tag cloud");
    platform.discoverTagManagers().catch(function (err) {
        console.error(err.stack ? err.stack : err);
    });
});

var updater = new TagUpdater();

platform.on('discover', function (manager) {
    console.log("found manager", manager.name, manager.mac);

    manager.on('discover', function (tag) {
        logTag(tag);
        tag.on('discover', function (sensor) {
            logSensor(sensor);
        });
        tag.on('data', function (tagObj) {
            logTag(tagObj);
            tagObj.eachSensor(logSensor);
        });
        tag.discoverSensors().catch(function (e) {
            console.error(e.stack ? e.stack : e);
            throw e;
        });
    });

    manager.discoverTags().then(function (tags) {
        updater.addTags(tags);
        updater.startUpdateLoop();
        setTimeout(updater.stopUpdateLoop.bind(updater), END_AFTER);
        return tags; // only needed if we kept chaining
    }).catch(function (e) {
        console.error(e.stack ? e.stack : e);
    });
}); // end of platform.on()

platform.connect(Platform.loadConfig()).catch(function (e) {
    console.error(e.stack ? e.stack : e);
});

function logTag(tag) {
    console.log("Tag", tag.name, "(slaveId=" + tag.slaveId + ")");
    // console.log(".. properties:", tag.toString());
}

function logSensor(sensor) {
    console.log("..", sensor.sensorType, "of", sensor.wirelessTag.name + ":");
    console.log("    reading:", sensor.reading);
    if (sensor.eventState !== undefined) {
        console.log("    state:", sensor.eventState);
        console.log("    armed:", sensor.isArmed());
    }
    // console.log("... sensor properties:", sensor.toString());
}