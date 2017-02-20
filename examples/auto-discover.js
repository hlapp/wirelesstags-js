'use strict';

var Platform = require('wirelesstags');
var platform = Platform.create();

var TagUpdater = require('wirelesstags/plugins/polling-updater');
// must pass either 'platform' or 'options.factory' in discovery mode
var updater = new TagUpdater(platform, { discoveryMode: true });

var END_AFTER = 30 * 60 * 1000; // value is in milliseconds

var connect = platform.connect(Platform.loadConfig());

function dataHandler(tag) {
    // We can register new tag objects so their sensors don't need rediscovering
    // However, this is optional, so feel free to comment it out.
    if (tag.eachSensor().length === 0) {
        tag.on('data', dataHandler);
        updater.addTags(tag);
    }
    // tag.discoverSensors() always promises _all_ of the tag's sensors,
    // so is robust to whether they were already discovered previously
    tag.discoverSensors().then(function (sensors) {
        logTag(tag);
        sensors.forEach(logSensor);
    }).catch(function (e) {
        console.error(e.stack ? e.stack : e);
    });
}

updater.on('data', dataHandler);

connect.then(function () {
    updater.startUpdateLoop();
    // also stop after set duration
    setTimeout(updater.stopUpdateLoop.bind(updater), END_AFTER);
}).catch(function (e) {
    console.error(e.stack ? e.stack : e);
});

function logTag(tag) {
    console.log("Tag", tag.name, "(slaveId=" + tag.slaveId + ")", "of", tag.wirelessTagManager.name, "(mac=" + tag.wirelessTagManager.mac + ")");
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