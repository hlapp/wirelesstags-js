"use strict";

var xforms = require('./xforms'),
    u = require('./util'),
    OperationUnsupportedError = require('./error/OperationUnsupportedError');

const tempTransforms = {
    absolute: [xforms.tempFromNative(false), xforms.tempToNative(false)],
    relative: [xforms.tempFromNative(true), xforms.tempToNative(true)]
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
        onBecomeDry: "notify_open"                // boolean
    },
    notifyOutOfRangeMap: {
        email: "email_oor",                       // sigh!
        sound: "apnsSound",                       // string
        useEmail: "send_email_oor",               // sigh!
        usePush: "beep_pc_oor",                   // sigh!
        useSpeech: "beep_pc_tts_oor",             // sigh!
        noSound: "beep_pc_vibrate_oor"            // sigh!
    },
    thresholdMap: {
        lowValue: "th_low",
        minLowReadings: "th_low_delay",
        highValue: "th_high",
        minHighReadings: "th_high_delay",
        hysteresis: "th_window"
    },
    lightThresholdMap: {
        lowValue: "lux_th_low",                   // sigh!
        minLowReadings: "th_low_delay",
        highValue: "lux_th_high",                 // sigh!
        minHighReadings: "th_high_delay",
        hysteresis: "lux_th_window"               // sigh!
    },
    batteryThresholdMap: {
        lowValue: "threshold"                     // sigh!
    },
    capacitanceCalibMap: {
        lowValue: "cal1",
        lowCapacitance: "calRaw1",
        highValue: "cal2",
        highCapacitance: "calRaw2"
    },
    doorModeMap: {
        angle: "door_mode_angle",                 // degrees
        notifyWhenOpenFor: "door_mode_delay",     // seconds
        notifyOnClosed: "send_email_on_close"     // boolean
    },
    motionModeMap: {
        timeoutOrResetAfter: "auto_reset_delay",  // seconds
        timeoutMode: "hmc_timeout_mode"           // boolean
    },
    orientationMap1: {
        x: "az_x", y: "az_y", z: "az_z"
    },
    orientationMap2: {
        x: "az2_x", y: "az2_y", z: "az2_z"
    }
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
        armSilently: ["silent_arming", xforms.noop, xforms.noop]
    },
    // accelerometer properties get overlaid over motion
    'accelerometer': {
        sensitivity: ["sensitivity2", xforms.noop, xforms.noop]
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
        beepTag: ["beep_tag", xforms.noop, xforms.noop]           // boolean
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
        thresholdQuantization: ["threshold_q", xforms.noop, xforms.noop]
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
                                     'calibration')]
    },
    'moisture': 'humidity',
    'water': {
        notifySettings: [
            undefined,
            xforms.mapObjectFunction(objectMaps.notifyMap, 'notifySettings')]
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
                         xforms.revMapFunction(capResponsivenessStates)]
    },
    'battery': {
        notifySettings: [
            undefined,
            xforms.mapObjectFunction(objectMaps.notifyMap, 'notifySettings')],
        thresholds: [
            undefined,
            xforms.mapObjectFunction(objectMaps.batteryThresholdMap,
                                     'thresholds')],
        monitoringEnabled: ["enabled", xforms.noop, xforms.noop]   // boolean
    },
    'outofrange': {
        notifySettings: [
            undefined,
            xforms.mapObjectFunction(objectMaps.notifyOutOfRangeMap,
                                     'notifySettings')]
    }
};

