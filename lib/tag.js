"use strict";

/** @module */
module.exports = WirelessTag;

var util = require('util'),
    EventEmitter = require('events'),
    u = require('./util'),
    OperationIncompleteError = require('./error/OperationIncompleteError'),
    RetryUnsuccessfulError = require('./error/RetryUnsuccessfulError'),
    WirelessTagSensor = require('./sensor'),
    kumostat = require('./kumostat');

const roTagProps = ["uuid", "slaveId", "tagType", "alive", "rev"];
const rwTagProps = ["name",
                    ["updateInterval", "postBackInterval"],
                    ["lowPowerMode", "rssiMode"]
                    ];
/**
 * @const {number} - the minimum amount of time in milliseconds to wait
 *           between consecutively fetching a new update from the cloud
 * @default
 */
const MIN_UPDATE_LOOP_WAIT = 3000;    // minimum wait time between loops
/**
 * @const {number} - the maximum amount of time in milliseconds to wait
 *           between consecutively fetching a new update from the cloud
 * @default
 */
const MAX_UPDATE_LOOP_WAIT = 1800000; // maximum wait time between loops - 30min
/**
 * @const {number} - the typical delay (in milliseconds) between the time
 *           a tag's data record is from (see [lastUpdated()]{@link WirelessTag#lastUpdated}),
 *           and the time it shows up in the cloud.
 * @default
 */
const CLOUD_DATA_DELAY = 55000;      // delay with which data shows up in cloud

/**
 * @const {object} - Default options for [retrying updates]{@link WirelessTag#retryUpdateUntil}
 *           from the cloud.
 * @default
 */
const DEFAULT_RETRY_OPTIONS = {
    minTimeout: MIN_UPDATE_LOOP_WAIT,
    maxTimeout: MAX_UPDATE_LOOP_WAIT,
    retries: 4
};

/**
 * The cloud instance of a Wireless Tag. One {@link WirelessTagManager}
 * can manage multiple Wireless Tags. A user will not normally need to
 * create instances directly; instead they are found, and created by
 * {@link WirelessTagManager#discoverTags}.
 *
 * @param {WirelessTagManager} tagManager - the tag manager instance that
 *                             discovered this tag
 * @param {Object} tagData - the object comprising the tag's status
 *                           properties, as returned by the API endpoint.
 *
 * @class
 * @alias WirelessTag
 *
 * @property {string} uuid - unique identifier for the tag (r/o)
 * @property {number} slaveId - number enumerating all tags associated with
 *              a tag manager, thus only unique for a tag manager (r/0)
 * @property {string} name - the (user-assigned) name of the tag (r/w)
 * @property {number} tagType - a numeric code identifying the type of the
 *              tag (r/o)
 * @property {boolean} alive - whether the tag is "alive" (r/o)
 * @property {number} rev - a numeric code identifying the hardware
 *              revision of a tag (r/o)
 * @property {number} updateInterval - the interval in seconds at which
 *              the tag should update the cloud with the latest data (r/w)
 *              (when setting the value, the change must be put into effect
 *              by {@link WirelessTag#setUpdateInterval})
 * @property {boolean} lowPowerMode - whether or not the tag is in low
 *              power receiving mode (low power mode can considerably prolong
 *              battery life, at the expense of needing longer to respond
 *              to the tag manager) (when setting the value, the change must
 *              be put into effect by {@link WirelessTag#setLowPowerMode})
 */
function WirelessTag(tagManager, tagData) {
    EventEmitter.call(this);
    /** @member {WirelessTagManager} */
    this.wirelessTagManager = tagManager;
    this.errorHandler =
        tagManager ? tagManager.errorHandler : u.defaultHandler;
    if (tagManager && tagManager.wirelessTagPlatform) {
        let platform = tagManager.wirelessTagPlatform;
        /** @member {function} - see {@link WirelessTagPlatform.callAPI} */
        this.callAPI = platform.callAPI;
        this.log = platform.log;
    }
    u.defineOnChangeProperty(this, 'data', 'data');
    roTagProps.forEach((p) => u.defineLinkedProperty(this, p, 'data', true));
    rwTagProps.forEach((p) => u.defineLinkedProperty(this, p, 'data', false));
    /** @member {object} - the JSON object returned by the cloud API */
    this.data = tagData || {};
    if (this.isKumostat()) kumostat(this);
    this.on('_data', this.bounceUpdateLoop.bind(this));
}
util.inherits(WirelessTag, EventEmitter);

