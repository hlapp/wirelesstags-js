"use strict";

module.exports = WirelessTagSensor;

var request = require('request'),
    util = require('util'),
    EventEmitter = require('events'),
    deepEqual = require('deep-equal'),
    u = require('./util.js'),
    WirelessTagPlatform = require('./platform.js');

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
}

const xforms = {
    noop: function(x) { return x },
    mapFunction: function(map) { return function(x) { return map[x] } },
    revMapFunction: function(map) {
        return function(x) {
            for (let key in map) {
                if (map[key] == x) return key;
            }
            return undefined;
        };
    },
    mapObjectFunction: function(map) {
        return function() {
            let value = {};
            for (let key in map) {
                value[key] = this.data[map[key]];
            }
            return value;
        };
    },
    revMapObjectFunction: function(map) {
        return function(x) {
            for (let key in map) {
                if (x[key] !== undefined) {
                    if (! this.data.hasOwnProperty(map[key])) {
                        console.warn("## setting value for property", key,
                                     "on an object that may not support it");
                    }
                    this.data[map[key]] = x[key];
                }
            }
            return x;
        };
    },
    degCtoF: function(x) { return x * 9/5.0 + 32 },
    degFtoC: function(x) { return (x-32) * 5/9.0 },
    rh2dewPoint: function(x) {
        let T = this.wirelessTag.data.temperature; // need native dC temperature
	let b = 17.67, c = 243.5;
	let u = Math.log(RH / 100.0) + b * T / (c + T);
	return c * u / (b - u);
    },
}

const sensorPropertiesMap = {
    'motion' : {
    },
    'event' : {
        reading : ["eventState", xforms.noop],
        eventState : ["eventState", xforms.mapFunction(tagEventStates)],
    },
    'light' : {
        reading : ["lux", function(x) { return u.round(x,2); }],
        eventState : ["lightEventState", xforms.mapFunction(lightEventStates)],
    },
    'temp' : {
        reading : ["temperature",
                   function(x) {
                       return this.wirelessTag.isHTU() ?
                           u.round(x,2) : u.round(x,1);
                   }],
        eventState : ["tempEventState", xforms.mapFunction(tempEventStates)],
    },
    'humidity' : {
        reading : ["cap", xforms.noop],
        eventState : ["capEventState", xforms.mapFunction(humidityEventStates)],
    },
    'moisture' : {
        reading : ["cap", xforms.noop],
        eventState : ["capEventState", xforms.mapFunction(moistureEventStates)],
    },
    'water' : {
        reading : ["shorted", xforms.noop],
        eventState : ["shorted",
                      function(x) { return x ? "Water Detected" : "Normal" }],
    },
    'current' : {
        reading: ["ampData", xforms.noop],
        eventState: ["ampData", function(x) { return x.eventState }],
    },
    'battery' : {
        reading: ["batteryVolt",
                  function(x) { return u.round(x,2) } ],
        eventState: ["enLBN",
                     function(x) {
                         if (! x) return "Not Monitoring";
                         if (this.reading >= this.data.LBTh) return "Normal";
                         return "Battery Low";
                     }],
    },
    'outofrange': {
        reading: ["OutOfRange", xforms.noop ],
        eventState: ["OutOfRange",
                     function(x) {
                         return x ? "Out Of Range" : "Normal";
                     }],
        gracePeriod: ["oorGrace",                 // we map this to seconds
                      xforms.mapFunction(outOfRangeGracePeriods),
                      xforms.revMapFunction(outOfRangeGracePeriods),],
    },
    'signal': {
        reading: ["signaldBm", xforms.noop ]
    },
};

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
    oorNotifyMap: {
        email: "email_oor",                       // sigh!
        sound: "apnsSoud",                        // string
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
}

