"use strict";

module.exports = WirelessTag;

var request = require('request'),
    util = require('util'),
    EventEmitter = require('events'),
    u = require('./util.js'),
    WirelessTagSensor = require('./sensor.js'),
    WirelessTagPlatform = require('./platform.js');

const roTagProps = ["uuid","slaveId","tagType","alive","rev"];
const rwTagProps = ["name",
                    ["updateInterval","postBackInterval"]];

const MAX_UPDATE_RETRIES = 2;

// the following are in milliseconds
const RETRY_UPDATE_DELAY = 5000;         // time before retrying update
const MIN_UPDATE_LOOP_WAIT = 1500;       // minimum wait time between loops
const MAX_UPDATE_LOOP_WAIT = 30 * 60000; // maximum wait time between loops
const DEFAULT_UPDATE_PADDING = 2000; // time to add to calculated update time

/*
 * The cloud instance of a Wireless Tag. One Wireless Tag manager can
 * manage multiple Wireless Tags.
 */
function WirelessTag(tagManager, tagData) {
    EventEmitter.call(this);
    this.wirelessTagManager = tagManager;
    this.errorHandler =
        tagManager ? tagManager.errorHandler : u.defaultHandler;
    this.callAPI = WirelessTagPlatform.callAPI;
    u.setObjProperties(this, roTagProps, rwTagProps);
    this.data = tagData || {};
    this.on('data', this.discoverSensors.bind(this));
    this.on('data', this.bounceUpdateLoop.bind(this));
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
                                  replace(/has(\w+)Sensor/,'$1').
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
    if (action === undefined) action = (s) => { return s };
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
        case 14: return "v2.1";
	case 15: return "v2.2";
	case 31: return "v2.3";
	default: return "v2.0";
        }
        break; // technically not needed since every preceding case returns
    case 3:
	return "v3.0";
    case 4:
	return "v4.0";
    default:
        if (this.tagType === 12) {
            switch (this.rev) {
            case 0: return "v1.1";
            case 1: return "v1.2";
            case 11: return "v1.3";
            case 12: return "v1.4";
            case 13: return "v1.5";
            }
        }
    }
    return "";
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
    return this.hasMotionSensor() && ((this.rev & 0x0F) == 0x0A);
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

WirelessTag.prototype.discoverSensors = function(tag) {
    if (! tag) tag = this;
    var capabilities = tag.sensorCapabilities();
    var proms = [];
    for (let cap of capabilities) {
        let propName = cap + "Sensor";
        let sensor = tag[propName];
        if (sensor) {
            proms.push(Promise.resolve(sensor));
        } else {
            let retValue = createSensor(tag, cap);
            sensor = retValue[0];
            Object.defineProperty(tag, propName, {
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
            }
            finally {
                tag.emit('discover', sensor);
            }
        },
        (error) => {
            tag.emit('discover', sensor);
            if (error instanceof Error) {
                tag.errorHandler()(error);
            } else {
                console.warn(error);
            }
        }
    );
    return [sensor, req];
}

WirelessTag.prototype.update = function(tag, callback)  {
    if ((tag === undefined) || ('function' === typeof tag)) {
        callback = tag;
        tag = this;
    }
    var req = tag.callAPI(
        '/ethClient.asmx/GetTagForSlaveId',
        { slaveid: tag.slaveId },
        callback);
    return req.then(
        (result) => {
            tag.data = result;
            return tag;
        },
        tag.errorHandler(callback)
    );
};

WirelessTag.prototype.updateUntil = function(condition, getValue, waitFor, attempts) {
    if ('function' !== typeof getValue) {
        attempts = waitFor;
        waitFor = getValue;
        getValue = () => { return this.data; };
    }
    if ((waitFor === true) || (waitFor === undefined)) {
        waitFor = RETRY_UPDATE_DELAY;
    }
    if ('number' !== typeof attempts) attempts = MAX_UPDATE_RETRIES;
    if (this._updateAttempts === undefined) {
        this._updateAttempts = 0;
    }
    this._updateAttempts++;
    return this.update().then(
        (result) => {
            if (condition(getValue())) {
                this._updateAttempts = 0;
                return result;
            } else {
                if (this._updateAttempts >= MAX_UPDATE_RETRIES) {
                    this._updateAttempts = 0;
                    return Promise.reject("no update from tag " + this.slaveId
                                          + " after " + attempts + " attempts");
                } else {
                    console.warn("## retrying update for tag", this.slaveId);
                    return u.delayActionPromise(
                        this.updateUntil.bind(
                            this, condition, getValue, waitFor, attempts),
                        waitFor);
                }
            }
        },
        this.errorHandler()
    );
};

WirelessTag.prototype.liveUpdate = function(tag, callback)  {
    if (! tag) tag = this;
    var req = tag.callAPI(
        '/ethClient.asmx/RequestImmediatePostback',
        { id: tag.slaveId },
        callback);
    return req.then(
        (result) => {
            tag.data = result;
            return tag;
        },
        tag.errorHandler(callback)
    );
};

WirelessTag.prototype.startUpdateLoop = function(minWait) {
    let padding = DEFAULT_UPDATE_PADDING;
    if (minWait === undefined) {
        minWait = MIN_UPDATE_LOOP_WAIT;
    } else if (minWait > MAX_UPDATE_LOOP_WAIT) {
        minWait = MAX_UPDATE_LOOP_WAIT;
    }
    if (this._updateTimer) return this._updateTimer;
    this._updateTimer = true; // placeholder to avoid race conditions
    let action = () => {
        this._updateTimer = null;
        this.update().then(
            (success) => {
                return this.startUpdateLoop();
            },
            (error) => {
                console.error(error);
                return this.startUpdateLoop(minWait * 2);
            }
        );
    };
    let remainingTime =
        (this.updateInterval * 1000) -
        (Date.now() - this.lastUpdated().getTime());
    if (remainingTime < minWait) {
        remainingTime = minWait;
    } else {
        remainingTime += padding;
    }
    // ensure that updates weren't cancelled since we entered here
    if (this._updateTimer) {
        this._updateTimer = setTimeout(action, remainingTime);
    }
    return this._updateTimer;
};

WirelessTag.prototype.stopUpdateLoop = function() {
    let timer = this._updateTimer;
    this._updateTimer = null;   // avoid race conditions
    if (timer && timer !== true) {
        clearTimeout(timer);
    }
};

WirelessTag.prototype.bounceUpdateLoop = function(tag) {
    if (! tag) tag = this;
    let timer = tag._updateTimer;
    if (timer && timer !== true) {
        console.warn("## bouncing update timer loop for tag", tag.slaveId);
        tag.stopUpdateLoop();
        tag.startUpdateLoop();
    }
};

WirelessTag.prototype.toString = function() {
    let propsObj = {
        manager : {
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
    if (value === undefined) value = this.updateInterval;
    if (('number' !== typeof value) || (value <= 0)) {
        return Promise.reject("invalid update interval for tag", this.name);
    }
    var req = this.callAPI(
        '/ethClient.asmx/SetPostbackIntervalFor',
        { id: this.slaveId, sec: value },
        callback);
    return req.then(
        (result) => {
            this.data = result;
            if (this.updateInterval != value) {
                // the API call itself succeeded, so this should resolve
                // itself if we retry updating after a short delay
                return u.delayActionPromise(
                    this.update.bind(this), RETRY_UPDATE_DELAY);
            }
            return this;
        },
        this.errorHandler(callback)
    );
};
