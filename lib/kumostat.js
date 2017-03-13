"use strict";

var xforms = require('./xforms');

module.exports = function(tag) {
    // accessors for thermostat record
    let thermostat = {
        // status of fan
        get isFanOn() { return tag.data.thermostat.fanOn },
        // status of AC/Heat
        get isACHeatOn() { return ! tag.data.thermostat.turnOff },
        // low and high thresholds
        get thresholdLow() {
            return this.tempFromNative(tag.data.thermostat.th_low);
        },
        set thresholdLow(x) {
            tag.data.thermostat.th_low = this.tempToNative(x);
        },
        get thresholdHigh() {
            return this.tempFromNative(tag.data.thermostat.th_high);
        },
        set thresholdHigh(x) {
            tag.data.thermostat.th_high = this.tempToNative(x);
        },
        // use Home/Away for Nest?
        get useHomeAway() { return ! tag.data.thermostat.disableLocal },
        // UUID of tag measuring temperature
        get tempTagUUID() { return tag.data.thermostat.targetUuid },
        set tempTagUUID(uuid) { tag.data.thermostat.targetUuid = uuid }
    };
    thermostat.saveTempConfig = function(callback) {
        // this is shorthand for obtaining the sensor to be used, and then
        // setting it, which will also set the thresholds
        return this.tempSensor().then(
            (sensor) => this.tempSensor(sensor, callback)
        );
    };
    thermostat.tempSensor = function(sensor, callback) {
        if (sensor) {
            this._tempSensor = sensor;
            return setThermostatSensor(tag, sensor, callback);
        }
        if (this._tempSensor
            && this._tempSensor.wirelessTag.uuid === this.tempTagUUID) {
            return Promise.resolve(this._tempSensor);
        }
        let req;
        if (this.tempTagUUID === tag.uuid) {
            req = Promise.resolve(tag);
        } else {
            let mgr = tag.wirelessTagManager;
            req = mgr.discoverTags({ uuid: this.tempTagUUID }).then((tags) => {
                if (tags.length === 0) {
                    throw new Error(`failed to find tag ${this.tempTagUUID}`);
                }
                return tags[0];
            });
        }
        return req.then(
            (tagObj) => tagObj.initializeSensor('temp')
        ).then((sensorObj) => {
            this._tempSensor = sensorObj;
            return sensorObj;
        });
    };
    // make the _tempSensor cache non-enumerable and non-configurable
    Object.defineProperty(thermostat, '_tempSensor', {
        writable: true, value: undefined
    });
    // make the temperature transforms non-enumerable and non-configurable
    Object.defineProperty(thermostat, 'tempToNative', {
        writable: true, value: (x) => x
    });
    // make the temperature transforms non-enumerable and non-configurable
    Object.defineProperty(thermostat, 'tempFromNative', {
        writable: true, value: (x) => x
    });
    // prevent other properties from being added accidentally
    Object.seal(thermostat);
    Object.defineProperty(tag, 'thermostat', {
        enumerable: true,
        value: thermostat
    });
    // switch fan on or off
    tag.fanOn = function(callback) {
        return switchFan(tag, true, callback);
    };
    tag.fanOff = function(callback) {
        return switchFan(tag, false, callback);
    };
    // switch AC/Heat on or off
    tag.turnACHeatOn = function(callback) {
        return switchACHeat(tag, true, callback);
    };
    tag.turnACHeatOff = function(callback) {
        return switchACHeat(tag, false, callback);
    };
    // kick off initializing the temperature sensor - the main reason this
    // is needed is for determining the temperature unit
    return tag.initializeSensor('temp').then((sensor) => {
        // cache if this is also the thermostat sensor
        if (thermostat.tempTagUUID === tag.uuid) {
            tag.thermostat._tempSensor = sensor;
        }
        // put in place the actual temperature transform functions
        thermostat.tempFromNative = xforms.tempFromNative().bind(sensor);
        thermostat.tempToNative = xforms.tempToNative().bind(sensor);
        return tag;
    });
};

function switchFan(tag, turnOn, callback) {
    let req = tag.callAPI('/ethClient.asmx/ThermostatFanOnOff',
                          { thermostatId: tag.slaveId, turnOn: turnOn },
                          callback);
    return req.then((result) => {
        tag.data = result;
        if (callback) callback(null, { object: tag });
        return tag;
    });
}

function switchACHeat(tag, turnOn, callback) {
    let req = tag.callAPI('/ethClient.asmx/ThermostatOnOff',
                          { thermostatId: tag.slaveId, turnOff: ! turnOn },
                          callback);
    return req.then((result) => {
        tag.data = result;
        if (callback) callback(null, { object: tag });
        return tag;
    });
}

function setThermostatSensor(tag, sensor, callback) {
    let req = tag.callAPI('/ethClient.asmx/SetThermostatTarget',
                          { thermostatId: tag.slaveId,
                            tempSensorUuid: sensor.wirelessTag.uuid,
                            // need untransformed, native degC
                            th_high: tag.data.thermostat.th_high,
                            th_low: tag.data.thermostat.th_low
                          },
                          callback);
    return req.then((result) => {
        tag.data = result;
        let ecb = callback ?
            (err) => { if (err) return callback(err); } : undefined;
        return sensor.wirelessTag.uuid === tag.uuid ? sensor : sensor.arm(ecb);
    }).then((sensorObj) => {
        if (callback) callback(null, { object: tag, value: sensorObj });
        return sensorObj;
    });
}