const monitoringPropertiesMap = {
    'motion' : {
        notifySettings: [
            undefined,
            xforms.mapObjectFunction(objectMaps.notifyMap),
            xforms.revMapObjectFunction(objectMaps.notifyMap)],
        sensitivity: ["sensitivity", xforms.noop, xforms.noop],
        responsiveness: ["interval",
                         xforms.mapFunction(motionResponsivenessStates),
                         xforms.revMapFunction(motionResponsivenessStates)],
        isDoorMode: ["door_mode", xforms.noop, xforms.noop],
        doorMode: [undefined,
                   xforms.mapObjectFunction(objectMaps.doorModeMap),
                   xforms.revMapObjectFunction(objectMaps.doorModeMap)],
        motionMode: [undefined,
                     xforms.mapObjectFunction(objectMaps.motionModeMap),
                     xforms.revMapObjectFunction(objectMaps.motionModeMap)],
        orientation1: [undefined,
                       xforms.mapObjectFunction(objectMaps.orientationMap1),
                       xforms.revMapObjectFunction(objectMaps.orientationMap1)],
        orientation2: [undefined,
                       xforms.mapObjectFunction(objectMaps.orientationMap2),
                       xforms.revMapObjectFunction(objectMaps.orientationMap2)],
        armSilently: ["silent_arming", xforms.noop, xforms.noop],
    },
    'event' : 'motion',
    'light' : {
        notifySettings: [
            undefined,
            xforms.mapObjectFunction(objectMaps.notifyMap),
            xforms.revMapObjectFunction(objectMaps.notifyMap)],
        thresholds: [
            undefined,
            xforms.mapObjectFunction(objectMaps.lightThresholdMap),
            xforms.revMapObjectFunction(objectMaps.lightThresholdMap)],
        monitoringInterval: ["th_monitoring_interval",
                             xforms.noop, xforms.noop],           // seconds
        beepTag: ["beep_tag", xforms.noop, xforms.noop],          // boolean
    },
    'temp' : {
        notifySettings: [
            undefined,
            xforms.mapObjectFunction(objectMaps.notifyMap),
            xforms.revMapObjectFunction(objectMaps.notifyMap)],
        thresholds: [
            undefined,
            xforms.mapObjectFunction(objectMaps.thresholdMap),
            xforms.revMapObjectFunction(objectMaps.thresholdMap)],
        monitoringInterval: ["interval", xforms.noop, xforms.noop], // seconds
        unit: ["temp_unit",
               function(x) { return x == 0 ? "degC" : "degF"; }],
        thresholdQuantization: ["threshold_q", xforms.noop, xforms.noop],
    },
    'humidity' : {
        notifySettings: [
            undefined,
            xforms.mapObjectFunction(objectMaps.notifyMap),
            xforms.revMapObjectFunction(objectMaps.notifyMap)],
        thresholds: [
            undefined,
            xforms.mapObjectFunction(objectMaps.thresholdMap),
            xforms.revMapObjectFunction(objectMaps.thresholdMap)],
        responsiveness: ["interval",
                         xforms.mapFunction(capResponsivenessStates),
                         xforms.revMapFunction(capResponsivenessStates)],
        calibration: [
            undefined,
            xforms.mapObjectFunction(objectMaps.capacitanceCalibMap),
            xforms.revMapObjectFunction(objectMaps.capacitanceCalibMap)],
    },
    'moisture' : 'humidity',
    'water' : {
        notifySettings: [
            undefined,
            xforms.mapObjectFunction(objectMaps.notifyMap),
            xforms.revMapObjectFunction(objectMaps.notifyMap)],
    },
    'current' : {
        notifySettings: [
            undefined,
            xforms.mapObjectFunction(objectMaps.notifyMap),
            xforms.revMapObjectFunction(objectMaps.notifyMap)],
        thresholds: [
            undefined,
            xforms.mapObjectFunction(objectMaps.thresholdMap),
            xforms.revMapObjectFunction(objectMaps.thresholdMap)],
        samplingPeriod: ["sampling_period", xforms.noop, xforms.noop],
        responsiveness: ["interval",
                         xforms.mapFunction(capResponsivenessStates),
                         xforms.revMapFunction(capResponsivenessStates)],
    },
    'battery' : {
        notifySettings: [
            undefined,
            xforms.mapObjectFunction(objectMaps.notifyMap),
            xforms.revMapObjectFunction(objectMaps.notifyMap)],
        thresholds: [
            undefined,
            xforms.mapObjectFunction(objectMaps.batteryThresholdMap),
            xforms.revMapObjectFunction(objectMaps.batteryThresholdMap)],
        monitoringEnabled: ["enabled", xforms.noop, xforms.noop],  // boolean
    },
    'outofrange': {
        notifySettings: [
            undefined,
            xforms.mapObjectFunction(objectMaps.notifyMapOor),
            xforms.revMapObjectFunction(objectMaps.notifyMapOor)],
    },
};

