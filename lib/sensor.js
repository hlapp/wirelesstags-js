"use strict";

/** module */
module.exports = WirelessTagSensor;

var util = require('util'),
    EventEmitter = require('events'),
    deepEqual = require('deep-equal'),
    u = require('./util'),
    xforms = require('./xforms'),
    MonitoringConfig = require('./sensorconfig'),
    OperationUnsupportedError = require('./error/OperationUnsupportedError'),
    RetryUnsuccessfulError = require('./error/RetryUnsuccessfulError');

const tagEventStates = {
    0: "Disarmed",
    1: "Armed",
    2: "Moved",
    3: "Opened",
    4: "Closed",
    5: "Event Detected",
    6: "Timed Out",
    7: "Stabilizing",
    8: "Carried Away",
    9: "In Free Fall"
};
const tempEventStates = {
    0: "Not Monitoring",
    1: "Normal",
    2: "Too Hot",
    3: "Too Cold"
};
const humidityEventStates = {
    0: "N.A.",
    1: "Not Monitoring",
    2: "Normal",
    3: "Too Dry",
    4: "Too Humid"
};
const moistureEventStates = {
    0: "N.A.",
    1: "Not Monitoring",
    2: "Normal",
    3: "Too Dry",
    4: "Too Wet"
};
const lightEventStates = {
    0: "N.A.",
    1: "Not Monitoring",
    2: "Normal",
    3: "Too Dark",
    4: "Too Bright"
};
const outOfRangeGracePeriods = {
    // in seconds
    0: 0,
    1: 120,
    2: 240,
    3: 360,
    4: 480,
    5: 600,
    6: 840,
    7: 1200,
    8: 1800
};

/* eslint-disable no-invalid-this */
const sensorPropertiesMap = {
    'motion': {
    },
    'event': {
        reading: ["eventState", xforms.mapFunction(tagEventStates)],
        eventState: ["eventState", xforms.mapFunction(tagEventStates)],
        eventStateValues: [undefined, xforms.valuesInMapFunction(tagEventStates)]
    },
    'light': {
        reading: ["lux", function(x) { return u.round(x, 2) }],
        eventState: ["lightEventState", xforms.mapFunction(lightEventStates)],
        eventStateValues: [undefined, xforms.valuesInMapFunction(lightEventStates)]
    },
    'temp': {
        reading: ["temperature",
                   function(x) {
                       let mconf = this.monitoringConfig();
                       if (mconf && mconf.unit === "degF") {
                           x = xforms.degCtoF(x);
                       }
                       return this.wirelessTag.isHTU() ?
                           u.round(x, 2) : u.round(x, 1);
                  }],
        eventState: ["tempEventState", xforms.mapFunction(tempEventStates)],
        eventStateValues: [undefined, xforms.valuesInMapFunction(tempEventStates)]
    },
    'humidity': {
        reading: ["cap", xforms.noop],
        eventState: ["capEventState", xforms.mapFunction(humidityEventStates)],
        eventStateValues: [undefined, xforms.valuesInMapFunction(humidityEventStates)]
    },
    'moisture': {
        reading: ["cap", xforms.noop],
        eventState: ["capEventState", xforms.mapFunction(moistureEventStates)],
        eventStateValues: [undefined, xforms.valuesInMapFunction(moistureEventStates)]
    },
    'water': {
        reading: ["shorted", xforms.noop],
        eventState: ["shorted",
                     function(x) { return x ? "Water Detected" : "Normal" }],
        eventStateValues: [undefined,
                           function() { return ["Normal", "Water Detected"] }]
    },
    'current': {
        reading: ["ampData", xforms.noop],
        eventState: ["ampData", function(x) { return x.eventState }]
    },
    'battery': {
        reading: ["batteryVolt",
                  function(x) { return u.round(x, 2) }],
        eventState: ["enLBN",
                     function(x) {
                         if (! x) return "Not Monitoring";
                         if (this.reading >= this.data.LBTh) return "Normal";
                         return "Battery Low";
                     }],
        eventStateValues: [
            undefined,
            function() {
                return ["Not Monitoring", "Normal", "Battery Low"];
            }
        ]
    },
    'outofrange': {
        reading: ["OutOfRange", xforms.noop],
        eventState: ["OutOfRange",
                     function(x) {
                         return x ? "Out Of Range" : "Normal";
                     }],
        eventStateValues: [undefined,
                           function() { return ["Normal", "Out Of Range"] }],
        gracePeriod: ["oorGrace",                 // we map this to seconds
                      xforms.mapFunction(outOfRangeGracePeriods),
                      xforms.revMapFunction(outOfRangeGracePeriods)]
    },
    'signal': {
        reading: ["signaldBm", xforms.noop]
    }
};
/* eslint-enable no-invalid-this */