/**
 * Obtains the list of sensor types supported by this tag, such as `light`,
 * `humidity`, `temp` (for temperature), etc.
 *
 * @returns {string[]}
 */
WirelessTag.prototype.sensorCapabilities = function() {
    var capabilities = [];
    for (let propName in this) {
        if (propName.startsWith("has") && propName.endsWith("Sensor")) {
            let propValue = this[propName];
            if ((('function' === typeof propValue) && propValue.call(this))
                || (('function' !== typeof propValue) && propValue)) {
                capabilities.push(propName.
                                  replace(/has(\w+)Sensor/, '$1').
                                  toLowerCase());
            }
        }
    }
    return capabilities;
};

/**
 * Obtains list of positive capabilities (canXXX()) and facts (isYYY(),
 * hasZZZ()). Does not include sensor capabilities, see
 * {@link WirelessTag#sensorCapabilities} for that.
 *
 * @returns {string[]}
 */
WirelessTag.prototype.hardwareFacts = function() {
    let facts = [];
    for (let cap in this) {
        if (cap.startsWith("can")
            || cap.startsWith("is")
            || (cap.startsWith("has") && !cap.endsWith("Sensor"))) {
            if (cap === "isHTU") continue; // deprecated, hence skip
            let propValue = this[cap];
            if ((('function' === typeof propValue) && propValue.call(this))
                || (('function' !== typeof propValue) && propValue)) {
                facts.push(cap);
            }
        }
    }
    return facts;
};

/**
 * Invokes the given action on each previously created sensor object, and
 * returns the results as an array. The default action if none is specified
 * simply returns the sensor object, and hence results in the list of
 * (previously created) sensor objects.
 *
 * Note that this method will not create or initialize sensor objects that
 * would be supported by the tag but have not been
 * [initialized]{@link WirelessTag#initializeSensor} or
 * [created]{@link WirelessTag#createSensor} yet.
 *
 * @param {function} action - the function to invoke for each sensor object
 * @returns {Array} the results of each invocation
 */
WirelessTag.prototype.eachSensor = function(action) {
    if (action === undefined) action = (s) => s;
    let capabilities = this.sensorCapabilities();
    let retVals = [];
    for (let cap of capabilities) {
        let sensor = this[cap + "Sensor"];
        if (sensor) retVals.push(action(sensor));
    }
    return retVals;
};

/** The version of the tag as a string. */
WirelessTag.prototype.version = function() {
    switch (this.data.version1) {
    case 2:
        switch (this.rev) {
            case 14: return "2.1";
            case 15: return "2.2";
            case 31: return "2.3";
            case 32: return "2.4";
        }
        if (this.rev > 32) return "2.5";
        return "2.0";
    case 3:
        return "3.0";
    case 4:
        return "4.0";
    }
    // future proof with a default
    if (this.data.version1 >= 5) return this.data.version1.toFixed(1);
    // at this point version1 == 1 or undefined (which we'll take as 1 too)
    if (this.tagType === 12) {
        switch (this.rev) {
        case 0: return "1.1";
        case 1: return "1.2";
        case 11: return "1.3";
        case 12: return "1.4";
        case 13: return "1.5";
        }
    }
    return this.data.version1 ? this.data.version1.toFixed(1) : "1.0";
};

