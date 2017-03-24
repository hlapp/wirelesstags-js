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
    thermostat.set = function(callback) {
        let req = tag.callAPI('/ethClient.asmx/SetThermostatTarget',
                              { thermostatId: tag.slaveId,
                                tempSensorUuid: this.tempTagUUID,
                                // need untransformed, native degC
                                th_high: tag.data.thermostat.th_high,
                                th_low: tag.data.thermostat.th_low
                               },
                               callback);
        let ecb = callback ?
            (err) => { if (err) return callback(err); } : undefined;
        return req.then((result) => {
            tag.data = result;
            return tag.thermostat.tempSensor(ecb);
        }).then((sensor) => {
            if (sensor.wirelessTag.uuid === tag.uuid) return sensor;
            return sensor.arm(ecb);
        }).then((sensor) => {
            if (callback) callback(null, { object: tag, value: sensor });
            return this;
        });
    };
    thermostat.tempSensor = function(callback) {
        if (this._tempSensor
            && this._tempSensor.wirelessTag.uuid === this.tempTagUUID) {
            return Promise.resolve(this._tempSensor);
        }
        let ecb = callback ?
            (err) => { if (err) return callback(err); } : undefined;
        let req;
        if (this.tempTagUUID === tag.uuid) {
            req = Promise.resolve(tag);
        } else {
            let mgr = tag.wirelessTagManager;
            req = mgr.discoverTags({ uuid: this.tempTagUUID }, ecb);
            req = req.then((tags) => {
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
            if (callback) callback(null, { object: this, value: sensorObj });
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
    // switch fan on or off (off = 'auto')
    tag.turnFanOn = function(callback) {
        return switchFan(tag, true, callback);
    };
    tag.turnFanOff = function(callback) {
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