const sensorApiURIs = {
    'motion': {
    },
    'event': {
        arm: "/ethClient.asmx/Arm",
        armData: { door_mode_set_closed: true },
        disarm: "/ethClient.asmx/Disarm"
    },
    'light': {
        arm: "/ethClient.asmx/ArmLightSensor",
        disarm: "/ethClient.asmx/DisarmLightSensor"
    },
    'temp': {
        arm: "/ethClient.asmx/ArmTempSensor",
        disarm: "/ethClient.asmx/DisarmTempSensor"
    },
    'humidity': {
        arm: "/ethClient.asmx/ArmCapSensor",
        disarm: "/ethClient.asmx/DisarmCapSensor"
    },
    'moisture': {
        arm: "/ethClient.asmx/ArmCapSensor",
        disarm: "/ethClient.asmx/DisarmCapSensor"
    },
    'water': {
    },
    'current': {
        arm: "/ethClient.asmx/ArmCurrentSensor",
        disarm: "/ethClient.asmx/DisarmCurrentSensor"
    },
    'outofrange': {
        load: "/ethClient.asmx/LoadOutOfRangeConfig",
        save: "/ethClient.asmx/SaveOutOfRangeConfig2"
    },
    'battery': {
        load: "/ethClient.asmx/LoadLowBatteryConfig",
        save: "/ethClient.asmx/SaveLowBatteryConfig2"
    }
};

/**
 * Represents a sensor of a {@link WirelessTag}. Physical tags have
 * multiple sensors (e.g., tenperature, humidity, light, motion, etc),
 * as well as dynamic status (such as out of range) and numeric (such
 * as signal strength and battery voltage) properties. We abstract all
 * of these out to sensors, which allows us to treat temperature, out
 * of range status, and battery voltage as conceptually the
 * same. Sensors do not all have the same capabilities (e.g., some can
 * be armed for monitoring, others, such as signal, cannot). However,
 * all sensors have a type (humidity, motion, light, signal, etc).
 *
 * A user will not normally need to create instances directly; instead
 * they are found, and created by {@link WirelessTag#discoverSensors}.
 *
 * @param {WirelessTag} tag - the tag instance that has this sensor
 * @param {string} sensorType - the type of the sensor
 *
 * @class
 * @alias WirelessTagSensor
 */
function WirelessTagSensor(tag, sensorType) {
    EventEmitter.call(this);
    this.wirelessTag = tag;
    let platform = tag.wirelessTagManager ?
        tag.wirelessTagManager.wirelessTagPlatform : undefined;
    this.callAPI = tag.callAPI ||
        (tag.wirelessTagManager ? tag.wirelessTagManager.callAPI : undefined) ||
        (platform ? platform.callAPI : undefined);
    Object.defineProperty(this, "sensorType", {
        enumerable: true,
        value: sensorType
    });
    this.errorHandler = tag.errorHandler || u.defaultHandler;
    Object.defineProperty(this, "data", {
        enumerable: true,
        get: () => this.wirelessTag.data
    });
    u.defineLinkedPropertiesFromMap(this, sensorPropertiesMap, sensorType);
}
util.inherits(WirelessTagSensor, EventEmitter);