const sensorMonitorApiURIs = {
    'motion': {
        load: "/ethClient.asmx/LoadMotionSensorConfig",
        save: "/ethClient.asmx/SaveMotionSensorConfig2"
    },
    'event': {
        load: "/ethClient.asmx/LoadMotionSensorConfig",
        save: "/ethClient.asmx/SaveMotionSensorConfig2"
    },
    'light': {
        load: "/ethClient.asmx/LoadLightSensorConfig",
        save: "/ethClient.asmx/SaveLightSensorConfig"
    },
    'temp': {
        load: "/ethClient.asmx/LoadTempSensorConfig",
        save: "/ethClient.asmx/SaveTempSensorConfig2"
    },
    'humidity': {
        load: "/ethClient.asmx/LoadCapSensorConfig2",
        payloadKey: "rhEvent",
        save: "/ethClient.asmx/SaveCapSensorConfig2"
    },
    'moisture': {
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
    }
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
    u.defineLinkedPropertiesFromMap(this, monitoringPropertiesMap, sensorType);
    // default save() and update() methods to no-ops
    this.save = this.update = function() { return Promise.resolve(this) };
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

MonitoringConfig.create = function(sensor, data) {
    let mconfig = new MonitoringConfig(sensor.sensorType, data);
    // tweak if motion or event or outOfRange config
    if (sensor.sensorType === 'motion' || sensor.sensorType === 'event') {
        if (sensor.wirelessTag.hasAccelerometer()) {
            u.defineLinkedPropertiesFromMap(mconfig,
                                            monitoringPropertiesMap,
                                            'accelerometer');
        }
    } else if (sensor.sensorType === 'outofrange') {
        let getSetFunc = xforms.delegatingFunction(sensor, 'gracePeriod');
        Object.defineProperty(mconfig, 'gracePeriod', {
            enumerable: true,
            configurable: true,
            get: getSetFunc,
            set: (newValue) => {
                getSetFunc(newValue);
                mconfig.markModified('gracePeriod');
            }
        });
    }
    // replace no-op method placeholders with real functions
    let apiSpec = sensorMonitorApiURIs[sensor.sensorType];
    if (apiSpec && apiSpec.load) mconfig.update = configUpdateFunc(sensor);
    if (apiSpec && apiSpec.save) mconfig.save = configSaveFunc(sensor);
    // done
    return mconfig;
};

/* eslint-disable no-invalid-this */
function configSaveFunc(sensor) {
    return function(callback) {
        if (this.isModified()) {
            // if this is an out of range config and grace period is one of the
            // properties changed, then start with saving that, which
            // unfortunately is a separate (and undocumented) API call.
            let setGrace;
            if (this.isModified('gracePeriod')) {
                let ecb = callback ?
                    (e) => { if (e) callback(e); } : undefined;
                setGrace = setOutOfRangeGracePeriod(sensor, ecb);
            } else {
                setGrace = Promise.resolve(sensor);
            }
            // then save the (possibly rest of) monitoring config
            let req = setGrace.then((s) => {
                let ecb = callback ?
                    (e) => { if (e) callback(e); } : undefined;
                return setMonitoringConfig(s, ecb);
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
}
/* eslint-enable no-invalid-this */

/* eslint-disable no-invalid-this */
function configUpdateFunc(sensor) {
    return function(callback) {
        if (! this.isModified()) {
            let ecb = callback ? (e) => { if (e) callback(e); } : undefined;
            let req = loadMonitoringConfig(sensor, ecb);
            return req.then((configData) => {
                this.data = configData;
                sensor.emit('config', sensor, this, 'update');
                if (callback) callback(null, { object: sensor, value: this });
                return this;
            });
        }
        return Promise.resolve(this);
    };
}
/* eslint-enable no-invalid-this */

function loadMonitoringConfig(sensor, callback) {
    var apiSpec = sensorMonitorApiURIs[sensor.sensorType];
    var req = sensor.callAPI(apiSpec.load,
                            { id: sensor.wirelessTag.slaveId },
                            callback);
    return req.then((result) => {
        if (apiSpec.payloadKey) result = result[apiSpec.payloadKey];
        return result;
    });
}

function setMonitoringConfig(sensor, callback) {
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
}

function setOutOfRangeGracePeriod(sensor, callback) {
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
}

module.exports = MonitoringConfig;
