/*
 * See README.md
 */
"use strict";

var request = require('request'),
    util = require('util'),
    EventEmitter = require('events'),
    lib = require('./lib/util.js'),
    WirelessTagManager = require('./lib/tagmanager.js');

/*
 * The cloud platform interface to the Wireless Tag platform
 */
function WirelessTagPlatform(config, log) {
    EventEmitter.call(this);
    this.config = config;
    this.log = log || console.log;
    this.tagManagers = [];
    this.tagManagerMap = {};
    this.errorHandler = config.errorHandler || lib.defaultHandler;
}
util.inherits(WirelessTagPlatform, EventEmitter);


// Authenticates against the wireless tag cloud.
WirelessTagPlatform.prototype.connect = function(config, log, callback) {
    this.config = config || this.config;
    this.log = log || this.log;

    this.isConnected().then(
        (connected) => {
            if (connected) return this;
            return lib.doAPIrequest(
                '/ethAccount.asmx/Signin',
                'POST',
                { email: this.config.username, password: this.config.password },
                callback)
                .then(
                    (res) => { this.emit('connect', this); },
                    this.errorHandler(callback)
                );
        },
        this.errorHandler(callback)
    );
    return this;
}

WirelessTagPlatform.prototype.isConnected = function(callback) {
    return lib.doAPIrequest('/ethAccount.asmx/IsSignedIn',
                            'POST',
                            {},
                            callback);
}

WirelessTagPlatform.prototype.discoverTagManagers = function(query, callback) {
    var filter = lib.createFilter(query);
    var req = lib.doAPIrequest(
        '/ethAccount.asmx/GetTagManagers',
        'POST',
        {},
        callback);
    return req.then(
        (result) => {
            result = result.filter(filter);
            this.tagManagers = [];
            this.tagManagerMap = {};
            for (let mgrData of result) {
                let tagManager = new WirelessTagManager(this, mgrData);
                this.tagManagers.push(tagManager);
                this.tagManagerMap[tagManager.mac] = tagManager;
                this.emit('discover', tagManager);
            };
        },
        this.errorHandler(callback)
    );
}

module.exports = WirelessTagPlatform;