WirelessTagSensor.prototype.toString = function() {
    let propsObj = {
        tag: {
            name: this.wirelessTag.name,
            uuid: this.wirelessTag.uuid,
            slaveId: this.wirelessTag.slaveId
        }
    };
    // all data properties except private ones and the data dict
    for (let propName of Object.getOwnPropertyNames(this)) {
        if (! (propName.startsWith('_')
               || (propName === 'wirelessTag')
               || (propName === 'domain')
               || (propName === 'data')
               || ('function' === typeof this[propName]))) {
            propsObj[propName] = this[propName];
        }
    }
    // monitoring configuration
    propsObj.monitoringConfig = this.monitoringConfig().asJSON();
    return JSON.stringify(propsObj);
};

WirelessTagSensor.prototype.isArmed = function() {
    if (this.eventState === undefined) return undefined;
    return ["Disarmed", "Not Monitoring", "N.A."].indexOf(this.eventState) < 0;
};

WirelessTagSensor.prototype.canArm = function() {
    let apiSpec = sensorApiURIs[this.sensorType];
    return apiSpec && apiSpec.arm;
};

WirelessTagSensor.prototype.canDisarm = function() {
    let apiSpec = sensorApiURIs[this.sensorType];
    return apiSpec && apiSpec.disarm;
};

WirelessTagSensor.prototype.arm = function(callback) {
    if (this.isArmed()) return Promise.resolve(this);
    if (! this.canArm()) {
        let e = new OperationUnsupportedError(this.sensorType
                                              + " does not support arming",
                                              this,
                                              "arm");
        if (callback) callback(e);
        return Promise.reject(e);
    }
    return changeArmedStatus(this, callback);
};

WirelessTagSensor.prototype.disarm = function(callback) {
    if (! this.isArmed()) return Promise.resolve(this);
    if (! this.canDisarm()) {
        let e = new OperationUnsupportedError(this.sensorType
                                              + " does not support disarming",
                                              this,
                                              "disarm");
        if (callback) callback(e);
        return Promise.reject(e);
    }
    return changeArmedStatus(this, callback);
};

WirelessTagSensor.prototype.monitoringConfig = function(newConfig) {
    if (newConfig) {
        let oldConfData = this._config ? this._config.data : {};
        this._config = newConfig;
        if (! deepEqual(oldConfData, newConfig.data)) {
            this.emit('config', this, newConfig, 'set');
        }
    } else if (! this._config) {
        this._config = MonitoringConfig.create(this);
    }
    return this._config;
};

function changeArmedStatus(sensor, callback) {
    var isArmed = sensor.isArmed();
    var action = isArmed ? "disarm" : "arm";
    var apiSpec = sensorApiURIs[sensor.sensorType];
    var uri = apiSpec[action];
    if (! uri) throw new OperationUnsupportedError(
        "undefined API for " + action + "ing "
            + sensor.sensorType + " sensor of " + sensor.wirelessTag.name,
        sensor,
        action);
    var data = apiSpec[action + "Data"] || {};
    data.id = sensor.wirelessTag.slaveId;
    var req = sensor.callAPI(uri, data, callback);
    return req.then((result) => {
        sensor.wirelessTag.data = result;
        if (isArmed !== undefined && isArmed === sensor.isArmed()) {
            // the API call itself succeeded, so this should resolve
            // itself if we retry updating after some delay
            return sensor.wirelessTag.retryUpdateUntil((tag, n) => {
                let s = tag[sensor.sensorType + "Sensor"];
                if (isArmed !== s.isArmed()) return true;
                throw new RetryUnsuccessfulError(
                    "Event state for " + s.sensorType
                        + " of " + tag.name + " failed to change to "
                        + action + "ed after " + n + " update attempts",
                    s,
                    action,
                    n);
            }).then((tag) => tag[sensor.sensorType + "Sensor"]);
        }
        if (callback) callback(null, { object: sensor });
        return sensor;
    });
}