/** Whether the tag has a motion sensor. */
WirelessTag.prototype.hasMotionSensor = function() {
    if ((this.rev & 0x0F) === 0x0E && this.rev >= 0x4E) return false;
    return (this.tagType === 12 || this.tagType === 13 || this.tagType === 21);
};
/** Whether the tag has a light sensor. */
WirelessTag.prototype.hasLightSensor = function() {
    return (this.tagType === 26);
};
/** Whether the tag has a moisture sensor. */
WirelessTag.prototype.hasMoistureSensor = function() {
    if (this.isOutdoorTag() && (this.rev & 0x0F) === 0x0E) return true;
    return (this.tagType === 32 || this.tagType === 33);
};
/** Whether the tag has a water sensor. */
WirelessTag.prototype.hasWaterSensor = function() {
    return (this.tagType === 32 || this.tagType === 33);
};
/** Whether the tag has a Reed sensor. */
WirelessTag.prototype.hasReedSensor = function() {
    return (this.tagType === 52 || this.tagType === 53);
};
/** Whether the tag has a PIR (motion) sensor. */
WirelessTag.prototype.hasPIRSensor = function() {
    return (this.tagType === 72);
};
/**
 * Whether the tag has an 'event' sensor. This is a virtual rather than a
 * physical sensor. Events include 'Moved', 'Opened', etc, and are reported
 * by tags with motion, light, Reed, and PIR sensors.
 */
WirelessTag.prototype.hasEventSensor = function() {
    return (this.hasMotionSensor()
            || this.hasLightSensor()
            || this.hasReedSensor()
            || this.hasPIRSensor());
};
/** Whether the tag has a humidity sensor. */
WirelessTag.prototype.hasHumiditySensor = function() {
    return (this.tagType === 13
               || this.tagType === 21
               || this.tagType === 26
               || this.tagType === 52
               || this.tagType === 72
               || this.tagType === 102
               || this.tagType === 106
               || this.tagType === 107
        );
};
/** Whether the tag has a temperature sensor. */
WirelessTag.prototype.hasTempSensor = function() {
    return !(this.tagType === 82 || this.tagType === 92);
};
/**
 * Whether the tag has an secondary temperature sensor available concurrent
 * with a primary one.
 *
 * For tags that can measure temperature in different ways but for which one
 * temperature sensor stands in for the other (which currently includes the
 * GE Protimeter model of the Outdoor tags), this will return `false`.
 */
WirelessTag.prototype.hasSecondaryTempSensor = function() {
    return (this.isOutdoorTag() && (this.rev & 0x0F) === 0x0F);
};
/**
 * Whether the tag has a current sensor.
 *
 * Note that the current sensor tag has been discontinued, so this will now
 * always return false.
 */
WirelessTag.prototype.hasCurrentSensor = function() {
    // This used to be tagType 42, but apparently current sensor has been
    // discontinued. Unfortunately tagType 42 is now used for a different
    // type of sensor, namely Outdoor Temperature & Humidity, so we have
    // currently no way of detecting whether a current sensor is back or not.
    return false;
};
/**
 * Whether the tag tracks and reports out of range status. (All non-virtual
 * tags do.)
 */
WirelessTag.prototype.hasOutOfRangeSensor = function() {
    return this.isPhysicalTag();
};
/**
 * Whether the tag reports battery charge status. (All non-virtual tags do.)
 */
WirelessTag.prototype.hasBatterySensor = function() {
    return this.isPhysicalTag();
};
/**
 * Whether the tag reports the signal strength from the tag manager. (All
 * non-virtual tags do.)
 */
WirelessTag.prototype.hasSignalSensor = function() {
    return this.isPhysicalTag();
};
/**
 * Whether the tag reports the batteryRemaining. (All
 * non-virtual tags do.)
 */
 WirelessTag.prototype.hasBatteryRemainingSensor = function() {
    return this.isPhysicalTag();
};
/** Whether the tag's motion sensor is an accelerometer. */
WirelessTag.prototype.hasAccelerometer = function() {
    return this.hasMotionSensor() && ((this.rev & 0x0F) === 0x0A);
};
/**
 * Whether an external probe for measuring temperature can be connected to
 * the tag.
 */
