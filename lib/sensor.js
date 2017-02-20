"use strict";

/* eslint-disable comma-dangle */

/** module */
module.exports = WirelessTagSensor;

var util = require('util'),
    EventEmitter = require('events'),
    deepEqual = require('deep-equal'),
    u = require('./util'),
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
const motionResponsivenessStates = {
    1: "Highest",
    2: "Medium high",
    3: "Medium",
    4: "Medium low",
    5: "Lowest"
};
const capResponsivenessStates = {
     4: "Highest",
     8: "Medium high",
    16: "Medium",
    32: "Medium low",
    48: "Lowest"
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
    8: 1800,
};

/* eslint-disable no-invalid-this */
const xforms = {
    noop: function(x) { return x },
    mapFunction: function(map) { return function(x) { return map[x] } },
    revMapFunction: function(map) {
        return function(x) {
            for (let key in map) {
                /* eslint-disable eqeqeq */
                if (map[key] == x) return key;
                /* eslint-enable eqeqeq */
            }
            throw new RangeError(x + " is not a value in the map");
        };
    },
    valuesInMapFunction: function(map) {
        return function() {
            return Object.keys(map).map((k) => map[k]);
        };
    },
    mapObjectFunction: function(map, prop, xformMap) {
        return function() {
            // return cached object if there is one
            if (prop && this['_'+prop]) return this['_'+prop];
            // otherwise create from scratch
            let value = {};
            let createMappedProp = (obj, key) => {
                let transform = xforms.noop, revTransform = xforms.noop;
                if (xformMap && xformMap[key]) {
                    transform = xformMap[key][0].bind(this);
                    revTransform = xformMap[key][1].bind(this);
                }
                Object.defineProperty(obj, key, {
                    enumerable: true,
                    configurable: true,
                    get: () => transform(this.data[map[key]]),
                    set: (x) => {
                        this.data[map[key]] = revTransform(x);
                        if ('function' === typeof this.markModified) {
                            this.markModified(map[key]);
                            this.markModified((prop ? prop + '.' : '') + key);
                        }
                    }
                });
            };
            for (let key in map) {
                createMappedProp(value, key);
            }
            // prevent other properties from being added accidentally
            Object.seal(value);
            // cache for the future (as non-enumerable and read-only) and return
            if (prop) Object.defineProperty(this, '_'+prop, { value: value });
            return value;
        };
    },
    delegatingFunction: function(delegateTo, propName) {
        let xformFunc = function(value) {
            if (value === undefined) {
                value = this[propName];
            } else {
                this[propName] = value;
            }
            return value;
        };
        return xformFunc.bind(delegateTo);
    },
    degCtoF: function(x, isRelative) {
        return x * 9/5.0 + (isRelative ? 0 : 32);
    },
    degFtoC: function(x, isRelative) {
        return (x - (isRelative ? 0 : 32)) * 5/9.0;
    },
    tempToNative: function(isRelative) {
        return function(x) {
            let mconfig = this.monitoringConfig ? this.monitoringConfig() : this;
            let unit = mconfig.unit;
            return unit === "degF" ? xforms.degFtoC(x, isRelative) : x;
        };
    },
    tempFromNative: function(isRelative) {
        return function(x) {
            let mconfig = this.monitoringConfig ? this.monitoringConfig() : this;
            let unit = mconfig.unit;
            return unit === "degF" ? xforms.degCtoF(x, isRelative) : x;
        };
    },
    rh2dewPoint: function(x) {
        let T = this.wirelessTag.data.temperature; // need native dC temperature
        let b = 17.67, c = 243.5;
        let m = Math.log(x / 100.0) + b * T / (c + T);
        return c * m / (b - m);
    },
};

