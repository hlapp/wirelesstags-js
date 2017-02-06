"use strict";

/** @module */
module.exports = WirelessTagPlatform;

var request = require('request'),
    http = require('http'),
    util = require('util'),
    delay = require('timeout-as-promise'),
    EventEmitter = require('events');

var u = require('./util'),
    WirelessTagManager = require('./tagmanager'),
    WirelessTag = require('./tag');

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
 * @param {function} [options.errorHandler] - a function returning a custom
 *                       error handler, will be passed a callback function.
 * @param {String} [options.apiBaseURI] - the base URI of the API
 *                       server if hosted on a different server than
 *                       the default ([API_BASE_URI]{@link
 *                       module:lib/platform~API_BASE_URI})
 * @param {Object} [options.factory] - a factory for tag and tag manager
 *                       objects, see {@link WirelessTagPlatform.factory}
 *                       which will be used by default
 *
 * @class
 * @alias WirelessTagPlatform
 */
function WirelessTagPlatform(options) {
    EventEmitter.call(this);
    if (options === undefined) options = {};
    this.log = options.log || console.log;
    this.errorHandler = options.errorHandler || u.defaultHandler;
    /** @member {string} - see default ([API_BASE_URI]{@link module:lib/platform~API_BASE_URI}) */
    this.apiBaseURI = options.apiBaseURI || API_BASE_URI;
    /** @member {function} - see {@link WirelessTagPlatform.callAPI} */
    this.callAPI = WirelessTagPlatform.callAPI;
    this._tagManagersByMAC = new Map();
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
 * @param {module:wirelesstags~apiCallback} [callback] - if provided,
 *                `query` must be provided too, even if as value undefined.
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
            let knownMgrs = new Map(this._tagManagersByMAC);
            let tagManagers = [];
            result = result.filter(u.createFilter(query));
            for (let mgrData of result) {
                let tagManager = knownMgrs.get(mgrData.mac);
                if (tagManager) {
                    tagManager.data = mgrData;
                } else {
                    tagManager = new WirelessTagManager(this, mgrData);
                    this.emit('discover', tagManager);
                }
                tagManagers.push(tagManager);
            }
            // repopulate map of tag managers from scratch unless we were
            // asked to filter
            if ((! query) || (Object.keys(query).length === 0)) {
                this._tagManagersByMAC.clear();
            }
            tagManagers.forEach((m) => {
                this._tagManagersByMAC.set(m.mac, m);
            });
            if (callback) callback(null, { object: this, value: tagManagers });
            return tagManagers;
        },
        this.errorHandler(callback)
    );
};

/**
 * Retrieves the tag manager with the given MAC identifier. If the
 * matching object is cached from an earlier call to this or the
 * {@link WirelessTagPlatform#discoverTagManagers} method, the cached
 * object is returned. Otherwise the matching object, if one is
 * available and accessible to the logged-in account, is retrieved
 * from the cloud.
 *
 * Note that the [discover event]{@link WirelessTagPlatform#event:discover}
 * is only fired if the tag manager wasn't cached yet.
 *
 * @param {string} mac - the MAC identifier for the tag manager
 * @param {module:wirelesstags~apiCallback} [callback]
 *
 * @fires WirelessTagPlatform#discover
 * @returns {Promise} resolves to the matching {@link WirelessTagManager}
 *                    instance if one is accessible to the logged-in account,
 *                    and to undefined otherwise.
 */
WirelessTagPlatform.prototype.findTagManager = function(mac, callback) {
    let mgr = this.getTagManager(mac);
    if (mgr) {
        if (callback) callback(null, { object: this, value: mgr });
        return Promise.resolve(mgr);
    }
    let ecb = (err) => { if (err) return callback(err); };
    return this.discoverTagManagers({ mac: mac }, ecb).then((mgrs) => {
        if (callback) callback(null, { object: this, value: mgrs[0] });
        return mgrs[0];
    });
};

/**
 * Retrieves the tag manager object with the given MAC identifier from
 * the cache.
 *
 * Note that this method will _not_ consult an API endpoint if the
 * object is not yet cached. Hence, no 'discover' event will be fired.
 *
 * @param {string} mac - the MAC identifier for the tag manager
 *
 * @returns {WirelessTagManager} the matching {@link WirelessTagManager}
 *                    instance if one is cached, and undefined otherwise.
 */
WirelessTagPlatform.prototype.getTagManager = function(mac) {
    return this._tagManagersByMAC.get(mac);
};