WirelessTag.prototype.canExternalTempProbe = function() {
    return this.hasReedSensor() || this.isOutdoorTag();
};
/** Whether the tag's motion sensor can time out. */
WirelessTag.prototype.canMotionTimeout = function() {
    return this.hasMotionSensor()
        && this.rev >= 14
        && (this.tagType !== 12 || this.rev !== 15);
};
/** Whether the tag can beep. */
WirelessTag.prototype.canBeep = function() {
    return this.tagType === 13
        || this.tagType === 12
        || this.tagType === 21
        || this.tagType === 26;
};
/** Whether the tag can play back data recorded while offline. */
WirelessTag.prototype.canPlayback = function() {
    return (this.tagType === 21);
};
/** Whether the tag's temperature sensor is high-precision (> 8-bit). */
WirelessTag.prototype.canHighPrecTemp = function() {
    return this.tagType === 13 || this.tagType === 21 // motion && type != 12
        || this.tagType === 52                        // reed && type != 53
        || this.tagType === 26                        // ambient light
        || this.tagType === 72                        // PIR
        || this.tagType === 42                        // outdoor tag w/ probe
        || this.tagType === 106                       // precision ext-power sensor
        || this.isKumostat()
    ;
};
/**
 * Whether the tag's temperature sensor is high-precision (> 8-bit).
 *
 * @deprecated since v0.7.x, use [canHighPrecTemp()]{@link WirelessTag#canHighPrecTemp} instead
 */
WirelessTag.prototype.isHTU = function() {
    if (this.log) {
        let log = this.log.warn || this.log.info;
        log(__filename.replace(__dirname, "").substring(1)
            + ": tag.isHTU() is deprecated, use tag.canHighPrecTemp() instead");
    }
    return this.canHighPrecTemp();
};
/** Whether the tag object represents a physical rather than a virtual tag. */
WirelessTag.prototype.isPhysicalTag = function() {
    return ! (this.isKumostat()
              || this.isNest()
              || this.isWeMo()
              || this.isCamera());
};
/**
 * Whether the tag is of the Outdoor series.
 *
 * Tag models of the Outdoor series use external probes for temperature
 * and/or humidity, and feature a water and dustproof enclosure.
 */
WirelessTag.prototype.isOutdoorTag = function() {
    return this.tagType === 42;
};
/**
 * Whether the tag is (i.e., requires) an external temperature probe.
 *
 * In contrast to [canExternalTempProbe]{@link WirelessTag#canExternalTempProbe},
 * if `true` there is no alternative for measuring temperature.
 */
WirelessTag.prototype.isExternalTempProbe = function() {
    return this.isOutdoorTag() && ((this.rev & 0x0F) === 0x0D);
};
/** Whether the tag object represents a linked thermostat. */
WirelessTag.prototype.isKumostat = function() {
    return (this.tagType === 62);
};
/** Whether the tag object represents a Nest thermostat. */
WirelessTag.prototype.isNest = function() {
    return (this.data.thermostat !== null
            && this.data.thermostat.nest_id !== null);
};
/** Whether the tag object represents WeMo lights. */
WirelessTag.prototype.isWeMo = function() {
    return (this.tagType === 82);
};
/** Whether the tag object represents a WeMo LED. */
WirelessTag.prototype.isWeMoLED = function() {
    return (this.isWeMo() && (this.data.cap > 0));
};
/** Whether the tag object represents a Dropcam camera. */
WirelessTag.prototype.isCamera = function() {
    return (this.tagType === 92);
};

/**
 * When the tag last updated the cloud with its latest data.
 *
 * @returns {Date}
 */
WirelessTag.prototype.lastUpdated = function() {
    return new Date(u.FILETIMEtoDate(this.data.lastComm));
};

/**
 * Discovers the [sensor objects]{@ink WirelessTagSensor} supported by this
 * tag. More specifically, for each [sensor capability]{@link WirelessTag#sensorCapabilities}
 * of the tag, [initializes]{@link WirelessTag#initializeSensor} the sensor
 * object.
 *
 * Emits a `discover` event for each newly created sensor object once it
 * completes initialization. For previously created sensor objects no
 * `discover` event will be emitted.
 *
 * @returns {Promise} Resolves to a list of initialized {@link WirelessTagSensor}
 *             objects, representing the sensors supported by this tag.
 */
WirelessTag.prototype.discoverSensors = function() {
    let proms = [];
    this.sensorCapabilities().forEach(
        (sensorType) => proms.push(this.initializeSensor(sensorType))
    );
    return Promise.all(proms);
};