const sensorPropertiesMap = {
    'motion': {
    },
    'event': {
        reading: ["eventState", xforms.mapFunction(tagEventStates)],
        eventState: ["eventState", xforms.mapFunction(tagEventStates)],
        eventStateValues: [undefined, xforms.valuesInMapFunction(tagEventStates)],
    },
    'light': {
        reading: ["lux", function(x) { return u.round(x, 2) }],
        eventState: ["lightEventState", xforms.mapFunction(lightEventStates)],
        eventStateValues: [undefined, xforms.valuesInMapFunction(lightEventStates)],
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
        eventStateValues: [undefined, xforms.valuesInMapFunction(tempEventStates)],
    },
    'humidity': {
        reading: ["cap", xforms.noop],
        eventState: ["capEventState", xforms.mapFunction(humidityEventStates)],
        eventStateValues: [undefined, xforms.valuesInMapFunction(humidityEventStates)],
    },
    'moisture': {
        reading: ["cap", xforms.noop],
        eventState: ["capEventState", xforms.mapFunction(moistureEventStates)],
        eventStateValues: [undefined, xforms.valuesInMapFunction(moistureEventStates)],
    },
    'water': {
        reading: ["shorted", xforms.noop],
        eventState: ["shorted",
                     function(x) { return x ? "Water Detected" : "Normal" }],
        eventStateValues: [undefined,
                           function() { return ["Normal", "Water Detected"] }],
    },
    'current': {
        reading: ["ampData", xforms.noop],
        eventState: ["ampData", function(x) { return x.eventState }],
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
        ],
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
                      xforms.revMapFunction(outOfRangeGracePeriods)],
    },
    'signal': {
        reading: ["signaldBm", xforms.noop]
    },
};
/* eslint-enable no-invalid-this */

const objectMaps = {
    notifyMap: {
        email: "email",
        sound: "apnsSound",                       // string
        pausePeriod: "apns_pause",                // minutes
        useEmail: "send_email",                   // boolean
        useTwitter: "send_tweet",                 // boolean
        usePush: "beep_pc",                       // boolean
        useSpeech: "beep_pc_tts",                 // boolean
        noSound: "beep_pc_vibrate",               // boolean
        // not supported for every sensor
        repeatUntilReset: "beep_pc_loop",         // boolean
        // only supported for battery sensor config
        repeatEvery: "notify_every",              // seconds
        // only supported for water sensor config
        onBecomeDry: "notify_open",               // boolean
    },
    notifyOutOfRangeMap: {
        email: "email_oor",                       // sigh!
        sound: "apnsSound",                       // string
        useEmail: "send_email_oor",               // sigh!
        usePush: "beep_pc_oor",                   // sigh!
        useSpeech: "beep_pc_tts_oor",             // sigh!
        noSound: "beep_pc_vibrate_oor",           // sigh!
    },
    thresholdMap: {
        lowValue: "th_low",
        minLowReadings: "th_low_delay",
        highValue: "th_high",
        minHighReadings: "th_high_delay",
        hysteresis: "th_window",
    },
    lightThresholdMap: {
        lowValue: "lux_th_low",                   // sigh!
        minLowReadings: "th_low_delay",
        highValue: "lux_th_high",                 // sigh!
        minHighReadings: "th_high_delay",
        hysteresis: "lux_th_window",              // sigh!
    },
    batteryThresholdMap: {
        lowValue: "threshold",                    // sigh!
    },
    capacitanceCalibMap: {
        lowValue: "cal1",
        lowCapacitance: "calRaw1",
        highValue: "cal2",
        highCapacitance: "calRaw2",
    },
    doorModeMap: {
        angle: "door_mode_angle",                 // degrees
        notifyWhenOpenFor: "door_mode_delay",     // seconds
        notifyOnClosed: "send_email_on_close",    // boolean
    },
    motionModeMap: {
        timeoutOrResetAfter: "auto_reset_delay",  // seconds
        timeoutMode: "hmc_timeout_mode",          // boolean
    },
    orientationMap1: {
        x: "az_x", y: "az_y", z: "az_z",
    },
    orientationMap2: {
        x: "az2_x", y: "az2_y", z: "az2_z",
    },
};

const tempTransforms = {
    absolute: [xforms.tempFromNative(false), xforms.tempToNative(false)],
    relative: [xforms.tempFromNative(true), xforms.tempToNative(true)]
};

