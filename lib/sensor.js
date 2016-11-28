"use strict";

module.exports = WirelessTagSensor;

var request = require('request'),
    util = require('util'),
    EventEmitter = require('events'),
    u = require('./util.js'),
    WirelessTagPlatform = require('./platform.js');

const roSensorProps = [];
const rwSensorProps = [];

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

const xforms = {
    noop: function(x) { return x },
    mapFunction: function(map) { return function(x) { return map[x] } },
    degCtoF: function(x) { return x * 9/5.0 + 32 },
    degFtoC: function(x) { return (x-32) * 5/9.0 },
    rh2dewPoint: function(x) {
        let T = this.wirelessTag.data.temperature; // need native dC temperature
	let b = 17.67, c = 243.5;
	let u = Math.log(RH / 100.0) + b * T / (c + T);
	return c * u / (b - u);
    },
}

const sensorPropertyMap = {
    'motion' : {
    },
    'event' : {
        reading : ["eventState", xforms.noop],
        eventState : ["eventState", xforms.mapFunction(tagEventStates)],
    },
    'light' : {
        reading : ["lux", function(x) { return u.roundPrec(x,2); }],
        eventState : ["lightEventState", xforms.mapFunction(lightEventStates)],
    },
    'temp' : {
        reading : ["temperature",
                   function(x) {
                       return this.wirelessTag.isHTU() ?
                           u.roundPrec(x,2) : u.roundPrec(x,1);
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
};

const sensorMonitorApiURIs = {
    'motion' : {
        arm: "/ethClient.asmx/Arm",
        armData: { door_mode_set_closed: true },
        disarm: "/ethClient.asmx/Disarm",
        load: "/ethClient.asmx/LoadMotionSensorConfig",
        save: "/ethClient.asmx/SaveMotionSensorConfig"
    },
    'event' : {
        arm: "/ethClient.asmx/Arm",
        armData: { door_mode_set_closed: true },
        disarm: "/ethClient.asmx/Disarm",
        load: "/ethClient.asmx/LoadMotionSensorConfig",
        save: "/ethClient.asmx/SaveMotionSensorConfig"
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
        save: "/ethClient.asmx/SaveTempSensorConfig"
    },
    'humidity' : {
        arm: "/ethClient.asmx/ArmCapSensor",
        disarm: "/ethClient.asmx/DisarmCapSensor",
        load: "/ethClient.asmx/LoadCapSensorConfig2",
        payloadKey: "rhEvent",
        save: "/ethClient.asmx/SaveCapSensorConfig"
    },
    'moisture' : {
        arm: "/ethClient.asmx/ArmCapSensor",
        disarm: "/ethClient.asmx/DisarmCapSensor",
        load: "/ethClient.asmx/LoadCapSensorConfig2",
        payloadKey: "rhEvent",
        save: "/ethClient.asmx/SaveCapSensorConfig"
    },
    'water' : {
        load: "/ethClient.asmx/LoadCapSensorConfig2",
        payloadKey: "shortedEvent",
        save: "/ethClient.asmx/SaveWaterSensorConfig"
    },
    'current' : {
        arm: "/ethClient.asmx/ArmCurrentSensor",
        disarm: "/ethClient.asmx/DisarmCurrentSensor",
        load: "/ethClient.asmx/LoadCurrentSensorConfig",
        save: "/ethClient.asmx/SaveCurrentSensorConfig"
    },
};

function WirelessTagSensor(tag, sensorType) {
    EventEmitter.call(this);
    this.wirelessTag = tag;
    this.sensorType = sensorType;
    this.errorHandler = tag.errorHandler || defaultHandler;
    u.setObjProperties(this, roSensorProps, rwSensorProps);
    setPropertiesFromMap(this, sensorPropertyMap[sensorType]);
}
util.inherits(WirelessTagSensor, EventEmitter);

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
    return changeArmedStatus(this, callback);
}

WirelessTagSensor.prototype.disarm = function(callback) {
    var isArmed = this.isArmed();
    if (isArmed === undefined) {
        return Promise.reject("undefined event state - won't disarm");
    }
    if (! isArmed) return Promise.resolve(sensor);
    return changeArmedStatus(this, callback);
}

function changeArmedStatus(sensor, callback) {
    var isArmed = sensor.isArmed();
    var action = isArmed ? "disarm" : "arm";
    var apiSpec = sensorMonitorApiURIs[sensor.sensorType];
    var uri = apiSpec[action];
    if (! uri) return Promise.reject("undefined API for " + action + "ing "
                                     + sensor.sensorType + " sensor of "
                                     + sensor.wirelessTag.name);
    var data = apiSpec[action + "Data"] || {};
    data.id = sensor.wirelessTag.slaveId;
    var req = WirelessTagPlatform.callAPI(uri, data, callback, sensor);
    return req.then(
        (result) => {            
            sensor.wirelessTag.data = result;
            if (isArmed == sensor.isArmed()) {
                // the API call itself succeeded, so this should resolve
                // itself if we retry updating after a short delay
                return new Promise((resolve,reject) => {
                    let action = () => {
                        sensor.wirelessTag.update().then(
                            (tag) => { resolve(tag); },
                            (error) => { reject(error); }
                        );
                    };
                    setTimeout(action, 3000);
                });
            }
            return sensor;
        },
        sensor.errorHandler(callback)
    );    
}

function setPropertiesFromMap(sensor, propMap) {
    for (let propName in propMap) {
        let propSpec = propMap[propName];
        let dataKey = propSpec[0];
        let transform = propSpec[1] ? propSpec[1].bind(sensor) : undefined;
        let revTransform = propSpec[2] ? propSpec[2].bind(sensor) : undefined;
        let descriptor = {
            enumerable: true,
            configurable: true,
        };
        if (transform !== undefined) {
            descriptor.get = () => {
                return transform(sensor.wirelessTag.data[dataKey]);
            }
        }
        if (revTransform !== undefined) {
            descriptor.set = (newValue) => {
                sensor.wirelessTag.data[dataKey] = revTransform(newValue);
                return newValue;
            }
        }
        Object.defineProperty(sensor, propName, descriptor);
    }
}
