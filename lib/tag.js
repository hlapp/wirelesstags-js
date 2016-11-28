"use strict";

module.exports = WirelessTag;

var request = require('request'),
    util = require('util'),
    EventEmitter = require('events'),
    u = require('./util.js'),
    WirelessTagSensor = require('./sensor.js'),
    WirelessTagPlatform = require('./platform.js');

const roTagProps = ["uuid","slaveId","tagType","alive"];
const rwTagProps = ["name",
                    ["updateInterval","postBackInterval"]];

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
}

WirelessTag.prototype.eachSensor = function(action) {
    if ('function' !== typeof action) return;
    var capabilities = this.sensorCapabilities();
    for (let cap of capabilities) {
        let sensor = this[cap + "Sensor"];
        if (sensor) action(sensor);
    }
    return capabilities;
}

WirelessTag.prototype.hasMotionSensor = function() {
    return (this.tagType == 12 || this.tagType == 13 || this.tagType == 21);
}
WirelessTag.prototype.hasLightSensor = function() {
    return (this.tagType == 26);
}
WirelessTag.prototype.hasMoistureSensor = function() {
    return (this.tagType == 32 || this.tagType == 33);
}
WirelessTag.prototype.hasWaterSensor = function() {
    return (this.tagType == 32 || this.tagType == 33);
}
WirelessTag.prototype.hasReedSensor = function() {
    return (this.tagType == 52 || this.tagType == 53);
}
WirelessTag.prototype.hasPIRSensor = function() {
    return (this.tagType == 72);
}
WirelessTag.prototype.hasEventSensor = function() {
    return (this.hasMotionSensor()
            || this.hasLightSensor()
            || this.hasReedSensor()
            || this.hasPIRSensor());
}
WirelessTag.prototype.hasHumiditySensor = function() {
    return this.isHTU();
}
WirelessTag.prototype.hasTempSensor = function() {
    return !(this.tagType == 82 || this.tagType == 92);
}
WirelessTag.prototype.hasCurrentSensor = function() {
    return this.tagType == 42;
}
WirelessTag.prototype.canBeep = function() {
    return this.tagType == 13
        || this.tagType == 12
        || this.tagType == 21
        || this.tagType==26;
}
WirelessTag.prototype.canPlayback = function() {
    return (this.tagType == 21);
}
WirelessTag.prototype.isHTU = function() {
    return this.tagType == 13 || this.tagType == 21 // motion && type != 12
        || this.tagType == 52                       // reed && type != 53
        || this.tagType == 26                       // ambient light
        || this.tagType == 72                       // PIR
        || this.isKumostat()
    ;
}
WirelessTag.prototype.isKumostat = function() {
    return (this.tagType == 62);
}
WirelessTag.prototype.isNest = function() {
    return (this.thermostat != null && this.data.thermostat.nest_id != null);
}
WirelessTag.prototype.isWeMo = function() {
    return (this.tagType == 82);
}
WirelessTag.prototype.isWeMoLED = function() {
    return (this.isWeMo() && (this.data.cap > 0));
}
WirelessTag.prototype.isCamera = function() {
    return (this.tagType == 92);
}

WirelessTag.prototype.lastUpdated = function() {
    return new Date(u.FILETIMEtoDate(this.data.lastComm));
}

WirelessTag.prototype.discoverSensors = function(tag) {
    if (! tag) tag = this;
    var capabilities = tag.sensorCapabilities();
    for (let cap of capabilities) {
        let propName = cap + "Sensor";
        let sensor = tag[propName];
        if (sensor) continue;
        sensor = new WirelessTagSensor(tag, cap);
        Object.defineProperty(tag, propName, {
            enumerable: true,
            value: sensor
        });
        tag.emit('discover', sensor);
    }
}
