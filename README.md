[![Build Status](https://travis-ci.org/hlapp/wirelesstags-js.svg?branch=master)](https://travis-ci.org/hlapp/wirelesstags-js)
[![npm](https://img.shields.io/npm/v/wirelesstags.svg)](https://www.npmjs.com/package/wirelesstags)
[![npm](https://img.shields.io/npm/dt/wirelesstags.svg)](https://www.npmjs.com/package/wirelesstags)
[![david-dm](https://david-dm.org/hlapp/wirelesstags-js.svg)](https://david-dm.org/hlapp/wirelesstags-js)
[![david-dm](https://david-dm.org/hlapp/wirelesstags-js/dev-status.svg)](https://david-dm.org/hlapp/wirelesstags-js?type=dev)

# wirelesstags - JavaScript API for the Wireless Sensor Tags platform

Aims to provide a well-structured API to the [Wireless Sensor Tag]
platform by interfacing with its [JSON Web Service API]. It is
primarily intended, designed, and tested for server-side use through
NodeJS. (However, making it usable within a browser is a future goal,
and corresponding contributions are welcome too.)

## Installation and setup

```sh
$ npm install wirelesstags
```

The library (specifically, the `platform.connect()` method, see
below) will need authentication information. The library supports two
default ways to pick up this information:

1. A file `$HOME/.wirelesstags` in JSON format, with the necessary
   authentication information (currently keys `username` and
   `password`). This file should obviously be readable only by the
   user running the app.
2. Environment variables `WIRELESSTAG_API_USER` and
   `WIRELESSTAG_API_PASSWORD`, if set, will override whatever is found
   in the default options file.

It is strongly recommended to create a separate account as a "limited
user" for using this library rather than your main account(s) at
Wirelesstag.com. This makes it easy to change the password or delete
the account altogether if the password happens to leak out, and allows
controlling which tag managers and tags are visible to the
account. Note also that wirelesstag.com stores your password in clear
text (you can verify by recovering it), and hence never use a password
there that you use anywhere else.

## Usage

### Principle objects

The principle object hierarchy is the following:

* `WirelessTagPlatform`: Top-level object representing the cloud
  interface to the platform. Emits `discover` events for
  `WirelessTagManager` instances upon calling `platform.discoverTagManagers()`.

* `WirelessTagManager`: Object representing a [Tag Manager].
   Discovered through the platform object. Emits `discover` events for
   Wireless Tags associated with the tag manager upon calling
   `tagManager.discoverTags()`.

* `WirelessTag`: Object representing a [Wireless Tag]. Discovered
  through the tag manager object. Tags have sensor capabilities, which
  can be queried using `tag.hasHumiditySensor()` etc methods, or as an
  array of strings via `tag.sensorCapabilities()`. Sensor objects can
  be discovered by calling `tag.discoverSensors()`, which emits a
  `discover` event for each newly found sensor. They can be iterated
  over using `tag.eachSensor()`, which takes a callback.

* `WirelessTagSensor`: Object abstracting a sensor that is part of a
  Wireless Tag. Sensor objects are of a type (`sensor.sensorType`),
  and usually have a `reading` and an `eventState` property. They
  can be armed or disarmed (`sensor.arm()` and `sensor.disarm()`), and
  their monitoring and notification configuration is available as
  properties of the object returned by `sensor.monitoringConfig()`.

### Initialize platform, connect to cloud, and discover tag managers

The platform object can be created using its constructor, or using the
static method `WirelessTagPlatform.create()`.

```javascript
var WirelessTagPlatform = require('wirelesstags');

// Passing a config object is optional. Default for apiBaseURI is
// https://www.mytaglist.com
var platform = new WirelessTagPlatform({ apiBaseURI: 'https://my.wirelesstag.com' });
```

When using the static `create()` method, it will try to load
configuration options from `~/.wirelesstags`, or from the environment:

```javascript
var WirelessTagPlatform = require('wirelesstags');

var platform = WirelessTagPlatform.create();
```

Platform instances emit a `connect` event after successful
connections, and a `discover` event for each tag manager object. The
`connect()` and `discoverTagManagers()` methods also return promises,
the latter with an array of tag manager objects.

Define or obtain connection options:

```javascript
var opts = { username: 'foo@bar.com', password: 'supersecret' };
// or load from default configuration file or environment variables:
opts = WirelessTagPlatform.loadConfig();
```

#### Connect and discover tag managers using event handlers

```javascript
platform.on('connect', () => {
    console.log("connected to Wireless Tag cloud");
    platform.discoverTagManagers();
});
platform.on('discover', (tagManager) => {
    console.log("found tag manager", tagManager.name, tagManager.mac);
});
// once the listeners are set up we can connect
platform.connect(opts)
```

A platform instance (since v0.6.0) caches tag manager objects
resulting from a call to `discoverTagManagers()`. Subsequent calls
will not update properties of these objects, but emit `discover`
events only for newly found (not previously cached) tag managers. This
allows an application to scan periodically for new tag managers,
without receiving `discover` events redundantly for the same objects.

#### Connect and discover tag managers using returned promises

```javascript
platform.connect(opts).then(() => {
    return platform.discoverTagManagers();
}).then((tagManagers) => {
    tagManagers.forEach((tagManager) => {
        console.log("found tag manager", tagManager.name, tagManager.mac);
    });
});
```

The method always promises _all_ tag manager objects found (hence the
number of `discover` events fired will only on the first call be the
same as the number of objects promised). Since v0.6.0, if called
repeatedly the objects promised for tag managers discovered previously
will be the same (but with updated properties), allowing an
application to scan periodically for new tag managers without losing
the application's state of prviously returnd objects.

### Discovering tags and their sensors

The tag manager object emits `discover` events for each tag associated
with it after starting discovery by calling `tagManager.discoverTags()`.
In the same way, tag objects emit `discover` events for each of their
newly found sensors after initiating discovery with
`tag.discoverSensors()`.

The discovery methods also promise arrays of tags and sensors,
respectively. Either approach (promises or events) can be used.

The `tag.discoverSensors()` method always promises an array of _all_
its sensors, whereas it emits `discover` events _only_ for newly found
sensors. Subsequent `tag.discoverSensors()` calls will promise the
same sensor objects (unless there were new sensors, but the current
generation of Wireless Tags cannot dynamically gain sensors).

In contrast, `tagManager.discoverTags()` always emits the same number
of events as there are elements in the promised array of tag objects,
and the tag objects are always new objects, because tag manager
objects don't cache their associated tag objects. Indeed in practice
tags can be dynamically associated with or disassociated from tag
managers.

#### Discovering tags and sensors using event handlers

```javascript
tagManager.on('discover', (tag) => {
    console.log("Tag", tag.name, "(slaveId=" + tag.slaveId + ")", tag.uuid);
    console.log(".. last updated", tag.lastUpdated());
    tag.on('discover', (sensor) => {
        console.log("..", sensor.sensorType, "of", sensor.wirelessTag.name);
        console.log("    reading:", sensor.reading);
        console.log("    state:", sensor.eventState);
        console.log("    armed:", sensor.isArmed());
    });
    tag.discoverSensors();
});
tagManager.discoverTags();
```

#### Discovering tags and sensors using promises

```javascript
tagManager.discoverTags().then((tags) => {
    tags.forEach((tag) => {
        console.log("Tag", tag.name, "(slaveId=" + tag.slaveId + ")", tag.uuid);
    });
    return Promise.all(tags.map((tag) => { return tag.discoverSensors(); }));
}).then((sensorLists) => {
    sensorLists.forEach((sensors) => {
        var tag = sensors[0].wirelessTag;
        console.log("Sensors of tag", tag.name, tag.uuid);
        sensors.forEach((sensor) => {
            console.log("..", sensor.sensorType, "sensor");
            console.log("    reading:", sensor.reading);
            console.log("    state:", sensor.eventState);
            console.log("    armed:", sensor.isArmed());
        });
    });
});
```

#### Discovering tags and sensors directly from platform

Since v0.6.0, tag objects can be discovered directly in one go from
the platform object, without first finding the tag manager objects.

In terms of performance as determined by the sequence of cloud API
calls, there is no difference to finding the tag managers first if
only one tag manager is accessible to the connected account. However,
in the case of multiple tag managers under the account, the difference
can be notable (because currently the cloud API does not support
filtering tags by tag manager at the server).

```javascript
platform.discoverTags().then((tags) => {
    tags.forEach((tag) => {
        console.log("Tag", tag.name, "of", tag,wirelessTagManager.name,
                    "(slaveId=" + tag.slaveId + ")", tag.uuid);
    });
    // the following may need rate-limiting if there are many tags
    // (e.g., see package p-limit for rate-limiting promises)
    return Promise.all(tags.map((tag) => { return tag.discoverSensors(); }));
}).then((sensorLists) => {
    sensorLists.forEach((sensors) => {
        var tag = sensors[0].wirelessTag;
        console.log("Sensors of tag", tag.name, tag.uuid);
        sensors.forEach((sensor) => {
            console.log("..", sensor.sensorType, "sensor");
            console.log("    reading:", sensor.reading);
            console.log("    state:", sensor.eventState);
            console.log("    armed:", sensor.isArmed());
        });
    });
});
```

#### Finding a specific tag

Each tag is uniquely identified by a UUID (available as `tag.uuid`). This
could be used to pass a query to `platform.discoverTags()`:

```js
var uuidOfTag = 'DESIRED UUID VALUE';
platform.discoverTags({ uuid: uuidOfTag }).then((tags) => {
    if (tags.length === 0) throw new Error("tag not found");
    return tags[0].discoverSensors();
}).then((sensorList) => {
    var tag = sensorList[0].wirelessTag;
    console.log("Sensors of tag", tag.name, tag.uuid);
    sensorList.forEach((sensor) => {
        console.log("..", sensor.sensorType, "sensor");
        console.log("    reading:", sensor.reading);
        console.log("    state:", sensor.eventState);
        console.log("    armed:", sensor.isArmed());
    });
});
```

It should be noted that this has no performance advantage over filtering the
list of tag objects from `platform.discoverTags()`, because the
[JSON Web Service API] has no server-side support for querying by UUID.

Another way to uniquely (at a moment in time) specify a tag is by tag manager
(as identified by its MAC) and the tag's `slaveId` (a consecutive numbering
for the tags associated with a tag manager):

```js
var MAC = 'MAC OF TAG MANAGER';
var slaveId = 'SLAVEID OF DESIRED TAG';
platform.findTagManager(MAC).then((tagMgr) => {
    if (! tagMgr) throw new Error("tag manager not found");
    return tagMgr.findTagById(slaveId); // rejects if not found
}).then((tag) => tag.discoverSensors()).then((sensorList) => {
    var tag = sensorList[0].wirelessTag;
    console.log("Sensors of tag", tag.name, tag.uuid);
    sensorList.forEach((sensor) => {
        console.log("..", sensor.sensorType, "sensor");
        console.log("    reading:", sensor.reading);
        console.log("    state:", sensor.eventState);
        console.log("    armed:", sensor.isArmed());
    });
}).catch((err) => console.error(err.stack ? err.stack : err));
```

For an account with access to many tags this may perform noticeably better
than filtering by UUID, because once the tag manager is found (and the number
of tag managers is likely at least an order of magnitude smaller than the
number of tags), obtaining the tag's data by `slaveId` is supported server-side.

#### Accessing sensors through tag object

Once the promise returned from `tag.discoverSensors()` is fulfilled,
sensor objects can also be accessed through the methods of the tag
object (because tag objects cache their sensors, and in practice
sensors can't be associated with or disassociated from a tag
dynamically). Either use `tag.eachSensor()` with a callback that
accepts a sensor object, or use each sensor's individual accessor
method, which are all named `zzzzSensor()`, where zzzz is the type of
sensor, for example `tag.lightSensor()`. The method
`tag.sensorCapabilities()` returns an array of strings denoting the
possible zzzz values.

#### Changing the temperature unit

By default temperature sensors give their readings and monitoring thresholds
in ºC. The unit can be changed by setting `sensor.monitoringConfig().unit`:

```js
if (sensor.sensorType === "temp") {
    // temperature reading and thresholds in ºC:
    sensor.monitoringConfig().unit = "degC";
    // temperature reading and thresholds in ºF:
    sensor.monitoringConfig().unit = "degF";
    // if desired, the change can be saved to become persistent:
    sensor.monitoringConfig().save().then((mconfig) => {
        console.log("saved monitoring config of temp of", sensor.wirelessTag.name);
        console.log("... unit is now", mconfig.unit);
    });
}
```

### Updating sensor values and tag information

Updating the tag object's data also updates its sensors. `tag.update()`
updates a tag object's data from the cloud, and `tag.liveUpdate()` requests
that the tag immediately post its latest information.

To regularly update a tag object's data whenver the tag posts its latest
information, a loop can be started with `tag.startUpdateLoop()`, and
stopped by `tag.stopUpdateLoop()`.

### Promises versus Callbacks

The library attempts to support both returning Promises from
API-calling asynchronous functions, and the traditional callback
mechanism.

Callbacks are generally called with an error as the first argument if
one occurred, and as the second argument with an object that has keys
`object` (the object in which the operation was performed), and
`value` (the resulting value from that operation) if the operation had
a result that is not saving or updating a property value of the
object. For example, in `platform.isConnected(cb)`, `cb` will be
called with `{ object: platform, value: false }` if the instance
wasn't yet connected.

It is considered a bad idea, and not supported (even if it may often
work) to mix passing callbacks _and_ using the returned Promises.

Note that callback behaviour is not currently tested as part of the
test suite, so there could be bugs.

### Full documentation

This library should be considered beta. Full API documentation is
only starting to come into place, and remains lacking for most of its
functionality:

* [Online API documentation](http://lappland.io/wirelesstags-js/wirelesstags/0.6.2)
* See the [`examples/`](https://github.com/hlapp/wirelesstags-js/tree/release-v0.6.2/examples)
  directory for tutorial scripts that give basic, but fully working
  demonstrations of how the library can be used.

Use at your own peril, and consider looking at the (meanwhile fairly
comprehensive) tests for guidance.

## How to support

Aside from reporting issues and contributing pull requests, if you
plan to buy from Wireless Sensor Tag, you might consider using
[this link](https://goo.gl/GxwQbZ) to their website. If more than 10
people do so, and some end up buying, I stand to receive a discount on
a past purchase of mine, which will allow me to buy other types of
tags in the future and support those too.

## License

Available under the [MIT License](LICENSE).

[Wireless Sensor Tag]: http://wirelesstag.net
[JSON Web Service API]: http://mytaglist.com/media/mytaglist.com/apidoc.html
[Tag Manager]: http://wirelesstag.net/specs.html#manager
[Wireless Tag]: http://wirelesstag.net/specs.html#tag
