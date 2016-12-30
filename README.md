[![Build Status](https://travis-ci.org/hlapp/wirelesstags-js.svg?branch=master)](https://travis-ci.org/hlapp/wirelesstags-js)
[![npm](https://img.shields.io/npm/v/wirelesstags.svg)](https://www.npmjs.com/package/wirelesstags)
[![npm](https://img.shields.io/npm/dt/wirelesstags.svg)](https://www.npmjs.com/package/wirelesstags)
[![david-dm](https://david-dm.org/hlapp/wirelesstags-js.svg)](https://david-dm.org/hlapp/wirelesstags-js)
[![david-dm](https://david-dm.org/hlapp/wirelesstags-js/dev-status.svg)](https://david-dm.org/hlapp/wirelesstags-js?type=dev)

# wirelesstags - JavaScript API for the Wireless Sensor Tags platform

Aims to provide a well-structured API to the [Wireless Sensor Tag]
platform by interfacing with its [JSON Web Servive API]. It is
primarily intended, designed, and tested for server-side use through
NodeJS. (However, making it usable within a browser is a future goal,
and corresponding contributions are welcome too.)

This code is alpha. Documentation remains almost non-existent, and
code can change quickly, including the API. Use at your own peril. The
tests are likely to show a more up to date and more complete
description of the API than this document.

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

#### Connect and discover tag managers using events handlers

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

### Discovering tags and their sensors

The tag manager object emits `discover` events for each tag associated
with it after starting discovery with `tagManager.discoverTags()`. In
the same way, tag objects emit `discover` events for each of their
newly found sensors after initiating discovery with
`tag.discoverSensors()`.

As before, the discovery methods also return promises of arrays of
tags and sensors, respectively. Either approach can be used. The
`tag.discoverSensors()` method always promises an array of all its
sensors, whereas it emits `discover` events only for newly found
sensors. Once found, subsequent `tag.discoverSensors()` calls will
promise the same sensor objects. In contrast, the other discovery
methods always emit the same number of events as there are number of
elements in the promised array of discovered objects, and the objects
(in the promised array, or passed to listeners) are always new
objects. That is, tags cache their sensors (and indeed tags in
practice don't lose sensors), but tag managers and platform objects
don't cache their tags and tag managers, respectively (and indeed in
practice tags can be dynamically associated with or disassociated from
tag managers, as well as tag managers from accounts).

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

#### Discovering tags and sensors using returned promises

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

It is considered a bad idea, and not supported (even if it happens to
work) to mix passing callbacks _and_ using the returned Promises.

Note that callback behaviour is not currently tested as part of the
test suite, so there could be bugs.

### Examples

See the `examples/` directory for basic demonstrations of how the
library can be used.

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
[JSON Web Servive API]: http://mytaglist.com/media/mytaglist.com/apidoc.html
[Tag Manager]: http://wirelesstag.net/specs.html#manager
[Wireless Tag]: http://wirelesstag.net/specs.html#tag