const sensorMonitorApiURIs = {
    'motion' : {
        arm: "/ethClient.asmx/Arm",
        armData: { door_mode_set_closed: true },
        disarm: "/ethClient.asmx/Disarm",
        load: "/ethClient.asmx/LoadMotionSensorConfig",
        save: "/ethClient.asmx/SaveMotionSensorConfig2"
    },
    'event' : {
        arm: "/ethClient.asmx/Arm",
        armData: { door_mode_set_closed: true },
        disarm: "/ethClient.asmx/Disarm",
        load: "/ethClient.asmx/LoadMotionSensorConfig",
        save: "/ethClient.asmx/SaveMotionSensorConfig2"
    },
    'light' : {
        arm: "/ethClient.asmx/ArmLightSensor",
        disarm: "/ethClient.asmx/DisarmLightSensor",
        load: "/ethClient.asmx/LoadLightSensorConfig",
        save: "/ethClient.asmx/SaveLightSensorConfig"
    },
    'temp' : {
        arm: "/ethClient.asmx/ArmTempSensor",
        disarm: "/ethClient.asmx/DisarmTempSensor",
        load: "/ethClient.asmx/LoadTempSensorConfig",
        save: "/ethClient.asmx/SaveTempSensorConfig2"
    },
    'humidity' : {
        arm: "/ethClient.asmx/ArmCapSensor",
        disarm: "/ethClient.asmx/DisarmCapSensor",
        load: "/ethClient.asmx/LoadCapSensorConfig2",
        payloadKey: "rhEvent",
        save: "/ethClient.asmx/SaveCapSensorConfig2"
    },
    'moisture' : {
        arm: "/ethClient.asmx/ArmCapSensor",
        disarm: "/ethClient.asmx/DisarmCapSensor",
        load: "/ethClient.asmx/LoadCapSensorConfig2",
        payloadKey: "rhEvent",
        save: "/ethClient.asmx/SaveCapSensorConfig2"
    },
    'water' : {
        load: "/ethClient.asmx/LoadCapSensorConfig2",
        payloadKey: "shortedEvent",
        save: "/ethClient.asmx/SaveWaterSensorConfig2"
    },
    'current' : {
        arm: "/ethClient.asmx/ArmCurrentSensor",
        disarm: "/ethClient.asmx/DisarmCurrentSensor",
        load: "/ethClient.asmx/LoadCurrentSensorConfig",
        save: "/ethClient.asmx/SaveCurrentSensorConfig2"
    },
    'outofrange' : {
        load: "/ethClient.asmx/LoadOutOfRangeConfig",
        save: "/ethClient.asmx/SaveOutOfRangeConfig2"
    },
    'battery' : {
        load: "/ethClient.asmx/LoadLowBatteryConfig",
        save: "/ethClient.asmx/SaveLowBatteryConfig2"
    },
};

