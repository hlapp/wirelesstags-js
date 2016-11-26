"use strict";

var request = require('request'),
    util = require('util'),
    EventEmitter = require('events'),
    lib = require('./util.js');

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

const sensorPropertyMap = {
    'motion' : {
    },
    'event' : {
        reading : "eventState",
        eventState : ["eventState",
                      (x) => { return tagEventStates[x] }],
    },
    'light' : {
        reading : ["lux",
                   (x) => { return lib.roundPrec(x,2); }],
        eventState : ["lightEventState",
                      (x) => { return lightEventStates[x] }],
    },
    'temp' : {
        reading : ["temperature",
                   (x, tag) => {
                       return tag.isHTU() ?
                           lib.roundPrec(x,1) : Math.round(x);
                   }],
        eventState : ["tempEventState",
                      (x) => { return tempEventStates[x] }],
    },
    'humidity' : {
        reading : "cap",
        eventState : ["capEventState",
                      (x) => { return humidityEventStates[x] }],
    },
    'moisture' : {
        reading : "cap",
        eventState : ["capEventState",
                      (x) => { return moistureEventStates[x] }],
    },
    'water' : {
        reading : "shorted",
        eventState : ["shorted",
                      (x) => { return x ? "Water Detected" : "Normal" }],
    },
    'current' : {
        reading: "ampData",
        eventState: ["ampData",
                     (x) => { return x.eventState }],
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
    lib.setObjProperties(this, roSensorProps, rwSensorProps);
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
    var apiSpec = sensorMonitorApiURIs[sensor.sensorType],
        uri = apiSpec[action];
    if (! uri) {
        return new Promise((resolve,reject) => {
            reject("undefined API for " + action + "ing "
                   + sensor.sensorType + " sensor of "
                   + sensor.wirelessTag.name);
        });
    }
    var data = apiSpec[action + "Data"] || {};
    data.id = sensor.wirelessTag.slaveId;
    var req = lib.doAPIrequest(
        uri,
        'POST',
        data,
        callback);
    return req.then(
        (result) => {            
            sensor.wirelessTag.data = result;
            if (isArmed == sensor.isArmed()) {
                console.error("attempt to", action,
                              sensor.sensorType, "sensor of",
                              sensor.wirelessTag.name, "failed");
            }
            return sensor;
        },
        sensor.errorHandler(callback)
    );    
}

function setPropertiesFromMap(sensor, propMap) {
    for (let propName in propMap) {
        let dataKey = propMap[propName];
        let transformer = function(x) { return x; };
        let setter = undefined;
        if (Array.isArray(dataKey)) {
            transformer = dataKey[1];
            setter = dataKey[2];
            dataKey = dataKey[0];
        }
        let descriptor = {
            enumerable: true,
            get: function() {
                return transformer(sensor.wirelessTag.data[dataKey],
                                   sensor.wirelessTag);
            }
        };
        if (setter != undefined) {
            descriptor.set = setter;
        }
        Object.defineProperty(sensor, propName, descriptor);
    }
}

module.exports = WirelessTagSensor;
