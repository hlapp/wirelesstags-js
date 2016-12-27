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
function WirelessTagPlatform(config) {
    EventEmitter.call(this);
    if (config === undefined) config = {};
    this.log = config.log || console.log;
    this.errorHandler = config.errorHandler || u.defaultHandler;
    this.apiBaseURI = config.apiBaseURI || API_BASE_URI;
    this.callAPI = WirelessTagPlatform.callAPI;
}
util.inherits(WirelessTagPlatform, EventEmitter);


// Authenticates against the wireless tag cloud.
WirelessTagPlatform.prototype.connect = function(opts, callback) {

    return this.isConnected().then(
        (connected) => {
            if (connected) return this;
            return this.callAPI(
                '/ethAccount.asmx/Signin',
                { email: opts.username, password: opts.password },
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
};

WirelessTagPlatform.prototype.isConnected = function(callback) {
    return this.callAPI('/ethAccount.asmx/IsSignedIn', {}, callback);
};

WirelessTagPlatform.prototype.discoverTagManagers = function(query, callback) {
    var req = this.callAPI(
        '/ethAccount.asmx/GetTagManagers',
        {},
        callback);
    return req.then(
        (result) => {
            let tagManagers = [];
            result = result.filter(u.createFilter(query));
            for (let mgrData of result) {
                let tagManager = new WirelessTagManager(this, mgrData);
                tagManagers.push(tagManager);
                this.emit('discover', tagManager);
            }
            return tagManagers;
        },
        this.errorHandler(callback)
    );
};

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
};


WirelessTagPlatform.callAPI = function(uri, reqBody, callback, caller) {
    var platform, tagManager;

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

    // prefix with base URI if not already an absolute URI
    if (! (uri.startsWith('https://') || uri.startsWith('http://'))) {
        let api_base = platform ? platform.apiBaseURI : API_BASE_URI;
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
};

var APICallError = require('./error/APICallError.js'),
    TagDidNotRespondError = require('./error/TagDidNotRespondError.js'),
    DuplicateEthCmdError = require('./error/DuplicateEthCmdError.js'),
    TagManagerOfflineError = require('./error/TagManagerOfflineError.js'),
    OperationIncompleteError = require('./error/OperationIncompleteError.js'),
    RetryUnsuccessfulError = require('./error/RetryUnsuccessfulError.js'),
    OperationUnsupportedError = require('./error/OperationUnsupportedError.js');

WirelessTagPlatform.APICallError = APICallError;
WirelessTagPlatform.TagDidNotRespondError = TagDidNotRespondError;
WirelessTagPlatform.DuplicateEthCmdError = DuplicateEthCmdError;
WirelessTagPlatform.OperationIncompleteError = OperationIncompleteError;
WirelessTagPlatform.RetryUnsuccessfulError = RetryUnsuccessfulError;
WirelessTagPlatform.TagManagerOfflineError = TagManagerOfflineError;
WirelessTagPlatform.OperationUnsupportedError = OperationUnsupportedError;

function checkAPIerror(error, response, uri, reqBody, body) {
    if (error) return error;
    if (! response) return new Error("undefined response for URI " + uri);
    if (response.statusCode != 200) {
        let apiCallProps = { statusCode: response.statusCode,
                             requestBody: reqBody,
                             url: uri };
        let APIError = APICallError;
        let message = http.STATUS_CODES[response.statusCode];
        if (body) {
            if (body.ExceptionType) {
                let typeMatch = body.ExceptionType.match(/^\w+\.\w+\+(\w+)$/);
                if (typeMatch === null) {
                    typeMatch = body.ExceptionType.match(/^\w+\.(\w+)$/);
                }
                if (typeMatch !== null) {
                    let errorType = typeMatch[1].replace("Exception","Error");
                    if (WirelessTagPlatform[errorType]) {
                        APIError = WirelessTagPlatform[errorType];
                    } else {
                        message = body.ExceptionType;
                    }
                } else {
                    message = body.ExceptionType;
                }
            }
            if (body.Message) message += ": " + body.Message;
        }
        return new APIError(message, apiCallProps);
    }
    return null;
}