const monitoringPropertiesMap = {
    'motion': {
        notifySettings: [
            undefined,
            xforms.mapObjectFunction(objectMaps.notifyMap, 'notifySettings')],
        sensitivity: ["sensitivity", xforms.noop, xforms.noop],
        responsiveness: ["interval",
                         xforms.mapFunction(motionResponsivenessStates)],
        isDoorMode: ["door_mode", xforms.noop, xforms.noop],
        doorMode: [undefined,
                   xforms.mapObjectFunction(objectMaps.doorModeMap,
                                            'doorMode')],
        motionMode: [undefined,
                     xforms.mapObjectFunction(objectMaps.motionModeMap,
                                              'motionMode')],
        orientation1: [undefined,
                       xforms.mapObjectFunction(objectMaps.orientationMap1,
                                                'orientation1')],
        orientation2: [undefined,
                       xforms.mapObjectFunction(objectMaps.orientationMap2,
                                                'orientation2')],
        armSilently: ["silent_arming", xforms.noop, xforms.noop],
    },
    // accelerometer properties get overlaid over motion
    'accelerometer': {
        sensitivity: ["sensitivity2", xforms.noop, xforms.noop],
    },
    'event': 'motion',
    'light': {
        notifySettings: [
            undefined,
            xforms.mapObjectFunction(objectMaps.notifyMap, 'notifySettings')],
        thresholds: [
            undefined,
            xforms.mapObjectFunction(objectMaps.lightThresholdMap,
                                     'thresholds')],
        monitoringInterval: ["th_monitor_interval",
                             xforms.noop, xforms.noop],           // seconds
        beepTag: ["beep_tag", xforms.noop, xforms.noop],          // boolean
    },
    'temp': {
        notifySettings: [
            undefined,
            xforms.mapObjectFunction(objectMaps.notifyMap, 'notifySettings')],
        thresholds: [
            undefined,
            xforms.mapObjectFunction(objectMaps.thresholdMap,
                                     'thresholds',
                                     {
                                         lowValue: tempTransforms.absolute,
                                         highValue: tempTransforms.absolute,
                                         hysteresis: tempTransforms.relative
                                     })
        ],
        monitoringInterval: ["interval", xforms.noop, xforms.noop], // seconds
        unit: ["temp_unit",
               function(x) { return x === 0 ? "degC" : "degF" },
               function(mode) {
                   switch (mode) {
                       case "degC": return 0;
                       case "degF": return 1;
                       default: throw new RangeError("unrecognized unit '" + mode + "'");
                   }
               }],
        thresholdQuantization: ["threshold_q", xforms.noop, xforms.noop],
    },
    'humidity': {
        notifySettings: [
            undefined,
            xforms.mapObjectFunction(objectMaps.notifyMap, 'notifySettings')],
        thresholds: [
            undefined,
            xforms.mapObjectFunction(objectMaps.thresholdMap, 'thresholds')],
        responsiveness: ["interval",
                         xforms.mapFunction(capResponsivenessStates),
                         xforms.revMapFunction(capResponsivenessStates)],
        calibration: [
            undefined,
            xforms.mapObjectFunction(objectMaps.capacitanceCalibMap,
                                     'calibration')],
    },
    'moisture': 'humidity',
    'water': {
        notifySettings: [
            undefined,
            xforms.mapObjectFunction(objectMaps.notifyMap, 'notifySettings')],
    },
    'current': {
        notifySettings: [
            undefined,
            xforms.mapObjectFunction(objectMaps.notifyMap, 'notifySettings')],
        thresholds: [
            undefined,
            xforms.mapObjectFunction(objectMaps.thresholdMap, 'thresholds')],
        samplingPeriod: ["sampling_period", xforms.noop, xforms.noop],
        responsiveness: ["interval",
                         xforms.mapFunction(capResponsivenessStates),
                         xforms.revMapFunction(capResponsivenessStates)],
    },
    'battery': {
        notifySettings: [
            undefined,
            xforms.mapObjectFunction(objectMaps.notifyMap, 'notifySettings')],
        thresholds: [
            undefined,
            xforms.mapObjectFunction(objectMaps.batteryThresholdMap,
                                     'thresholds')],
        monitoringEnabled: ["enabled", xforms.noop, xforms.noop],  // boolean
    },
    'outofrange': {
        notifySettings: [
            undefined,
            xforms.mapObjectFunction(objectMaps.notifyOutOfRangeMap,
                                     'notifySettings')],
    },
};