/**
 * Obtains, and if necessary initializes the [sensor object]{@link WirelessTagSensor}
 * of the given type for this tag.
 *
 * Upon completion of initialization, the sensor object created in this way
 * will subsequently be available (cached) as property `tag.zzzzSensor`, where
 * `zzzz` is the type of the sensor. An already cached sensor object will not
 * be initialized again.
 *
 * For a newly created sensor object, emits a `discover` event once it
 * completes initialization. No event will be fired for previously cached
 * objects.
 *
 * @param {string} sensorType - the type of the sensor for which to initialize
 *           the sensor object
 * @returns {Promise} Resolves to the sensor object. If it was newly created,
 *           resolves once initialization of the sensor object completes.
 */
WirelessTag.prototype.initializeSensor = function(sensorType) {
    let sensorProp = sensorType + 'Sensor';
    if (this[sensorProp]) return Promise.resolve(this[sensorProp]);
    let sensor = this.createSensor(sensorType);

    /* eslint-disable no-prototype-builtins */
    function cacheAndNotify(tag, s, propName) {
        if (! tag.hasOwnProperty(propName)) {
            Object.defineProperty(tag, propName, {
                enumerable: true, value: s
            });
        }
        tag.emit('discover', tag[propName]);
    }
    /* eslint-enable no-prototype-builtins */

    // asynchronously populate the sensor's monitoring config, and issue
    // the 'discover' event only when that completes (successfully or not)
    return sensor.monitoringConfig().update().then(
        () => {
            cacheAndNotify(this, sensor, sensorProp);
            // make sure that in the case of concurrent threads getting here
            // we consolidate on the value that got first set for the property
            return this[sensorProp];
        },
        (error) => {
            cacheAndNotify(this, sensor, sensorProp);
            this.errorHandler()(error);
        }
    );
};

/**
 * Creates a [sensor object]{@link WirelessTagSensor} for the given type of
 * sensor.
 *
 * Note that no further initialization involving the cloud API is performed,
 * and so this method behaves mostly as a factory. Specifically this means
 * that the returned sensor object will not have its sensor configuration data
 * loaded (see [MonitoringConfig.update()]{@link MonitoringConfig#update}).
 *
 * @param {string} sensorType = the type of sensor object to be created
 * @returns {WirelessTagSensor}
 * @throws {Error} if the tag does not support the requested type of sensor
 */
WirelessTag.prototype.createSensor = function(sensorType) {
    if (this.sensorCapabilities().indexOf(sensorType) < 0) {
        throw Error(`tag ${this.name} does not support ${sensorType} sensor`);
    }
    return new WirelessTagSensor(this, sensorType);
};

/**
 * Updates the tag object's data from the cloud. How current the data are
 * will depend on the interval at which the actual tag posts its latest
 * data to the cloud (property `updateInterval`).
 *
 * Emits a `data` event if the update results in new data being fetched.
 * Note that "new data" does not have to mean that any of the sensor-specific
 * data changed (such as temperature or humidity).
 *
 * @param {module:wirelesstags~apiCallback} [callback]
 * @returns {Promise} Resolves to this tag object once the update completes.
 */
WirelessTag.prototype.update = function(callback) {
    var req = this.callAPI(
        '/ethClient.asmx/GetTagForSlaveId',
        { slaveid: this.slaveId },
        callback);
    return req.then(
        (result) => {
            this.data = result;
            if (callback) callback(null, { object: this });
            return this;
        });
};

