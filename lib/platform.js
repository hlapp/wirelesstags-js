"use strict";

module.exports = WirelessTagPlatform;

var request = require('request'),
    http = require('http'),
    util = require('util'),
    EventEmitter = require('events');

var u = require('./util.js'),
    WirelessTagManager = require('./tagmanager.js');

const API_BASE_URI = 'https://www.mytaglist.com';

/*
 * The cloud platform interface to the Wireless Tag platform
 */
function WirelessTagPlatform(config, log) {
    EventEmitter.call(this);
    this.config = config || {};
    this.log = log || console.log;
    this.errorHandler = this.config.errorHandler || u.defaultHandler;
    this.callAPI = WirelessTagPlatform.callAPI;
}
util.inherits(WirelessTagPlatform, EventEmitter);


// Authenticates against the wireless tag cloud.
WirelessTagPlatform.prototype.connect = function(config, log, callback) {
    this.config = config || this.config;
    this.log = log || this.log;

    return this.isConnected().then(
        (connected) => {
            if (connected) return this;
            return this.callAPI(
                '/ethAccount.asmx/Signin',
                { email: this.config.username, password: this.config.password },
                callback)
                .then(
                    (res) => {
                        this.emit('connect', this);
                        return this;
                    },
                    this.errorHandler(callback)
                );
        },
        this.errorHandler(callback)
    );
}

WirelessTagPlatform.prototype.isConnected = function(callback) {
    return this.callAPI('/ethAccount.asmx/IsSignedIn', {}, callback);
}

WirelessTagPlatform.prototype.discoverTagManagers = function(query, callback) {
    var req = this.callAPI(
        '/ethAccount.asmx/GetTagManagers',
        {},
        callback);
    return req.then(
        (result) => {
            var filter = u.createFilter(query);
            result = result.filter(filter);
            this.tagManagers = [];
            this.tagManagerMap = {};
            for (let mgrData of result) {
                let tagManager = new WirelessTagManager(this, mgrData);
                this.emit('discover', tagManager);
            };
            return this;
        },
        this.errorHandler(callback)
    );
}

WirelessTagPlatform.prototype.selectTagManager = function(tagManager,callback) {
    if (tagManager.selected) return Promise.resolve(tagManager);

    var req = this.callAPI(
        '/ethAccount.asmx/SelectTagManager',
        { mac: tagManager.mac },
        callback);
    return req.then(
        (result) => {
            tagManager.data.selected = true;
            return tagManager;
        },
        this.errorHandler(callback)
    );
}


WirelessTagPlatform.callAPI = function(uri, reqBody, callback, caller) {
    var platform = undefined;
    var tagManager = undefined;

    // if possible, determine platform and tag manager instance calling us
    if (! caller) {
        // callback is optional, test for caller being 3rd parameter
        if (callback && ('object' === typeof callback)) {
            caller = callback;
            callback = undefined;
        } else {
            caller = this;
        }
    }
    if (caller instanceof WirelessTagPlatform) {
        platform = caller;
        // in this case no tag manager, and none should be needed
    } else if (caller instanceof WirelessTagManager) {
        tagManager = caller;
    } else {
        // caller could be sensor or tag instance, try first as sensor
        let tag = caller.wirelessTag;
        // if not sensor, try as tag
        tagManager = tag ? tag.wirelessTagManager : caller.wirelessTagManager;
    }
    if (tagManager) platform = tagManager.wirelessTagPlatform;

    // allow overriding of API_BASE_URI through config, if we have platform
    if (! (uri.startsWith('https://') || uri.startsWith('http://'))) {
        let api_base = API_BASE_URI;
        if (platform && platform.config.api_base_uri) {
            api_base = platform.config.api_base_uri;
        }
        uri = api_base + uri;
    }

    // if we got a tag manager instance, ensure it's selected, as this is
    // unfortunately required by most API methods
    var selectTask =
        tagManager ? tagManager.select() : Promise.resolve(tagManager);

    var apiCall = selectTask.then(
        (res) => {
            let req = new Promise((resolve,reject) => {
                request({
                    method: 'POST',
                    uri: uri,
                    json: true,
                    jar: true,
                    gzip: true,
                    body: reqBody || {}
                }, function (error, response, body) {
                    error = checkAPIerror(error, response, uri, reqBody, body);
                    if (error) return reject(error);
                    resolve(body.d === undefined ? body : body.d);
                });
            });
            return req;
        },
        platform ? platform.errorHandler(callback) : u.defaultHandler(callback)
    );
    if (callback) {
        return apiCall.then(
            (result) => { callback(null,result); return result; },
            (error) => { return callback(error) });
    }
    return apiCall;
}

function checkAPIerror(error, response, uri, reqBody, body) {
    if (error) return error;
    if (! response) return new Error("undefined response for URI " + uri);
    if (response.statusCode != 200) {
        let error = new Error(
            "Calling " + uri
                + (reqBody ? " with body " + JSON.stringify(reqBody) : "")
                + " failed with status " + response.statusCode);
        error.name = http.STATUS_CODES[response.statusCode];
        if (body) {
            if (body.ExceptionType) error.name = body.ExceptionType;
            if (body.Message) error += "\n" + body.Message;
        }
        return error;
    }
    return null;
}
