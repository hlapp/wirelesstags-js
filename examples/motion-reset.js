"use strict";

var Platform = require('wirelesstags');
var platform = Platform.create();

var tagToReset = process.argv[2];

if (tagToReset === undefined) {
    console.log("Usage: node motion-reset.js <name of tag>");
    console.log();
    console.log("Resets the motion status of (armed) tags with the given name.");
    process.exit(1); // eslint-disable-line no-process-exit
}

platform.connect(Platform.loadConfig()).then(function () {
    return platform.discoverTags({ name: tagToReset });
}).then(function (tags) {

    if (tags.length === 0) {
        throw new Error("error: can't find tag with name " + tagToReset);
    }
    tags = tags.filter(function (t) {
        return t.hasEventSensor();
    });
    if (tags.length === 0) {
        throw new Error("error: tag(s) \"" + tagToReset + "\" does not sense motion events");
    }

    var proms = [];
    tags.forEach(function (t) {
        return proms.push(t.createSensor('event').reset());
    });
    return Promise.all(proms);
}).then(function (sensors) {
    sensors.forEach(function (sensor) {
        return console.log("reset motion status for " + sensor.wirelessTag.name);
    });
}).catch(function (err) {
    // eslint-disable-next-line wrap-regex
    if (err && err.message && /^error:/.test(err.message)) {
        console.error(err.message);
        process.exitCode = 2;
    } else {
        console.error(err.stack ? err.stack : err);
        process.exitCode = 128;
    }
});