/**
 * Retries calling [update()]{@link WirelessTag#update} until it is
 * considered successful.
 *
 * A typical use-case for this method is when as a result of invoking a
 * cloud API method actuating the tag or one of its sensors the tag's
 * updated data do not reflect the change even though the API call returned
 * success. For exampe, an API call to arm a sensor might have succeeded, yet
 * the updated data continue to show the sensor as disarmed. Most of the time
 * this discrepancy will resolve itself after some time by simply continuing to
 * fetch updates from the cloud until the armed status is properly reflected.
 *
 * This method will wait an exponentially increasing amount of time between
 * consecutive retries, and by default will give up after a certain number
 * of unsuccessful attempts (see parameter `options` and their defaults).
 *
 * Note that if `update()` rejects with anything other than a
 * [OperationIncompleteError]{@link WirelessTagPlatform.OperationIncompleteError}
 * it will not be retried.
 *
 * @param {function} success - A function evaluating whether the update is
 *           to be considered successful or not. It is passed the tag object
 *           and a number giving the attempt, and is expected to return a value
 *           evaluating to `true` if retries should stop. Otherwise, the
 *           function should throw a [RetryUnsuccessfulError]{@link WirelessTagPlatform.RetryUnsuccessfulError}.
 * @param {object} [options] - options for controlling the retries, see
 *           [DEFAULT_RETRY_OPTIONS]{@link module:lib/tag~DEFAULT_RETRY_OPTIONS}
 *           for defaults.
 * @param {number} [options.minTimeout] - the minimum amount of time in
 *           milliseconds to wait between retries
 * @param {number} [options.maxTimeout] - the maximum amount of time in
 *           milliseconds to wait between retries
 * @param {number} [options.retries] - the number of times to retry before
 *           giving up
 * @returns {Promise} Resolves to the tag if retrying is eventually
 *           considered successful, and rejects with an
 *           [OperationIncompleteError]{@link WirelessTagPlatform.OperationIncompleteError}
 *           otherwise.
 */
WirelessTag.prototype.retryUpdateUntil = function(success, options) {
    let successFunc = (tag, attempt) => {
        if (success(tag, attempt)) return true;
        // the success() function did not return truthy, convert to throw
        throw new RetryUnsuccessfulError(
            "retrying tag update remains unsuccessful",
            tag,
            "update",
            attempt);
    };
    options = Object.assign(DEFAULT_RETRY_OPTIONS, options);
    return u.retryUntil(this.update.bind(this), successFunc, options);
};

/**
 * Similar to {@link WirelessTag#retryUpdateUntil}, except that the first
 * attempt to [update]{@link WirelessTag#update} is made immediately,
 * and `success()` is called first without the retry attempt number.
 *
 * Hence, if the initial call to `success()` evaluates to true, no retry
 * will be made. Otherwise, retries are passed to `retryUpdateUntil()`.
 */
WirelessTag.prototype.updateUntil = function(success, retryOptions) {
    return this.update().then((tag) => {
        if (success(tag)) return tag;
        // success function didn't return truthy, convert to throw
        throw new OperationIncompleteError("update of tag deemed unsuccessful",
                                           tag,
                                           "update");
    }).catch((e) => {
        if (e instanceof OperationIncompleteError) {
            return this.retryUpdateUntil(success, retryOptions);
        }
        throw e;
    });
};

/**
 * Similar to {@link WirelessTag#update}, but requests that the physical
 * tag posts its current "live" data to the cloud, which will then be fetched.
 *
 * Therefore, to succeed this method requires a response from the tag to a
 * request issued by the tag manager to which it is associated. If the tag
 * is in `lowPowerMode`, response can take 5-15 seconds (or even longer).
 *
 * Emits a `data` event on success. Note that this does not have to mean
 * that any of the sensor-specific data changed (such as temperature or
 * humidity); all that may have changed could be the [lastUpdated()]{@link WirelessTag#lastUpdated}
 * value.
 *
 * @param {module:wirelesstags~apiCallback} [callback]
 * @returns {Promise} Resolves to this tag object once the update completes.
 */
WirelessTag.prototype.liveUpdate = function(callback) {
    var req = this.callAPI(
        '/ethClient.asmx/RequestImmediatePostback',
        { id: this.slaveId },
        callback);
    return req.then(
        (result) => {
            this.data = result;
            if (callback) callback(null, { object: this });
            return this;
        });
};

/**
 * Start auto-updating (see [update()]{@link WirelessTag#update}) this tag
 * object from the cloud according to the update interval configured for
 * the tag (see property `updateInterval` and
 * [setUpdateIJnterval()]{@link WirelessTag#setUpdateInterval}).
 *
 * @param {number} [minWait] - the minimum amount of time in milliseconds to
 *          wait before invoking the next update call to the cloud API
 *          (defaults to [MIN_UPDATE_LOOP_WAIT]{@link module:lib/tag~MIN_UPDATE_LOOP_WAIT})
 * @returns {number} The ID of the timer triggering the next update call.
 */
