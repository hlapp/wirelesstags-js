[![Build Status](https://travis-ci.org/hlapp/wirelesstags-js.svg?branch=master)](https://travis-ci.org/hlapp/wirelesstags-js)

# wirelesstags-js - JavaScript API for the Wireless Sensor Tags platform

Aims to provide a well-structured API to the [Wireless Sensor Tag]
platform by interfacing with its [JSON Web Servive API]. Although
primarily intended, designed, and tested for server-side use through
NodeJS, much or all of it may be usable within a webapp as well.

## Usage:

This is at its very beginnings. Documentation is almost non-existent,
and code can change quickly, including the API. Use at your own peril.

With that said, there is the following principle hierarchy:

* `WirelessTagPlatform`: Top-level object representing the cloud
  interface to the platform. Emits `discover` events for
  `WirelessTagManager` instances upon calling `platform.discoverTagManagers()`.

* `WirelessTagManager`: Object representing a [Tag Manager].
   Discovered through the platform object. Emits `discover` event for
   Wireless Tags associated with the tag manager upon calling
   `tagManager.discoverTags()`.

* `WirelessTag`: Object representing a [Wireless Tag]. Discovered
  through the tag manager object. Tags have sensor capabilities, which
  can be queried using `tag.hasHumiditySensor()` etc methods. Sensor
  objects can be discovered by listening to the tag's `discover`
  event, and can be iterated over using `tag.eachSensor()`.

* `WirelessTagSensor`: Object abstracting a sensor that is part of a
  Wireless Tag. Sensor objects usually have a `reading` and a
  `eventState` property, and they can be armed or disarmed
  (`sensor.arm()` and `sensor.disarm()`).

Instantiate platform object:

```javascript
var Platform = require('wirelesstags-js'),
    config = require("./.config.js"), // contains username and password
    platform = new Platform(config);
```

Install handler for discovered tag managers after successful connect:

```javascript
platform.on('connect', () => {
    console.log("connected to Wireless Tag cloud");
    platform.discoverTagManagers().then(
        (r) => { console.log("discovery succeeded"); return r; },
        (e) => { console.error(e.stack ? e.stack : e); throw e; }
    );
});
```

Install handler for discovered tags when tag manager(s) is (are)
discovered, install handler as well as data update handlers for
sensors, and finally start regular updates that follow the update
intervals set for each tag:

```javascript
platform.on('discover', (manager) => {
    console.log("found manager", manager.name, manager.mac);
    manager.on('discover', (tag) => {
        logTag(tag);
        tag.on('discover', (sensor) => { logSensor(sensor); });
        tag.on('data', (tag) => { logTag(tag); tag.eachSensor(logSensor); });
        tag.startUpdateLoop();
        setTimeout(tag.stopUpdateLoop.bind(tag), 16 * 60 * 1000);
    });
    manager.discoverTags();
});

function logTag(tag) {
    console.log("Tag", tag.name, "(slaveId=" + tag.slaveId + ")", tag.uuid);
    console.log(".. last updated", tag.lastUpdated());
}

function logSensor(sensor) {
    console.log("..", sensor.sensorType,
                "of", sensor.wirelessTag.name + ":");
    console.log("    reading:", sensor.reading);
    console.log("    state:", sensor.eventState);
    console.log("    armed:", sensor.isArmed());
}
```

Finally, initiate connection:

```
platform.connect().then(
    (r) => { console.log("connect succeeded"); return r; },
    (e) => { console.error(e.stack ? e.stack : e); throw e; }
);
```
## License

Available under the [MIT License](LICENSE).

[Wireless Sensor Tag]: http://wirelesstag.net
[JSON Web Servive API]: http://mytaglist.com/media/mytaglist.com/apidoc.html
[Tag Manager]: http://wirelesstag.net/specs.html#manager
[Wireless Tag]: http://wirelesstag.net/specs.html#tag
