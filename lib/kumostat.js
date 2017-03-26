"use strict";

/** @module lib/kumostat */

var xforms = require('./xforms');

/**
 * Objects and functions as a mix-in for {@link WirelessTag} objects that
 * represent a thermostat. (Wireless Sensor Tags calls such a tag a
 * _Kumostat_, from _kumo_, which is Japanese for 'cloud'. Currently
 * they support Honeywell and Nest thermostats.)
 *
 * @mixin kumostat
 */

 /**
  * Injects Kumostat (virtual thermostat controlling an actual thermostat)
  * properties and methods to a {@link WirelessTag} object.
  *
  * @param {WirelessTag} tag - the tag object to be injected with the mixin
  * @returns {Promise} Resolves to the tag object once the tag's temperature
  *             sensor has completed initializing. Waiting for this to complete
  *             is only needed for reading or setting the temperature
  *             thresholds in the correct unit
  *
  */
module.exports = function(tag) {
    /**
     * Property of Kumostat tags for querying fan and AC/Heat status, and for
     * getting/setting temperature thresholds and temperature sensing tag.
     *
     * @property {boolean} isFanOn - note that `false` typically means "auto"
     *      not strictly "off". (The fan can't be off when AC/Heat is on.)
     * @property {boolean} isACHeatOn - whether the AC or Heat is on
     * @property {number} thresholdLow - the lower end of the temperature
     *      comfort zone (unit as configured)
     * @property {number} thresholdHigh - the higher end of the temperature
     *      comfort zone (unit as configured)
     * @property {boolean} useHomeAway - whether to use the Nest Home/Away
     *      setting
     * @property {string} tempTagUUID - the `uuid` property of the tag that
     *      is to control (= measure) the temperature
     *
     * @alias thermostat
     * @memberof module:lib/kumostat~kumostat#
     */
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
    /**
     * Sets the thermostat to use the lower and upper temperature thresholds
     * as well as the temperature reading of the temperature-controlling tag.
     * This will normally turn on AC/Heat.
     *
     * Note that as a side effect, if a temperature-controlling tag different
     * from the Kumostat itself was set, its temperature sensor will be armed.
     *
     * @param {module:wirelesstags~apiCallback} [callback]
     * @returns {Promise} Resolves to the thermostat object if successful
     * @alias thermostat.set
     * @memberof! module:lib/kumostat~kumostat#
     */
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
    /**
     * Obtains the temperature sensor controlling the thermostat. This will
     * use the tag currently configured as the temperature controlling tag.
     *
     * @param {module:wirelesstags~apiCallback} [callback]
     * @returns {Promise} Resolves to the temperature sensor object of the tag
     *      currently configured to control the temperature.
     * @alias thermostat.tempSensor
     * @memberof! module:lib/kumostat~kumostat#
     */
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
    /**
     * Method of Kumostat tags. Turns the fan on.
     * @method turnFanOn
     * @param {module:wirelesstags~apiCallback} [callback]
     * @returns {Promise} Resolves to the Kumostat tag upon completion.
     * @memberof module:lib/kumostat~kumostat#
     */
    tag.turnFanOn = function(callback) {
        return switchFan(tag, true, callback);
    };
    /**
     * Method of Kumostat tags. Turns the fan "off." In practice this will
     * usually mean 'auto' rather than strictly 'off' (for example, the fan
     * can't be off if AC/Heat is on).
     * @method turnFanOff
     * @param {module:wirelesstags~apiCallback} [callback]
     * @returns {Promise} Resolves to the Kumostat tag upon completion.
     * @memberof module:lib/kumostat~kumostat#
     */
    tag.turnFanOff = function(callback) {
        return switchFan(tag, false, callback);
    };
    /**
     * Method of Kumostat tags. Turns AC/Heat on.
     * @method turnACHeatOn
     * @param {module:wirelesstags~apiCallback} [callback]
     * @returns {Promise} Resolves to the Kumostat tag upon completion.
     * @memberof module:lib/kumostat~kumostat#
     */
    tag.turnACHeatOn = function(callback) {
        return switchACHeat(tag, true, callback);
    };
    /**
     * Method of Kumostat tags. Turns AC/Heat off.
     * @method turnACHeatOff
     * @param {module:wirelesstags~apiCallback} [callback]
     * @returns {Promise} Resolves to the Kumostat tag upon completion.
     * @memberof module:lib/kumostat~kumostat#
     */
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
