/*
 See README.md
 */

var Service, Characteristic, types;

var request = require('request');

// Handle registration with homebridge
module.exports = function(homebridge) {
  Service = homebridge.hap.Service;
  Characteristic = homebridge.hap.Characteristic;
  types = homebridge.hapLegacyTypes;
  homebridge.registerPlatform("homebridge-wireless-sensor-tag", "wireless-sensor-tag", WirelessTagPlatform);
}

// Platform object for the wireless tags. Represents the wireless tag manager
function WirelessTagPlatform(log,config) {
	this.username = config.username;
	this.password = config.password;
	this.queryFrequency = config.queryFrequency;
    this.log = log;
    this.tagMap = {};
    this.tagList = [];
    this.ignoreList = (config.ignoreList == undefined) ? [] : config.ignoreList;
}

WirelessTagPlatform.prototype.shouldIgnore = function(deviceData) {
    if(deviceData != undefined && deviceData.name != undefined) {
        if(this.ignoreList.indexOf(deviceData.name) > -1) {
            return true;
        }
    }
    return false;
}

// Forms a valid request to authenticate against the wireless tag manager. Calls handleResult with a boolean indicating
// success or failure.
WirelessTagPlatform.prototype.sendAuthentication = function(handleResult) {
    request({
        method: 'POST',
        uri: 'http://www.mytaglist.com/ethAccount.asmx/Signin',
        json: true,
        jar: true,
        gzip: true,
        body: { email: this.username, password: this.password }
    }, function (error, response, body) {
        if(error) {
            handleResult(true);
        } else {
            handleResult(response.statusCode!=200);
        }
    });
}

// Forms a valid request to get the latest tag list. Calls handleResult with a boolean indicating success or failure.
WirelessTagPlatform.prototype.getTagList = function(handleResult) {
    request({
        method: 'POST',
        uri: 'http://www.mytaglist.com/ethClient.asmx/GetTagList2',
        json: true,
        jar: true,
        gzip: true,
        body: {}
    }, function (error, response, body) {
        if(error) {
            handleResult(true,body);
        } else {
            handleResult(response.statusCode!=200,body);
        }
    });
}

// Does a request to the server to refresh the tag data. Authenticate every time as not sure how often the 
// authentication requires refreshing. New tags we see get added to the tag map and the tag list. New tags
// added AFTER startup will be tracked internally but not exposed as a device as frankly I don't know how
// to do that dynamically.
WirelessTagPlatform.prototype.refreshTagData = function(complete) {
    var that = this;
    // Auth
    this.sendAuthentication(function(failed) {
        if(!failed) {
            // Gets the tag list
            that.getTagList(function(innerFailure, body) {
                if(!innerFailure) {
                    for(var index = 0; index < body.d.length; index++) {
                        var uuid = body.d[index].uuid;
                        // We haven't seen the tag yet, add it
                        if(that.tagMap[uuid] == null) {
                            if(!that.shouldIgnore(body.d[index])) {
                                var newTag = new WirelessTagAccessory(that.log, body.d[index]);
                                that.tagMap[uuid] = newTag;
                                that.tagList.push(newTag);
                            }
                        // We have, just update it.
                        } else {
                            that.tagMap[uuid].handleUpdate(body.d[index]);
                        }
                    }
                    complete(true);
                } else {
                    that.log("Failed getting tag list");
                    complete(false);
                }
            }); 
        } else {
            that.log("Failed authenticating to tag list");
            complete(false);
        }   
    });
}

// Handles the periodic timer. Reports success or failure and sets the next timer period.
WirelessTagPlatform.prototype.handleTimer = function() {
    var that = this;
    this.log("Starting update of wireless tags from tag manager");
    this.refreshTagData(function(success) {
        if(success) {
            that.log("Updated wireless tag data");
        } else {
            that.log("Failed to update wireless tags");
        }
        // Hack as I was seeing issues with an undefined queryFrequency. Believe I have fixed it but keeping the 
        // minimum in to keep us from spamming the service. Also prevents values below 5000ms.
        if(that.queryFrequency == undefined || that.queryFrequency < 5000) {
            that.log("Error ... invalid query frequency, setting to 20000ms default");
            that.queryFrequency = 20000;
        } else {
            setTimeout(that.handleTimer.bind(that), that.queryFrequency);
        }
    });
}

