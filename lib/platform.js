"use strict";

/** @module */
module.exports = WirelessTagPlatform;

var request = require('request'),
    http = require('http'),
    util = require('util'),
    delay = require('timeout-as-promise'),
    EventEmitter = require('events');

var u = require('./util'),
    WirelessTagManager = require('./tagmanager');

/**
 * @const {string} - The default base URI for the JSON API server.
 * @default
 */
const API_BASE_URI = 'https://www.mytaglist.com';

/**
 * @const {number} - The time in milliseconds to wait before retrying an
 *                   operation that failed because the tag did not respond.
 * @default
 */
const WAIT_BEFORE_RETRY = 8000;

/**
 * Instantiates {@link WirelessTagPlatform}.
 *
 * @param {Object} [options]
 * @param {String} [options.log] - a custom log function.
 * @param {String} [options.errorHandler] - a function returning a custom
 *                       error handler, will be passed a callback function.
 * @param {String} [options.apiBaseURI] - the base URI of the API
 *                        server if hosted on a different server than
 *                        the default ([API_BASE_URI]{@link
 *                        module:lib/platform~API_BASE_URI})
 *
 * @class
 * @alias WirelessTagPlatform
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

/**
 * Connect event. Emitted after the platform object successfully
 * connects to the cloud.
 *
 * @event WirelessTagPlatform#connect
 * @type {WirelessTagPlatform}
 */
/**
 * Discover event. Emitted for every {@link WirelessTagManager}
 * instance discovered.
 *
 * @event WirelessTagPlatform#discover
 * @type {WirelessTagManager}
 */

/**
 * Connects to the cloud API if not connected already. Note that the
 * {@link WirelessTagPlatform#event:connect} event will not fire if
 * already connected.
 *
 * @param {Object} opts - connection parameters
 * @param {String} opts.username - the username (email) for connecting
 * @param {String} opts.password - the password for connecting
 * @param {module:wirelesstags~apiCallback} [callback]
 *
 * @fires WirelessTagPlatform#connect
 * @returns {Promise} resolves to 'this' upon success
 */
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

/**
 * Tests whether this instance is connected to the cloud API.
 *
 * @param {module:wirelesstags~apiCallback} [callback]
 *
 * @returns {Promise} resolves to true if connected, and false otherwise
 */
WirelessTagPlatform.prototype.isConnected = function(callback) {
    return this.callAPI('/ethAccount.asmx/IsSignedIn', {}, callback).
        then((res) => {
            if (callback) callback(null, { object: this, value: res });
            return res;
        });
};

/**
 * Retrieves the tag managers available to the connected account. The
 * list is optionally filtered depending on the supplied query
 * parameter.
 *
 * Note that using the 'query' parameter as opposed to filtering the
 * returned tag manager objects will really only be useful to prevent
 * 'discover' events from being fired for undesired tag manager
 * objects. The filtering does not happen at the API endpoint, and so
 * has almost no performance benefits, unless there are many tag
 * managers under the account and the 'discover' event listener were
 * somehow expensive to execute.
 *
 * @param {Object} [query] - an object with keys and values that a tag
 *                 manager data object returned by the API has to
 *                 meet. The most useful ones are likely 'name' and
 *                 'mac'. Consult the [GetTagManagers JSON API]{@link
 *                 http://wirelesstag.net/media/mytaglist.com/ethAccount.asmx@op=GetTagManagers.html}
 *                 for possible keys.
 * @param {module:wirelesstags~apiCallback} [callback]
 *
 * @fires WirelessTagPlatform#discover
 * @returns {Promise} resolves to an array of (optionally filtered)
 *                    {@link WirelessTagManager} instances
 */
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

/**
 * Selects the given tag manager for subsequent API calls that expect
 * it, if the tag manager is not already selected. Note that the
 * library will call this automatically, and so a user will not
 * normally need to do so.
 *
 * @param {WirelessTagManager} tagManager - the tag manager instance to select
 * @param {module:wirelesstags~apiCallback} [callback]
 *
 * @returns {Promise} resolves to the tag manager instance
 */
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

/**
 * Queries and/or sets whether failed API calls should be retried. By
 * default this is off.
 *
 * Note that failed calls are only retried under certain conditions,
 * and only for a certain number of times. At present, the condition
 * is that failure be due to the tag not responding, and the call is
 * retried only once, after waiting [WAIT_BEFORE_RETRY]{@link
 * module:lib/platform~WAIT_BEFORE_RETRY} milliseconds.
 *
 * @param {boolean} [enable] - on set, whether or not to enable retrying
 * @returns {boolean} whether or not retrying is currently enabled
 */
WirelessTagPlatform.prototype.retryOnError = function(enable) {
    if (enable !== undefined) this._retryAPICalls = enable;
    return this._retryAPICalls || false;
};

/**
 * Performs a call to the cloud JSON API. Users should not normally
 * need to call this method directly.
 *
 * Note that the method tries to infer necessary pre-steps based on
 * the value of 'this'. It is thus meant to be called as an instance
 * method, with this set to the instance in the library's class
 * hierarchy from where the call would be coming. For example,
 * tag-specific calls should have 'this' bound to a {@link
 * WirelessTag} instance.
 *
 * @param {string} uri - the uri for the API endpoint to be called;
 *                 will be prefixed with the base URI if not an
 *                 absolute URI.
 * @param {object} reqBody - the request body as an object
 * @param {module:wirelesstags~apiCallback} [callback] - note that
 *                 this method will only call this in the event of
 *                 error, and it is the caller's responsibility to
 *                 call it with the appropriately processed return
 *                 value in case of success.
 *
 * @returns {Promise} Resolves to the value of the 'd' property of the
 *                    response body from the API endpoint (or the body
 *                    itself if there is no 'd' property). Invokes
 *                    error handler function on error. The default
 *                    handler will rethrow the error, resulting in
 *                    rejecting the promise.
 */
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
