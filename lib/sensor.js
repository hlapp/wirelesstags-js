"use strict";

/** @module */
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
    "0": "Disarmed",
    "1": "Armed",
    "2": "Moved",
    "3": "Opened",
    "4": "Closed",
    "5": "Event Detected",
    "6": "Timed Out",
    "7": "Stabilizing",
    "8": "Carried Away",
    "9": "In Free Fall"
};
const tempEventStates = {
    "0": "Not Monitoring",
    "1": "Normal",
    "2": "Too Hot",
    "3": "Too Cold"
};
const humidityEventStates = {
    "0": "N.A.",
    "1": "Not Monitoring",
    "2": "Normal",
    "3": "Too Dry",
    "4": "Too Humid"
};
const moistureEventStates = {
    "0": "N.A.",
    "1": "Not Monitoring",
    "2": "Normal",
    "3": "Too Dry",
    "4": "Too Wet"
};
const lightEventStates = {
    "0": "N.A.",
    "1": "Not Monitoring",
    "2": "Normal",
    "3": "Too Dark",
    "4": "Too Bright"
};
const outOfRangeGracePeriods = {
    // in seconds
    "0": 0,
    "1": 120,
    "2": 240,
    "3": 360,
    "4": 480,
    "5": 600,
    "7": 840,
    "10": 1200,
    "15": 1800
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
                       return this.wirelessTag.canHighPrecTemp() ?
                           u.round(x, 2) : u.round(x, 1);
                  }],
        eventState: ["tempEventState", xforms.mapFunction(tempEventStates)],
        eventStateValues: [undefined, xforms.valuesInMapFunction(tempEventStates)],
        probeType: [
            "ds18",
            function(x) {
                if (x) return "DS18B20";
                let tag = this.wirelessTag;
                // ds18 is false means external probe is
                // (i) a thermocouple, not a DS18B20
                if (tag.hasSecondaryTempSensor()) return "Thermocouple";
                // (ii) required but not connected
                if (tag.isExternalTempProbe()) return undefined;
                // (iii) optional but not connected, or not supported
                return "Internal";
            }],
        probeDisconnected: [
            "ds18",
            function(x) {
                if (x) return false;
                // ds18 is false means external probe is
                // (i) required but not connected,
                if (this.wirelessTag.isExternalTempProbe()) return true;
                // (ii) supported but not detectable as connected or not, or
                // (iii) not supported,
                return undefined;
            }]
    },
    'secondarytemp': {
        reading: ["cap",   // yes, really
                   function(x) {
                       let mconf = this.monitoringConfig();
                       if (mconf && mconf.unit === "degF") {
                           x = xforms.degCtoF(x);
                       }
                       return this.wirelessTag.canHighPrecTemp() ?
                           u.round(x, 2) : u.round(x, 1);
                  }],
        probeType: [undefined, function() { return "Internal" }]
    },
    'humidity': {
        reading: ["cap", xforms.noop],
        eventState: ["capEventState", xforms.mapFunction(humidityEventStates)],
        eventStateValues: [undefined, xforms.valuesInMapFunction(humidityEventStates)],
        probeType: [undefined, function() { return "Internal" }]
    },
    'moisture': {
        reading: ["cap", xforms.noop],
        eventState: ["capEventState", xforms.mapFunction(moistureEventStates)],
        eventStateValues: [undefined, xforms.valuesInMapFunction(moistureEventStates)],
        probeType: [
            undefined,
            function() {
                return this.wirelessTag.isOutdoorTag() ? "BLDXXXX" : "Internal";
            }]
    },
    'water': {
        reading: ["shorted", xforms.noop],
        eventState: ["shorted",
                     function(x) { return x ? "Water Detected" : "Normal" }],
        eventStateValues: [undefined,
                           function() { return ["Normal", "Water Detected"] }]
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
    },
    'batteryremaining': {
        reading: ["batteryRemaining", xforms.noop]
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
    'secondarytemp': {
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
 *
 * @property {number|string|boolean} reading - The current reading of the
 *             sensor. The type of the value depends on the type of sensor.
 *             Some sensors (light, temperature, humidity, moisture, battery,
 *             signal) have numeric readings, some (outofrange, water)
 *             have boolean, and some (event) have string values.
 *             For some sensors (currently only motion) the reading is
 *             undefined because the Wireless Tag platform does not provide
 *             access to a regularly updated value.
 * @property {string} eventState - The current event state of the sensor.
 *             Unarmed sensors will be in state `Not Monitoring` or `Disarmed`,
 *             whereas armed sensors can be in `Normal`, `Too Hot`, `Too Dry`,
 *             and other states, depending on the type of sensor. Not every
 *             sensor has an event state; for example, the signal sensor does
 *             not. (Nor does the motion sensor, because it would be redundant
 *             with the event sensor.)
 * @property {string[]} eventStateValues - the possible values for `eventState`
 * @property {string} probeType - only for temperature (`temp`,
 *             `secondarytemp`), `humidity`, and `moisture` sensors, the type
 *             of measurement probe or mechanism. Typically `Internal`, but
 *             can be `DS18B20` and `Thermocouple` for temperature, and
 *             `BLDXXXX` for moisture/humidity sensors, respectively, of tags
 *             capable of using an alternative probe.
 * @property {boolean} probeDisconnected - `true` if an external probe is
 *             detected as disconnected, `false` if it is detected as connected,
 *             and `undefined` (or not present as a property) if the
 *             connection status can't be detected (or if the tag doesn't
 *             support external probes).
 * @property {number} gracePeriod - only for `outofrange` sensors, the grace
 *             period in seconds after which a tag will go into `Out Of Range`
 *             state after losing contact with the tag manager.
 */
function WirelessTagSensor(tag, sensorType) {
    EventEmitter.call(this);
    /** @member {WirelessTag} */
    this.wirelessTag = tag;
    let platform = tag.wirelessTagManager ?
        tag.wirelessTagManager.wirelessTagPlatform : undefined;
    /** @member {function} - see {@link WirelessTagPlatform.callAPI} */
    this.callAPI = tag.callAPI ||
        (tag.wirelessTagManager ? tag.wirelessTagManager.callAPI : undefined) ||
        (platform ? platform.callAPI : undefined);
    /**
     * @name sensorType
     * @type {string}
     * @memberof WirelessTagSensor#
     */
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
    if (sensorType === 'event' || sensorType === 'motion') {
        // motion and event sensors when armed can be reset to non-triggered
        this.reset = resetMotion;
    }
}
util.inherits(WirelessTagSensor, EventEmitter);

/**
 * String representation of the sensor object and its data. Includes a
 * reference to the tag (as `name`, `uuid`, and `slaveId`), properties, and
 * the sensor's monitoring configuration object.
 *
 * @returns {string}
 */
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

/**
 * Whether the sensor is armed. An armed sensor will generate notifications
 * upon certain thresholds being exceeded.
 *
 * @returns {boolean} `Undefined` if the sensor doesn't define an armed state,
 *            `true` if it is armed, and `false` otherwise.
 */
WirelessTagSensor.prototype.isArmed = function() {
    if (this.eventState === undefined) return undefined;
    return ["Disarmed", "Not Monitoring", "N.A."].indexOf(this.eventState) < 0;
};

/**
 * Whether the sensor can be armed. Most sensors can be armed but some (such
 * as `signal`) cannot.
 */
WirelessTagSensor.prototype.canArm = function() {
    let apiSpec = sensorApiURIs[this.sensorType];
    return apiSpec && apiSpec.arm;
};

/**
 * Whether the sensor can be disarmed. Most sensors that are armed can be
 * disarmed but some (such as `water`) cannot.
 */
WirelessTagSensor.prototype.canDisarm = function() {
    let apiSpec = sensorApiURIs[this.sensorType];
    return apiSpec && apiSpec.disarm;
};

/**
 * Arms this sensor.
 *
 * @param {module:wirelesstags~apiCallback} [callback]
 * @returns {Promise} Resolves to the sensor when arming completes. Will
 *          [retry updating]{@link WirelessTag#retryUpdateUntil}
 *          until the tag's data reflect the armed state. Rejects
 *          with an [OperationIncompleteError]{@link WirelessTagPlatform.OperationIncompleteError}
 *          if this is still not the case after the
 *          [default number of retries]{@link module:lib/tag~DEFAULT_RETRY_OPTIONS}.
 * @throws {WirelessTagPlatform.OperationUnsupportedError} if the sensor
 *         does not support arming
 */
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

/**
 * Disarms this sensor.
 *
 * @param {module:wirelesstags~apiCallback} [callback]
 * @returns {Promise} Resolves to the sensor when disarming completes. Will
 *          [retry updating]{@link WirelessTag#retryUpdateUntil}
 *          until the tag's data reflect the armed state. Rejects
 *          with an [OperationIncompleteError]{@link WirelessTagPlatform.OperationIncompleteError}
 *          if this is still not the case after the
 *          [default number of retries]{@link module:lib/tag~DEFAULT_RETRY_OPTIONS}.
 * @throws {WirelessTagPlatform.OperationUnsupportedError} if the sensor
 *         does not support arming
 */
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

/**
 * Obtains (or sets) the [monitoring configuration]{@link MonitoringConfig}
 * of the sensor.
 *
 * The monitoring configuration for some sensors is not only stricly about
 * parameters controlling behavior and event notification when armed. For
 * example, for temperature and humidity sensors it includes the unit (°C
 * versus °F, %humidity versus dew point temperature).
 *
 * @param {MonitoringConfig} [newConfig] - on set, the new monitoring
 *          configuration object
 * @returns {MonitoringConfig} The monitoring configuration object active
 *          for this sensor. For sensor objects that haven't been fully
 *          initialized (see {@link WirelessTag#createSensor}), the returned
 *          object will need to be [updated from the cloud]{@link MonitoringConfig#update}
 *          first before its properties reflect the currently active values.
 */
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

/**
 * Resets the motion event status of this sensor. This method is only
 * available for 'event' sensors (which tags with motion, light, PIR,
 * and Reed sensors have).
 *
 * @param {module:wirelesstags~apiCallback} [callback]
 * @returns {Promise} Resolves when the reset completes.
 *
 * @method reset
 * @memberof WirelessTagSensor#
 */
/* eslint-disable no-invalid-this */
function resetMotion(callback) {
    if (! this.isArmed()) return Promise.resolve(this);
    let req = this.callAPI('/ethClient.asmx/ResetTag',
                           { id: this.wirelessTag.slaveId },
                           callback);
    return req.then((result) => {
        this.wirelessTag.data = result;
        if (callback) callback(null, { object: this });
        return this;
    });
}
/* eslint-enable no-invalid-this */