const sensorMonitorApiURIs = {
    'motion': {
        load: "/ethClient.asmx/LoadMotionSensorConfig",
        save: "/ethClient.asmx/SaveMotionSensorConfig2"
    },
    'event': {
        arm: "/ethClient.asmx/Arm",
        armData: { door_mode_set_closed: true },
        disarm: "/ethClient.asmx/Disarm",
        load: "/ethClient.asmx/LoadMotionSensorConfig",
        save: "/ethClient.asmx/SaveMotionSensorConfig2"
    },
    'light': {
        arm: "/ethClient.asmx/ArmLightSensor",
        disarm: "/ethClient.asmx/DisarmLightSensor",
        load: "/ethClient.asmx/LoadLightSensorConfig",
        save: "/ethClient.asmx/SaveLightSensorConfig"
    },
    'temp': {
        arm: "/ethClient.asmx/ArmTempSensor",
        disarm: "/ethClient.asmx/DisarmTempSensor",
        load: "/ethClient.asmx/LoadTempSensorConfig",
        save: "/ethClient.asmx/SaveTempSensorConfig2"
    },
    'humidity': {
        arm: "/ethClient.asmx/ArmCapSensor",
        disarm: "/ethClient.asmx/DisarmCapSensor",
        load: "/ethClient.asmx/LoadCapSensorConfig2",
        payloadKey: "rhEvent",
        save: "/ethClient.asmx/SaveCapSensorConfig2"
    },
    'moisture': {
        arm: "/ethClient.asmx/ArmCapSensor",
        disarm: "/ethClient.asmx/DisarmCapSensor",
        load: "/ethClient.asmx/LoadCapSensorConfig2",
        payloadKey: "rhEvent",
        save: "/ethClient.asmx/SaveCapSensorConfig2"
    },
    'water': {
        load: "/ethClient.asmx/LoadCapSensorConfig2",
        payloadKey: "shortedEvent",
        save: "/ethClient.asmx/SaveWaterSensorConfig2"
    },
    'current': {
        arm: "/ethClient.asmx/ArmCurrentSensor",
        disarm: "/ethClient.asmx/DisarmCurrentSensor",
        load: "/ethClient.asmx/LoadCurrentSensorConfig",
        save: "/ethClient.asmx/SaveCurrentSensorConfig2"
    },
    'outofrange': {
        load: "/ethClient.asmx/LoadOutOfRangeConfig",
        save: "/ethClient.asmx/SaveOutOfRangeConfig2"
    },
    'battery': {
        load: "/ethClient.asmx/LoadLowBatteryConfig",
        save: "/ethClient.asmx/SaveLowBatteryConfig2"
    },
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
        value: sensorType,
    });
    this.errorHandler = tag.errorHandler || u.defaultHandler;
    Object.defineProperty(this, "data", {
        enumerable: true,
        get: () => this.wirelessTag.data
    });
    setPropertiesFromMap(this, sensorPropertiesMap, sensorType);
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
    let apiSpec = sensorMonitorApiURIs[this.sensorType];
    return apiSpec && apiSpec.arm;
};

WirelessTagSensor.prototype.canDisarm = function() {
    let apiSpec = sensorMonitorApiURIs[this.sensorType];
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
    return WirelessTagSensor.changeArmedStatus(this, callback);
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
    return WirelessTagSensor.changeArmedStatus(this, callback);
};

WirelessTagSensor.prototype.monitoringConfig = function(newConfig) {
    if (newConfig) {
        let oldConfData = this._config ? this._config.data : {};
        this._config = newConfig;
        if (! deepEqual(oldConfData, newConfig.data)) {
            this.emit('config', this, newConfig, 'set');
        }
    }
    return this._config || new MonitoringConfig(this.sensorType);
};

