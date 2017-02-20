"use strict";

/** module */
module.exports = WirelessTag;

var util = require('util'),
    EventEmitter = require('events'),
    u = require('./util'),
    OperationIncompleteError = require('./error/OperationIncompleteError'),
    RetryUnsuccessfulError = require('./error/RetryUnsuccessfulError'),
    WirelessTagSensor = require('./sensor');

const roTagProps = ["uuid", "slaveId", "tagType", "alive", "rev"];
const rwTagProps = ["name",
                    ["updateInterval", "postBackInterval"],
                    ["lowPowerMode", "rssiMode"]
                    ];

// the following are in milliseconds
const MIN_UPDATE_LOOP_WAIT = 3000;       // minimum wait time between loops
const MAX_UPDATE_LOOP_WAIT = 30 * 60000; // maximum wait time between loops
const CLOUD_DATA_DELAY = 55 * 1000;   // delay with which data shows up in cloud

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
 */
function WirelessTag(tagManager, tagData) {
    EventEmitter.call(this);
    this.wirelessTagManager = tagManager;
    this.errorHandler =
        tagManager ? tagManager.errorHandler : u.defaultHandler;
    if (tagManager && tagManager.wirelessTagPlatform) {
        let platform = tagManager.wirelessTagPlatform;
        this.callAPI = platform.callAPI;
        this.log = platform.log;
    }
    u.setObjProperties(this, roTagProps, rwTagProps);
    this.data = tagData || {};
    this.on('_data', this.bounceUpdateLoop.bind(this));
}
util.inherits(WirelessTag, EventEmitter);

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

// list of positive capabilities (canXXX()) and facts (isYYY(), hasZZZ())
WirelessTag.prototype.hardwareFacts = function() {
    let facts = [];
    for (let cap in this) {
        if (cap.startsWith("can")
            || cap.startsWith("is")
            || (cap.startsWith("has") && !cap.endsWith("Sensor"))) {
            let propValue = this[cap];
            if ((('function' === typeof propValue) && propValue.call(this))
                || (('function' !== typeof propValue) && propValue)) {
                facts.push(cap);
            }
        }
    }
    return facts;
};

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

WirelessTag.prototype.version = function() {
    switch (this.data.version1) {
    case 2:
        switch (this.rev) {
            case 14: return "2.1";
            case 15: return "2.2";
            case 31: return "2.3";
            case 32: return "2.4";
            default: return "2.0";
        }
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

WirelessTag.prototype.hasMotionSensor = function() {
    return (this.tagType === 12 || this.tagType === 13 || this.tagType === 21);
};
WirelessTag.prototype.hasLightSensor = function() {
    return (this.tagType === 26);
};
WirelessTag.prototype.hasMoistureSensor = function() {
    return (this.tagType === 32 || this.tagType === 33);
};
WirelessTag.prototype.hasWaterSensor = function() {
    return (this.tagType === 32 || this.tagType === 33);
};
WirelessTag.prototype.hasReedSensor = function() {
    return (this.tagType === 52 || this.tagType === 53);
};
WirelessTag.prototype.hasPIRSensor = function() {
    return (this.tagType === 72);
};
WirelessTag.prototype.hasEventSensor = function() {
    return (this.hasMotionSensor()
            || this.hasLightSensor()
            || this.hasReedSensor()
            || this.hasPIRSensor());
};
WirelessTag.prototype.hasHumiditySensor = function() {
    return this.isHTU();
};
WirelessTag.prototype.hasTempSensor = function() {
    return !(this.tagType === 82 || this.tagType === 92);
};
WirelessTag.prototype.hasCurrentSensor = function() {
    return this.tagType === 42;
};
WirelessTag.prototype.hasOutOfRangeSensor = function() {
    return this.isPhysicalTag();
};
WirelessTag.prototype.hasBatterySensor = function() {
    return this.isPhysicalTag();
};
WirelessTag.prototype.hasSignalSensor = function() {
    return this.isPhysicalTag();
};
WirelessTag.prototype.hasAccelerometer = function() {
    return this.hasMotionSensor() && ((this.rev & 0x0F) === 0x0A);
};
WirelessTag.prototype.canMotionTimeout = function() {
    return this.hasMotionSensor()
        && this.rev >= 14
        && (this.tagType !== 12 || this.rev !== 15);
};
WirelessTag.prototype.canBeep = function() {
    return this.tagType === 13
        || this.tagType === 12
        || this.tagType === 21
        || this.tagType === 26;
};
WirelessTag.prototype.canPlayback = function() {
    return (this.tagType === 21);
};
WirelessTag.prototype.isHTU = function() {
    return this.tagType === 13 || this.tagType === 21 // motion && type != 12
        || this.tagType === 52                        // reed && type != 53
        || this.tagType === 26                        // ambient light
        || this.tagType === 72                        // PIR
        || this.isKumostat()
    ;
};
WirelessTag.prototype.isPhysicalTag = function() {
    return ! (this.isKumostat()
              || this.isNest()
              || this.isWeMo()
              || this.isCamera());
};
WirelessTag.prototype.isKumostat = function() {
    return (this.tagType === 62);
};
WirelessTag.prototype.isNest = function() {
    return (this.data.thermostat !== null
            && this.data.thermostat.nest_id !== null);
};
WirelessTag.prototype.isWeMo = function() {
    return (this.tagType === 82);
};
WirelessTag.prototype.isWeMoLED = function() {
    return (this.isWeMo() && (this.data.cap > 0));
};
WirelessTag.prototype.isCamera = function() {
    return (this.tagType === 92);
};

WirelessTag.prototype.lastUpdated = function() {
    return new Date(u.FILETIMEtoDate(this.data.lastComm));
};

WirelessTag.prototype.discoverSensors = function() {
    let capabilities = this.sensorCapabilities();
    let proms = [];
    for (let cap of capabilities) {
        let propName = cap + "Sensor";
        let sensor = this[propName];
        if (sensor) {
            proms.push(Promise.resolve(sensor));
        } else {
            let retValue = createSensor(this, cap);
            sensor = retValue[0];
            Object.defineProperty(this, propName, {
                enumerable: true,
                value: sensor
            });
            proms.push(retValue[1]);
        }
    }
    return Promise.all(proms);
};

function createSensor(tag, sensorType) {
    let sensor = new WirelessTagSensor(tag, sensorType);
    let req = WirelessTagSensor.loadMonitoringConfig(sensor).then(
        (config) => {
            try {
                sensor.monitoringConfig(config);
                return sensor;
            } finally {
                tag.emit('discover', sensor);
            }
        },
        (error) => {
            tag.emit('discover', sensor);
            tag.errorHandler()(error);
        }
    );
    return [sensor, req];
}

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

WirelessTag.prototype.bounceUpdateLoop = function() {
    let timer = this._updateTimer;
    if (timer && timer !== true) {
        this.log.warn("## bouncing update timer loop for tag", this.slaveId);
        this.stopUpdateLoop();
        this.startUpdateLoop();
    }
};

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