/**
 * Retrieves the tags available to the connected account. The list is
 * optionally filtered depending on the supplied query parameter.
 *
 * This method offers an alternative discovery path compared to
 * discovering tag manager objects first (through {@link
 * WirelessTagPlatform#discoverTagManagers}), and then for each one
 * finding its associated tags. In the case of multiple tag managers
 * this method will be more efficient, because the respective Web
 * Service API endpoints do not support filtering results server-side
 * anyway.
 *
 * Note that tag manager objects newly created as a side effect will
 * generate ['discover']{@link WirelessTagPlatform#event:discover} events,
 * and the tag manager objects will in turn fire ['discover']{@link WirelessTagManager#event:discover}
 * events for each of their associated tags.
 *
 * @param {Object} [query] - an object with keys and values that a tag
 *                 data object returned by the API has to meet. The
 *                 most useful ones are likely `name` and
 *                 `uuid`. Consult the [GetTagForSlaveId JSON API]{@link http://wirelesstag.net/media/mytaglist.com/ethClient.asmx@op=GetTagForSlaveId.html}
 *                 for possible keys. The special key `wirelessTagManager`
 *                 can be used to add a query object for tag managers
 *                 (see {@link WirelessTagPlatform#discoverTagManagers}).
 * @param {module:wirelesstags~apiCallback} [callback] - if provided,
 *                `query` must be provided too, even if as value undefined.
 *
 * @fires WirelessTagPlatform#discover
 * @returns {Promise} resolves to an array of {@link WirelessTag}
 *                    instances associated with tag managers
 *                    accessible to the logged-in account.
 */
WirelessTagPlatform.prototype.discoverTags = function(query, callback) {

    // we will need all matching tag manager objects anyway, so request an
    // up-to-date cache of those upfront, possibly filtering if requested
    query = Object.assign({}, query);   // copy so we can manipulate keys
    let mgrFilter = u.createFilter(query.wirelessTagManager);
    let ecb = (err) => { if (err) return callback(err); };
    let req = this.discoverTagManagers(mgrFilter, ecb);
    delete query.wirelessTagManager;    // ensure this doesn't interfere below 

    // only then make the actual API call for discovering tags
    req = req.then(() => {
        return this.callAPI(
            '/ethClient.asmx/GetTagManagerTagList',
            {},
            callback);
    });
    return req.then(
        (result) => {
            let filter = u.createFilter(query);
            let tagObjs = [];
            for (let rec of result) {
                let mgr = this.getTagManager(rec.mac);

                // skip this record if tag managers are filtered and
                // it doesn't pass the filter
                if (! mgrFilter(mgr || rec)) continue;

                // if record passes tag manager filter, the object is required
                if (! mgr) {
                    let e =  new Error("Tag manager "+ mgr.mac +" not found");
                    if (callback) callback(e);
                    throw e;  // if no callback, or the callback didn't throw
                }

                // create and populate tag objects
                let tagsList = rec.tags.filter(filter);
                for (let tagData of tagsList) {
                    let tag = new WirelessTag(mgr, tagData);
                    // console.log(tagData);
                    tagObjs.push(tag);
                    mgr.emit('discover', tag);
                }
            }
            if (callback) callback(null, { object: this, value: tagObjs });
            return tagObjs;
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
    let apiCall = new Promise((resolve, reject) => {
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
    return apiCall;
}

var APICallError = require('./error/APICallError'),
    TagDidNotRespondError = require('./error/TagDidNotRespondError');

/** Generic error calling cloud API. */
WirelessTagPlatform.APICallError = APICallError;
/** Error calling cloud API because tag needed to but did not respond. */
WirelessTagPlatform.TagDidNotRespondError = TagDidNotRespondError;
/** Error calling cloud API because the same command was sent again before a response to the first. */
WirelessTagPlatform.DuplicateEthCmdError = require('./error/DuplicateEthCmdError');
/** Error calling cloud API because the tag manager is offline. */
WirelessTagPlatform.TagManagerOfflineError = require('./error/TagManagerOfflineError');
/** Error calling cloud API because the tag manager needed to respond but timed out */
WirelessTagPlatform.TagManagerTimedOutError = require('./error/TagManagerTimedOutError');
/** Error calling cloud API because logged in user is not authorized. */
WirelessTagPlatform.UnauthorizedAccessError = require('./error/UnauthorizedAccessError');
/** Thrown if the attempted cloud API call is not supported for the object for which it was made. */
WirelessTagPlatform.OperationUnsupportedError = require('./error/OperationUnsupportedError');
/**
 * The cloud API call failed to complete. Typically this means the API
 * call itself succeeded, but the object's attributes failed to update
 * to reflect the state change.
 */
WirelessTagPlatform.OperationIncompleteError = require('./error/OperationIncompleteError');
/**
 * Thrown if trying to complete or retry a previously incomplete or
 * failed operation fails.
 */
WirelessTagPlatform.RetryUnsuccessfulError = require('./error/RetryUnsuccessfulError');

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