WirelessTagSensor.loadMonitoringConfig = function(sensor, callback) {
    var apiSpec = sensorMonitorApiURIs[sensor.sensorType];
    var uri = apiSpec ? apiSpec.load : undefined;
    if (! uri) return Promise.resolve(new MonitoringConfig(sensor.sensorType));
    var req = sensor.callAPI(uri, { id: sensor.wirelessTag.slaveId }, callback);
    return req.then(
        (result) => {
            if (apiSpec.payloadKey) result = result[apiSpec.payloadKey];
            let config = new MonitoringConfig(sensor.sensorType, result);
            // tweak if motion or event or outOfRange config
            if (sensor.sensorType === 'motion'
                || sensor.sensorType === 'event') {
                if (sensor.wirelessTag.hasAccelerometer()) {
                    setPropertiesFromMap(config,
                                         monitoringPropertiesMap,
                                         'accelerometer');
                }
            } else if (sensor.sensorType === 'outofrange') {
                let getSetFunc = xforms.delegatingFunction(sensor,
                                                           'gracePeriod');
                Object.defineProperty(config, 'gracePeriod', {
                    enumerable: true, configurable: true,
                    get: getSetFunc,
                    set: (newValue) => {
                        getSetFunc(newValue);
                        config.markModified('gracePeriod');
                    }
                });
            }
            // replace no-op method placeholders with real functions
            config.save = MonitoringConfig.saveFunc(sensor);
            config.update = MonitoringConfig.updateFunc(sensor);
            if (callback) callback(null, { object: sensor, value: config });
            return config;
        });
};

WirelessTagSensor.setMonitoringConfig = function(sensor, callback) {
    var apiSpec = sensorMonitorApiURIs[sensor.sensorType];
    var uri = apiSpec ? apiSpec.save : undefined;
    if (! uri) throw new OperationUnsupportedError(
        "undefined API for updating "
            + sensor.sensorType + " monitoring config for "
            + sensor.wirelessTag.name);
    var flagIndex = ('function' === typeof callback) ? 3 : 2;
    var confData = Object.assign({}, sensor.monitoringConfig().data);
    delete confData.__type;
    var reqBody = { id: sensor.wirelessTag.slaveId, config: confData };
    reqBody.applyAll = arguments[flagIndex] || false;
    reqBody.allMac = arguments[flagIndex + 1] || false;
    return sensor.callAPI(uri, reqBody, callback).then(() => {
        if (callback) callback(null, { object: sensor });
        return sensor;
    });
};

WirelessTagSensor.setOutOfRangeGracePeriod = function(sensor, callback) {
    var reqBody = { id: sensor.wirelessTag.slaveId,
                    // we can't use the accessor property ('gracePeriod') here
                    // becasuse that one will return the value mapped to seconds
                    oorGrace: sensor.data.oorGrace };
    var flagIndex = ('function' === typeof callback) ? 2 : 1;
    reqBody.applyAll = arguments[flagIndex] || false;
    var req = sensor.callAPI('/ethClient.asmx/SetOutOfRangeGrace',
                             reqBody,
                             callback);
    return req.then((result) => {
        sensor.wirelessTag.data = result;
        if (callback) callback(null, { object: sensor });
        return sensor;
    });
};

WirelessTagSensor.changeArmedStatus = function(sensor, callback) {
    var isArmed = sensor.isArmed();
    var action = isArmed ? "disarm" : "arm";
    var apiSpec = sensorMonitorApiURIs[sensor.sensorType];
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
};

/**
 * The monitoring configuration of a {@link WirelessTagSensor}.
 *
 * A user will not normally need to create instances directly; instead
 * they are returned from {@link WirelessTagSensor#monitoringConfig}.
 *
 * @param {string} sensorType - the type of the sensor
 * @param {Object} [data] - the object with the status properties and
 *                 values for this monitoring configuration, as
 *                 returned by the API endpoint
 *
 * @class
 * @alias MonitoringConfig
 */
function MonitoringConfig(sensorType, data) {
    this.data = data || {};
    Object.defineProperty(this, "_dirty", { value: {}, writable: true });
    setPropertiesFromMap(this, monitoringPropertiesMap, sensorType);
    // default save() and update() methods to no-ops
    this.save = this.update = function() {
        return Promise.resolve(this);
    };
}

MonitoringConfig.prototype.isModified = function(configProperty) {
    if (configProperty) return this._dirty[configProperty] || false;
    return Object.keys(this._dirty).length > 0;
};

MonitoringConfig.prototype.resetModified = function() {
    this._dirty = {};
    return this;
};

