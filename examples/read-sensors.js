'use strict';

var Platform = require('wirelesstags');
var platform = Platform.create();

var END_AFTER = 30 * 60 * 1000; // value is in milliseconds

platform.on('connect', function () {
    console.log("connected to Wireless Tag cloud");
    platform.discoverTagManagers().catch(function (err) {
        console.error(err.stack ? err.stack : err);
    });
});

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

        tag.discoverSensors().then(function (sensors) {
            tag.startUpdateLoop();
            setTimeout(tag.stopUpdateLoop.bind(tag), END_AFTER);
            return sensors; // only needed if we kept chaining
        }).catch(function (e) {
            console.error(e.stack ? e.stack : e);
            throw e;
        });
    }); // end of manager.on()

    manager.discoverTags().catch(function (e) {
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