function WirelessTagSensor(tag, sensorType) {
    EventEmitter.call(this);
    this.wirelessTag = tag;
    this.callAPI = WirelessTagPlatform.callAPI;
    Object.defineProperty(this, "sensorType", {
        enumerable: true,
        value: sensorType,
    });
    this.errorHandler = tag.errorHandler || defaultHandler;
    Object.defineProperty(this, "data", {
        enumerable: true,
        get: () => { return this.wirelessTag.data; }
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
    // all data properties
    for (let propName of Object.getOwnPropertyNames(this)) {
        if (! (propName.startsWith('_')
               || (propName === 'wirelessTag')
               || (propName === 'data')
               || ('function' === typeof this[propName]))) {
            propsObj[propName] = this[propName];
        }
    }
    // monitoring configuration
    propsObj.monitoringConfig = this.monitoringConfig.toString();
    return JSON.stringify(propsObj);
}

WirelessTagSensor.prototype.isArmed = function() {
    if (this.eventState === undefined) return undefined;
    return ["Disarmed","Not Monitoring","N.A."].indexOf(this.eventState) < 0;
}

WirelessTagSensor.prototype.arm = function(callback) {
    var isArmed = this.isArmed();
    if (isArmed === undefined) {
        return Promise.reject("undefined event state - won't arm");
    }
    if (isArmed) return Promise.resolve(sensor);
    return WirelessTagSensor.changeArmedStatus(this, callback);
}

WirelessTagSensor.prototype.disarm = function(callback) {
    var isArmed = this.isArmed();
    if (isArmed === undefined) {
        return Promise.reject("undefined event state - won't disarm");
    }
    if (! isArmed) return Promise.resolve(sensor);
    return changeArmedStatus(this, callback);
}

WirelessTagSensor.prototype.monitoringConfig = function(newConfig) {
    if (newConfig) {
        let oldConfData = this._config ? this._config.data : {};
        this._config = newConfig;
        if (! deepEqual(oldConfData, newConfig.data)) {
            console.log(this.sensorType, newConfig.data);
            this.emit('config', this, newConfig, 'set');
        }
    }
    return this._config || new MonitoringConfig(this.sensorType);
}

WirelessTagSensor.loadMonitoringConfig = function(sensor, callback) {
    var apiSpec = sensorMonitorApiURIs[sensor.sensorType];
    var uri = apiSpec ? apiSpec["load"] : undefined;
    if (! uri) return Promise.resolve(new MonitoringConfig(sensor.sensorType));
    var req = WirelessTagPlatform.callAPI(uri,
                                          { id: sensor.wirelessTag.slaveId },
                                          callback,
                                          sensor);
    return req.then(
        (result) => {
            if (apiSpec["payloadKey"]) result = result[apiSpec["payloadKey"]];
            let config = new MonitoringConfig(sensor.sensorType, result);
            // replace no-op method placeholders with real functions
            config.save = MonitoringConfig.saveFunc(sensor);
            config.update = MonitoringConfig.updateFunc(sensor);
            return config;
        },
        sensor.errorHandler(callback)
    );
}

WirelessTagSensor.setMonitoringConfig = function(sensor, config, callback) {
    var apiSpec = sensorMonitorApiURIs[sensor.sensorType];
    var uri = apiSpec ? apiSpec["save"] : undefined;
    if (! uri) return Promise.reject("undefined API for updating "
                                     + sensor.sensorType
                                     + " monitoring config for "
                                     + sensor.wirelessTag.name);
    var flagIndex = ('function' === typeof callback) ? 3 : 2;
    var confData = Object.assign({}, config.data);
    delete confData.__type;
    var reqBody = { id: sensor.wirelessTag.slaveId, config: confData };
    reqBody.applyAll = arguments[flagIndex] || false;
    reqBody.allMac = arguments[flagIndex + 1] || false;
    var req = sensor.callAPI(uri, reqBody, callback);
    return req.then(
        () => { return sensor; },
        sensor.errorHandler(callback)
    );
}

WirelessTagSensor.changeArmedStatus = function(sensor, callback) {
    var isArmed = sensor.isArmed();
    var action = isArmed ? "disarm" : "arm";
    var apiSpec = sensorMonitorApiURIs[sensor.sensorType];
    var uri = apiSpec[action];
    if (! uri) return Promise.reject("undefined API for " + action + "ing "
                                     + sensor.sensorType + " sensor of "
                                     + sensor.wirelessTag.name);
    var tag = sensor.wirelessTag;
    var data = apiSpec[action + "Data"] || {};
    data.id = tag.slaveId;
    var req = sensor.callAPI(uri, data, callback);
    return req.then(
        (result) => {
            tag.data = result;
            if (isArmed == sensor.isArmed()) {
                // the API call itself succeeded, so this should resolve
                // itself if we retry updating after a short delay
                return u.delayActionPromise(tag.update().bind(tag),
                                            sensor,
                                            3000);
            }
            return sensor;
        },
        sensor.errorHandler(callback)
    );
}

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
    if (configProperty) return this._dirty[configProperty];
    return Object.keys(this._dirty).length > 0;
}

MonitoringConfig.prototype.resetModified = function(configProperty) {
    if (configProperty) {
        delete this._dirty[configProperty];
    } else {
        this._dirty = {};
    }
    return this;
}

MonitoringConfig.prototype.markModified = function(configProperty) {
    if (configProperty) {
        this._dirty[configProperty] = true;
    } else {
        for (let key of Object.keys(this.data)) {
            this._dirty[key] = true;
        }
    }
    return this;
}

MonitoringConfig.prototype.mergeFrom = function(confData) {
    if (confData instanceof MonitoringConfig) confData = confData.data;
    if (! this.isModified()) {
        this.data = confData;
    } else {
        for (let key in confData) {
            if (! this.isModified(key)) {
                this.data[key] = confData[key];
            }
        }
    }
    return this;
}

MonitoringConfig.prototype.toString = function() {
    let propsObj = {};
    // all properties
    for (let propName of Object.getOwnPropertyNames(this)) {
        if (! (propName.startsWith('_')
               || ('function' === typeof this[propName]))) {
            propsObj[propName] = this[propName];
        }
    }
    // remove the 'data' property
    delete propsObj.data;
}

MonitoringConfig.saveFunc = function(sensor) {
    return function(callback) {
        if (this.isModified()) {
            let req = WirelessTagSensor.setMonitoringConfig(sensor,
                                                            this,
                                                            callback);
            // convert from sensor to config to simplify chaining
            return req.then(
                (sensor) => {
                    sensor.emit('config', sensor, this, 'save');
                    return this;
                });
        }
        return Promise.resolve(this);
    };
}

MonitoringConfig.updateFunc = function(sensor) {
    return function(callback) {
        var req = WirelessTagSensor.loadMonitoringConfig(sensor, callback);
        return latestConfReq.then(
            (config) => {
                this.mergeFrom(config);
                sensor.emit('config', sensor, this, 'update');
                return this;
            },
            sensor.errorHandler(callback)
        );
    };
}

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
            descriptor.get = () => {
                if (dataKey === undefined) {
                    return transform();
                }
                return transform(obj.data[dataKey]);
            }
        }
        if (revTransform !== undefined) {
            descriptor.set = (newValue) => {
                let val = revTransform(newValue);
                if (dataKey !== undefined) obj.data[dataKey] = val;
                if ('function' === typeof obj.markModified) {
                    obj.markModified(propName);
                }
                return newValue;
            }
        }
        Object.defineProperty(obj, propName, descriptor);
    }
}