MonitoringConfig.prototype.markModified = function(configProperty) {
    if (configProperty) {
        this._dirty[configProperty] = true;
    } else {
        for (let key of Object.keys(this.data)) {
            this._dirty[key] = true;
        }
        for (let key of Object.keys(this)) {
            if (! (key.startsWith('_')
                   || key === 'data'
                   || 'function' === typeof this[key])) {
                this._dirty[key] = true;
            }
        }
        // if the above didn't mark anything because this is a dummy-config,
        // ensure this still complies with expected behavior
        if (Object.keys(this._dirty).length === 0) {
            this._dirty.__ALL__ = true;
        }
    }
    return this;
};

MonitoringConfig.prototype.asJSON = function() {
    let propsObj = {};
    // all properties except data and private ones
    for (let propName of Object.getOwnPropertyNames(this)) {
        if (! (propName.startsWith('_')
               || (propName === 'domain')
               || (propName === 'data')
               || ('function' === typeof this[propName]))) {
            propsObj[propName] = this[propName];
        }
    }
    return propsObj;
};

MonitoringConfig.prototype.toString = function() {
    return JSON.stringify(this.asJSON());
};

/* eslint-disable no-invalid-this */
MonitoringConfig.saveFunc = function(sensor) {
    return function(callback) {
        if (this.isModified()) {
            // if this is an out of range config and grace period is one of the
            // properties changed, then start with saving that, which
            // unfortunately is a separate (and undocumented) API call.
            let setGrace;
            if (this.isModified('gracePeriod')) {
                let ecb = callback ?
                    (e) => { if (e) callback(e); } : undefined;
                setGrace = WirelessTagSensor.setOutOfRangeGracePeriod(sensor,
                                                                      ecb);
            } else {
                setGrace = Promise.resolve(sensor);
            }
            // then save the (possibly rest of) monitoring config
            let req = setGrace.then((s) => {
                let ecb = callback ?
                    (e) => { if (e) callback(e); } : undefined;
                return WirelessTagSensor.setMonitoringConfig(s, ecb);
            });
            // finally convert from sensor to config to simplify chaining
            return req.then((s) => {
                let mconfig = s.monitoringConfig().resetModified();
                s.emit('config', s, mconfig, 'save');
                if (callback) callback(null, { object: mconfig });
                return mconfig;
            });
        }
        return Promise.resolve(this);
    };
};
/* eslint-enable no-invalid-this */

/* eslint-disable no-invalid-this */
MonitoringConfig.updateFunc = function(sensor) {
    return function(callback) {
        if (! this.isModified()) {
            let ecb = callback ? (e) => { if (e) callback(e); } : undefined;
            let req = WirelessTagSensor.loadMonitoringConfig(sensor, ecb);
            return req.then(
                (config) => {
                    this.data = config.data;
                    sensor.emit('config', sensor, this, 'update');
                    if (callback) callback(null, { object: this });
                    return this;
                });
        }
        return Promise.resolve(this);
    };
};
/* eslint-enable no-invalid-this */

function setPropertiesFromMap(obj, propMapDict, dictKey) {
    let propMap = propMapDict[dictKey];
    // key aliased to another entry?
    if ('string' === typeof propMap) propMap = propMapDict[propMap];
    for (let propName in propMap) {
        let propSpec = propMap[propName];
        let dataKey = propSpec[0];
        let transform = propSpec[1] ? propSpec[1].bind(obj) : undefined;
        let revTransform = propSpec[2] ? propSpec[2].bind(obj) : undefined;
        let descriptor = {
            enumerable: true,
            configurable: true,
        };
        if (transform !== undefined) {
            /* jshint loopfunc: true */
            // this works because every variable used is declared with let
            descriptor.get = () => {
                if (dataKey === undefined) {
                    return transform();
                }
                return transform(obj.data[dataKey]);
            };
            /* jshint loopfunc: false */
        }
        if (revTransform !== undefined) {
            /* jshint loopfunc: true */
            // this works because every variable used is declared with let
            descriptor.set = (newValue) => {
                let val = revTransform(newValue);
                if (dataKey !== undefined) obj.data[dataKey] = val;
                if ('function' === typeof obj.markModified) {
                    obj.markModified(propName);
                    if (dataKey !== undefined) obj.markModified(dataKey);
                }
                if (obj instanceof EventEmitter) {
                    obj.emit('update', obj, propName, newValue, val);
                }
                return newValue;
            };
            /* jshint loopfunc: false */
        }
        Object.defineProperty(obj, propName, descriptor);
    }
}
