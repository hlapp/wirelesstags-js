"use strict";

module.exports = WirelessTagPlatform;

var request = require('request'),
    http = require('http'),
    util = require('util'),
    delay = require('timeout-as-promise'),
    EventEmitter = require('events');

var u = require('./util'),
    WirelessTagManager = require('./tagmanager');

const API_BASE_URI = 'https://www.mytaglist.com';
const WAIT_BEFORE_RETRY = 8000;

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
                        if (callback) callback(null, { object: this });
                        return this;
                    },
                    this.errorHandler(callback)
                );
        },
        this.errorHandler(callback)
    );
};

WirelessTagPlatform.prototype.isConnected = function(callback) {
    return this.callAPI('/ethAccount.asmx/IsSignedIn', {}, callback).
        then((res) => {
            if (callback) callback(null, { object: this, value: res });
            return res;
        });
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
            if (callback) callback(null, { object: this, value: tagManagers });
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
            if (callback) callback(null, { object: this, value: tagManager });
            return tagManager;
        },
        this.errorHandler(callback)
    );
};

WirelessTagPlatform.prototype.retryOnError = function(enable) {
    if (enable !== undefined) this._retryAPICalls = enable;
    return this._retryAPICalls || false;
};

WirelessTagPlatform.callAPI = function(uri, reqBody, callback) {
    let platform, tagManager;

    if (this instanceof WirelessTagPlatform) {
        platform = this;
        // in this case no tag manager, and none should be needed
    } else if (this instanceof WirelessTagManager) {
        tagManager = this;
    } else {
        // caller could be sensor or tag instance, try first as sensor
        let tag = this.wirelessTag;
        // if not sensor, try as tag
        tagManager = tag ? tag.wirelessTagManager : this.wirelessTagManager;
    }
    if (tagManager) platform = tagManager.wirelessTagPlatform;

    // prefix with base URI if not already an absolute URI
    if (! (uri.startsWith('https://') || uri.startsWith('http://'))) {
        let api_base = platform ? platform.apiBaseURI : API_BASE_URI;
        uri = api_base + uri;
    }

    // if we got a tag manager instance, ensure it's selected, as this is
    // unfortunately required by most API methods
    let selectTask = tagManager ? tagManager.select() : Promise.resolve();

    let apiCall = selectTask.then(() => {
        return makeAPICall(uri, reqBody);
    }).catch((e) => {
        if (platform && platform.retryOnError() &&
            (e instanceof TagDidNotRespondError)) {
            // we retry this only once
            return delay(WAIT_BEFORE_RETRY).then(() => {
                return makeAPICall(uri, reqBody);
            });
        }
        let handler = platform ?
            platform.errorHandler(callback) : u.defaultHandler(callback);
        handler(e);
    });
    return apiCall;
};

function makeAPICall(uri, reqBody) {
    let apiCall = new Promise((resolve) => {
        request({
            method: 'POST',
            uri: uri,
            json: true,
            jar: true,
            gzip: true,
            body: reqBody || {}
        }, function (error, response, body) {
            error = checkAPIerror(error, response, uri, reqBody, body);
            if (error) throw error;
            resolve(body.d === undefined ? body : body.d);
        });
    });
    return apiCall;
}

var APICallError = require('./error/APICallError'),
    TagDidNotRespondError = require('./error/TagDidNotRespondError'),
    DuplicateEthCmdError = require('./error/DuplicateEthCmdError'),
    TagManagerOfflineError = require('./error/TagManagerOfflineError'),
    OperationIncompleteError = require('./error/OperationIncompleteError'),
    RetryUnsuccessfulError = require('./error/RetryUnsuccessfulError'),
    OperationUnsupportedError = require('./error/OperationUnsupportedError');

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