// Responds to the homebridge platform through calling callback once list of accessories is identified.
WirelessTagPlatform.prototype.accessories = function(callback) {
    var that = this;
    that.refreshTagData(function(success) {
        that.log("Completed getting devices. Result="+success); 
        if(success) {
            that.log("Authenticated and got tag list. Enumerating tags as accessories");
            that.handleTimer();
            callback(that.tagList);
        } else {
            that.log("Could not get tags, no accessories exposed");
            callback([]);
        }
    });    
}

// Represents a single tag
function WirelessTagAccessory(log,deviceData) {
    this.log = log;
    this.handleUpdate(deviceData);
}

// Refreshes tag data from the device update data
WirelessTagAccessory.prototype.handleUpdate = function(deviceData) {
    this.isOutOfRange = deviceData.OutOfRange;
    this.isAlive = deviceData.alive;
    this.batteryRemaining = deviceData.batteryRemaining;
    this.uuid = deviceData.uuid;
    this.tagType = deviceData.tagType;
    this.temperature = deviceData.temperature;
    this.name = deviceData.name;
    if(deviceData.cap != undefined) {
        this.humidity = Math.round(deviceData.cap);
    } else {
        this.humidity = 0.0;
    }
    this.uuid_base = this.uuid;
    
    // Protections to ensure we don't set the current characteristic value whens services are not yet registered.
    if(this.tempService != null && this.tempService != undefined) {
        this.tempService
            .setCharacteristic(Characteristic.CurrentTemperature, this.temperature);    
    }

    if(this.humidityService != null && this.humidityService != undefined) {
        this.humidityService
            .setCharacteristic(Characteristic.CurrentRelativeHumidity, this.humidity);
    }
}

// Handles getting the temperature in format needed by homebridge. Luckily this is just the raw value in degrees C
WirelessTagAccessory.prototype.getTemperature = function(callback) {
    callback(null,this.temperature);
}

// Handles getting the humidity in format needed by homebridge.
WirelessTagAccessory.prototype.getHumidity = function(callback) {
    callback(null,this.humidity);
}

// Translates tag state into an occupancy value. If tag is inactive or out of range occupancy is false
WirelessTagAccessory.prototype.getOccupancy = function(callback) {
    var isAway = false;
    if(this.isOutOfRange == undefined) {
        isAway = true;
    } else if(this.isOutOfRange) {
        isAway = true;
    } else if(!this.isAlive) {
        isAway = true;
    }
    callback(null,isAway ? Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED : Characteristic.OccupancyDetected.OCCUPANCY_DETECTED);
}

// Sets up the information, temperature and occupancy services.
WirelessTagAccessory.prototype.getServices = function() {
    this.informationService = new Service.AccessoryInformation();

    this.informationService
      .setCharacteristic(Characteristic.Manufacturer, "SmartHome")
      .setCharacteristic(Characteristic.Model, "Wireless Sensor Tag Type="+this.tagType)
      .setCharacteristic(Characteristic.SerialNumber, this.uuid);   

    this.tempService = new Service.TemperatureSensor();
      
    this.tempService
      .getCharacteristic(Characteristic.CurrentTemperature)
      .on('get', this.getTemperature.bind(this));

    this.humidityService = new Service.HumiditySensor();

    this.humidityService
        .getCharacteristic(Characteristic.CurrentRelativeHumidity)
        .on('get', this.getHumidity.bind(this));
      
    this.occupancyService = new Service.OccupancySensor();
    
    this.occupancyService
      .getCharacteristic(Characteristic.OccupancyDetected)
      .on('get', this.getOccupancy.bind(this));

    return [this.informationService, this.tempService, this.occupancyService, this.humidityService];
}

module.exports.platform = WirelessTagPlatform;
module.exports.accessory = WirelessTagAccessory;