WirelessTag.prototype.startUpdateLoop = function(minWait) {
    if (minWait === undefined) {
        minWait = MIN_UPDATE_LOOP_WAIT;
    } else if (minWait > MAX_UPDATE_LOOP_WAIT) {
        minWait = MAX_UPDATE_LOOP_WAIT;
    }
    if (this._updateTimer) return this._updateTimer;
    this._updateTimer = true; // placeholder to avoid race conditions
    let action = () => {
        this._updateTimer = true;  // timer is done but action not yet
        this.update().then(() => {
            // reset wait time upon success
            minWait = undefined;
        }).catch((err) => {
            // report the error, but don't (re)throw it
            this.log.error(err.stack ? err.stack : err);
            // exponentially increase time until retry
            minWait *= 2;
        }).then(() => {
            // with the preceding catch() this is in essence a finally()
            if (this._updateTimer) {
                this._updateTimer = null;
                this.startUpdateLoop(minWait);
            }
            // otherwise we have been cancelled while running the update
        });
    };
    let timeNextExpected =
        this.lastUpdated().getTime()
        + (this.updateInterval * 1000)
        + CLOUD_DATA_DELAY;
    let remainingTime = timeNextExpected - Date.now();
    if (remainingTime < minWait) {
        remainingTime = minWait;
    }
    // ensure that updates weren't cancelled since we entered here
    if (this._updateTimer === true) {
        this._updateTimer = setTimeout(action, remainingTime);
        // stop if and when we are disconnected
        if (! this._disconnectHandler) {
            this._disconnectHandler = this.stopUpdateLoop.bind(this);
            let platform = this.wirelessTagManager.wirelessTagPlatform;
            platform.on('disconnect', this._disconnectHandler);
        }
    }
    return this._updateTimer;
};

/**
 * Stops the automatic update loop for this tag if one was running. Does
 * nothing otherwise.
 *
 * This will be called automatically if the platform object through which
 * this tag object was obtained (directly or indirectly) is
 * [disconnected]{@link WirelessTagPlatform#signoff}.
 */
WirelessTag.prototype.stopUpdateLoop = function() {
    let timer = this._updateTimer;
    this._updateTimer = null;   // avoid race conditions
    if (timer && timer !== true) {
        clearTimeout(timer);
    }
    if (this._disconnectHandler) {
        let platform = this.wirelessTagManager.wirelessTagPlatform;
        platform.removeListener('disconnect', this._disconnectHandler);
        delete this._disconnectHandler;
    }
};

/**
 * [Stops]{@link WirelessTag#stopUpdateLoop} and then
 * [starts]{@link WirelessTag#startUpdateLoop} again the automatic update
 * loop for this tag, if one was currently active. Otherwise does nothing.
 */
WirelessTag.prototype.bounceUpdateLoop = function() {
    let timer = this._updateTimer;
    if (timer && timer !== true) {
        this.log.warn("## bouncing update timer loop for tag", this.slaveId);
        this.stopUpdateLoop();
        this.startUpdateLoop();
    }
};

/**
 * String representation of the tag and its data. Includes a reference to
 * the tag manager (as `name` and `mac`), properties, time data were last
 * posted to cloud, the tag's hardware facts and sensor capabilities, and
 * its version.
 *
 * @returns {string}
 */
WirelessTag.prototype.toString = function() {
    let propsObj = {
        manager: {
            name: this.wirelessTagManager.name,
            mac: this.wirelessTagManager.mac
        }
    };
    // all data properties except private ones
    for (let propName of Object.getOwnPropertyNames(this)) {
        if (! (propName.endsWith('Sensor')
               || propName.startsWith('_')
               || (propName === 'wirelessTagManager')
               || ('function' === typeof this[propName]))) {
            propsObj[propName] = this[propName];
        }
    }
    // remove domain, data, and other undesired properties picked up above
    delete propsObj.data;
    delete propsObj.domain;
    // when tag was last updated
    propsObj.lastUpdated = this.lastUpdated().toString();
    // version
    propsObj.version = this.version();
    // list of positive capabilities (canXXX()) and facts (isYYY(), hasZZZ())
    propsObj.facts = this.hardwareFacts();
    // list of sensor capabilities
    propsObj.sensors = this.sensorCapabilities();
    return JSON.stringify(propsObj);
};

/**
 * Sets the interval at which the physical tag corresponding to this tag
 * object should update the cloud with its current data. Does nothing if the
 * value to be set is already equal to the currently active update interval.
 *
 * @param {number} [value] - the new update interval in seconds; if omitted,
 *          the update interval will be set to the value of the
 *          `updateInterval` property
 * @param {module:wirelesstags~apiCallback} [callback]
 * @returns {Promise} Resolves to this tag object when the operation
 *          completes successfully. Will [retry updating]{@link WirelessTag#retryUpdateUntil}
 *          until the tag's data reflect the new update interval. Rejects
 *          with an [OperationIncompleteError]{@link WirelessTagPlatform.OperationIncompleteError}
 *          if this is still not the case after the
 *          [default number of retries]{@link module:lib/tag~DEFAULT_RETRY_OPTIONS}.
 */
WirelessTag.prototype.setUpdateInterval = function(value, callback) {
    if ('function' === typeof value) {
        callback = value;
        value = undefined;
    }
    if (value === undefined) {
        value = this.updateInterval;
    } else if (value === this.updateInterval) {
        // don't call the API if there is no change
        return Promise.resolve(this);
    }
    if (('number' !== typeof value) || (value <= 0)) {
        throw new TypeError("invalid update interval for tag " + this.name);
    }
    var req = this.callAPI(
        '/ethClient.asmx/SetPostbackIntervalFor',
        { id: this.slaveId, sec: value },
        callback);
    return req.then(
        (result) => {
            this.data = result;
            if (this.updateInterval !== value) {
                // the API call itself succeeded, so this should resolve
                // itself if we retry updating after a short delay
                return this.retryUpdateUntil(
                    (tag) => tag.updateInterval === value
                );
            }
            if (callback) callback(null, { object: this });
            return this;
        });
};

/**
 * Turns the low power mode of the tag on or off. Does nothing if the
 * requested mode is already the one that is active.
 *
 * Note that tags of older hardware revisions don't necessarily support a
 * low power mode. Their low power mode will seem off, but an attempt to turn
 * it on will result in an error.
 *
 * @param {boolean} [value] - whether to enable (`true`) or disable (`false`)
 *          low power mode; if omitted, the value of the `lowPowerMode`
 *          property will be used
 * @param {module:wirelesstags~apiCallback} [callback]
 * @returns {Promise} Resolves to this tag object when the operation
 *          completes successfully. Will [retry updating]{@link WirelessTag#retryUpdateUntil}
 *          until the tag's data reflect the requested value. Rejects
 *          with an [OperationIncompleteError]{@link WirelessTagPlatform.OperationIncompleteError}
 *          if this is still not the case after the
 *          [default number of retries]{@link module:lib/tag~DEFAULT_RETRY_OPTIONS}.
 */
WirelessTag.prototype.setLowPowerMode = function(value, callback) {
    if ('function' === typeof value) {
        callback = value;
        value = undefined;
    }
    if (value === undefined) {
        value = this.lowPowerMode;
    } else if ('boolean' === typeof value) {
        if (this.lowPowerMode === value) {
            if (callback) callback(null, { Object: this });
            return Promise.resolve(this);
        }
    } else {
        throw new TypeError("invalid power mode value for tag " + this.name);
    }

    var req = this.callAPI(
        '/ethClient.asmx/SetLowPowerWOR',
        { id: this.slaveId, enable: value },
        callback);
    return req.then(
        (result) => {
            this.data = result;
            if (this.lowPowerMode !== value) {
                // the API call itself succeeded, so this should resolve
                // itself if we retry updating after a short delay
                return this.retryUpdateUntil(
                    (tag) => tag.lowPowerMode === value
                );
            }
            if (callback) callback(null, { object: this });
            return this;
        });
};
