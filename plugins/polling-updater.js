"use strict";

/**
 * Uses a SOAP endpoint in the cloud API to continuously poll for
 * available updates.
 *
 * The SOAP endpoint (`/ethComet.asmx`) is undocumented, but is the
 * one used by the [client web application](http://wirelesstag.net/media/mytaglist.com/apidoc.html).
 * The difference to the client web application is that this
 * implementation uses a proper SOAP API interface (in contrast to
 * hand-building the XML to be transmitted, and to parsing the
 * returned XML with a regex), and that it calls a different method at
 * that endpoint.
 *
 * This updater should receive updates resulting from armed sensors
 * going below or above their configured thresholds, or detecting
 * motion. The one caveat is that there is a short wait time (see
 * [UPDATE_LOOP_WAIT]{@link module:plugins/polling-updater~UPDATE_LOOP_WAIT}),
 * and an exponentially increasing wait time after errors (see
 * [WAIT_AFTER_ERROR]{@link module:plugins/polling-updater~WAIT_AFTER_ERROR})
 * until the next poll is issued. Updates falling into this time
 * period will only be caught at the next regular update interval
 * configured for a tag.
 *
 * @module
 */

var request = require('request'),
    soap = require('soap');

/**
 * @const {string} - the path (relative to `API_BASE_URI`) of the WSDL
 *                   endpoint description for polling
 * @default
 */
const WSDL_URL_PATH = "/ethComet.asmx?WSDL";
/**
 * @const {string} - the base URI of the polling API endpoint
 * @default
 */
const API_BASE_URI = "https://www.mytaglist.com";
/**
 * @const {number} - the time to wait between subsequent calls of the
 *                   polling endpoint (in milliseconds)
 * @default
 */
const UPDATE_LOOP_WAIT = 10;
/**
 * @const {number} - the minimum time to wait between subsequent calls of the
 *                   polling endpoint after an error occurred (in milliseconds)
 * @default
 */
const WAIT_AFTER_ERROR = 1000;
/**
 * @const {number} - the maximum time to wait between subsequent calls of the
 *                   polling endpoint (in milliseconds)
 * @default
 */
const MAX_UPDATE_LOOP_WAIT = 30 * 60 * 1000;

/**
 * Creates the updater instance.
 *
 * @param {WirelessTagPlatform} [platform] - Platform object through
 *                              which tags to be updated were (or are
 *                              going to be) found. Used solely for
 *                              possibly overriding configuration
 *                              options, specifically the base URI for
 *                              the cloud API endpoints.
 * @param {object} [config] - overriding configuration options
 * @param {string} [config.wsdl_url] - the full path for obtaining the
 *                              WSDL for the SOAP service to be polled
 *                              (default: [WSDL_URL_PATH]{@link
 *                              module:plugins/polling-updater~WSDL_URL_PATH})
 * @param {string} [config.apiBaseURI] - the base URI to use for API
 *                              endpoints (default:
 *                              [API_BASE_URI]{@link
 *                              module:plugins/polling-updater~API_BASE_URI})
 *
 * @constructor
 */
function PollingTagUpdater(platform, config) {
    this.tagsByUUID = {};
    this.options = Object.assign({}, config);
    if (! this.options.wsdl_url) {
        let apiBaseURI;
        if (platform) apiBaseURI = platform.apiBaseURI;
        if (config && config.apiBaseURI) apiBaseURI = config.apiBaseURI;
        if (! apiBaseURI) apiBaseURI = API_BASE_URI;
        this.options.wsdl_url = apiBaseURI + WSDL_URL_PATH;
    }
}

/**
 * Adds the given tag object(s) to the ones to be updated by this updater.
 *
 * Adding the same (determined by identity) object again has no
 * effect. However, an object that represents the same tag as one
 * already added (i.e., has the same `uuid` property value) will be
 * registered for updates, too.
 *
 * @param {(WirelessTag|WirelessTag[])} tags - the tag object(s) to
 *                                           be updated
 *
 * @return {module:plugins/polling-updater~PollingTagUpdater}
 */
PollingTagUpdater.prototype.addTags = function(tags) {
    if (!Array.isArray(tags)) tags = [tags];
    for (let tag of tags) {
        if (this.tagsByUUID[tag.uuid]) {
            this.tagsByUUID[tag.uuid].add(tag);
        } else {
            this.tagsByUUID[tag.uuid] = new Set([tag]);
        }
    }
    return this;
};

/**
 * Removes the given tags from the ones to be updated by this updater.
 *
 * Note that only the given object(s) will be removed. Specifically,
 * other tag objects with the same `uuid` property value, if
 * previously added, remain registered.
 *
 * @param {(WirelessTag|WirelessTag[])} tags - the tag object(s) to
 *                                           be removed from updating
 *
 * @return {module:plugins/polling-updater~PollingTagUpdater}
 */
PollingTagUpdater.prototype.removeTags = function(tags) {
    if (tags && !Array.isArray(tags)) tags = [tags];
    for (let tag of tags) {
        if (this.tagsByUUID[tag.uuid]) {
            this.tagsByUUID[tag.uuid].delete(tag);
        }
    }
    return this;
};

/**
 * Starts the continuous update loop. Registered tags will get updated
 * until they are removed, or [stopUpdateLoop()]{@link module:plugins/polling-updater~PollingTagUpdater#stopUpdateLoop}
 * is called.
 *
 * Has no effect if a continuous update loop is already running.
 *
 * @param {number} [waitTime] - the time to wait until scheduling the
 *                 next update; defaults to [UPDATE_LOOP_WAIT]{@link
 *                 module:plugins/polling-updater~UPDATE_LOOP_WAIT}.
 * @param {module:wirelesstags~apiCallback} [callback] - result.value
 *                 will be array of tag data objects returned by the
 *                 polling API
 */
PollingTagUpdater.prototype.startUpdateLoop = function(waitTime, callback) {
    if ('function' === typeof waitTime) {
        callback = waitTime;
        waitTime = undefined;
    }
    if (waitTime === undefined) waitTime = UPDATE_LOOP_WAIT;
    if (waitTime > MAX_UPDATE_LOOP_WAIT) waitTime = MAX_UPDATE_LOOP_WAIT;

    if (this._updateTimer) return this._updateTimer;
    this._updateTimer = true; // placeholder to avoid race conditions

    let action = () => {
        this._updateTimer = true; // timer is done but action not yet
        this.apiClient().then((client) => {
            // if all tags are associated with a single tag manager,
            // limit updates to that tag manager
            let mgrs = this.uniqueTagManagers();
            return pollForNextUpdate(client,
                                     mgrs.length === 1 ? mgrs[0] : undefined,
                                     callback);
        }).then((tagDataList) => {
            tagDataList.forEach((tagData) => {
                if (this.tagsByUUID[tagData.uuid]) {
                    this.tagsByUUID[tagData.uuid].forEach((tag) => {
                        updateTag(tag, tagData);
                    });
                }
            });
            // reset wait time upon success
            waitTime = undefined;
        }).catch((err) => {
            console.error(err.stack ? err.stack : err);
            waitTime = waitTime < WAIT_AFTER_ERROR ?
                WAIT_AFTER_ERROR : waitTime * 2;
        }).then(() => {
            // with the preceding catch() this is in essence a finally()
            if (this._updateTimer) {
                this._updateTimer = null;
                this.startUpdateLoop(waitTime, callback);
            }
            // otherwise we have been cancelled while running the update
        });
    };
    // ensure that updates weren't cancelled since we entered here
    if (this._updateTimer === true) {
        this._updateTimer = setTimeout(action, waitTime);
    }
    return this._updateTimer;
};

/**
 * Stops the continuous update loop. Has no effect if an update loop
 * is not currently active.
 */
PollingTagUpdater.prototype.stopUpdateLoop = function() {
    let timer = this._updateTimer;
    this._updateTimer = null;   // avoid race conditions
    if (timer && timer !== true) {
        clearTimeout(timer);
    }
};

/**
 * If necessary creates, and otherwise obtains from cache the SOAP
 * client instance for the WSDL endpoint.
 *
 * @returns {Promise} Resolves to the SOAP client object.
 */
PollingTagUpdater.prototype.apiClient = function() {
    if (this._client) return Promise.resolve(this._client);
    return createSoapClient(this.options).then((client) => {
        this._client = client;
        return client;
    });
};

/**
 * Determines the list of tag managers with unique MACs used by the
 * tag objects registered with this updater, and returns it.
 *
 * @returns {WirelessTagManager[]}
 */
PollingTagUpdater.prototype.uniqueTagManagers = function() {
    let mgrs = Object.keys(this.tagsByUUID).map((uuid) => {
        let tags = Array.from(this.tagsByUUID[uuid]);
        return tags.length > 0 ? tags[0].wirelessTagManager : undefined;
    });
    let mgrByMAC = new Map();
    mgrs.forEach( (mgr) => mgrByMAC.set(mgr.mac, mgr) );
    return Array.from(mgrByMAC.values());
};

/**
 * Updates the tag corresponding to the given tag data. Does nothing
 * if the respective tag is undefined or null.
 *
 * @param {WirelessTag} tag - the tag object to be updated
 * @param {object} tagData - the data to update the tag object with;
 *                 this is normally returned from the API endpoint
 *
 * @private
 */
function updateTag(tag, tagData) {
    // if not a valid object for receiving updates, we are done
    if (! tag) return;
    // check that this is the current tag manager
    if (tagData.mac && (tag.wirelessTagManager.mac !== tagData.mac)) {
        throw new Error("expected tag " + tag.uuid
                        + " to be with tag manager " + tag.mac
                        + " but is reported to be with " + tagData.mac);
    }
    // we don't currently have anything more to do for the extra properties
    // identifying the tag manager, so simply get rid of them
    ['managerName','mac','dbid','mirrors'].forEach((k) => {
        delete tagData[k];
    });
    // almost done
    tag.data = tagData;
}

/**
 * Creates the SOAP client, using the supplied options for locating
 * the WSDL document for the endpoint.
 *
 * @param {object} [opts] - WSDL and SOAP endpoint options
 * @param {string} [opts.wsdl_url] - the URL from which to fetch the
 *                 WSDL document; defaults to the concatenation of
 *                 [API_BASE_URI]{@link
 *                 module:plugins/polling-updater~API_BASE_URI} and
 *                 [WSDL_URL_PATH]{@link
 *                 module:plugins/polling-updater~WSDL_URL_PATH}
 *
 * @returns {Promise} On success, resolves to the created SOAP client object
 * @private
 */
function createSoapClient(opts) {
    let wsdl = opts && opts.wsdl_url ?
        opts.wsdl_url : API_BASE_URI + WSDL_URL_PATH;
    let clientOpts = { request: request.defaults({ jar: true, gzip: true }) };
    return new Promise((resolve, reject) => {
        soap.createClient(wsdl, clientOpts, (err, client) => {
            if (err) return reject(err);
            resolve(client);
        });
    }); 
}

/**
 * Polls the API endpoint for available updates and returns them.
 *
 * @param {object} client - the SOAP client object
 * @param {WirelessTagManager} [tagManager] - the tag manager to which
 *                             to restrict updates
 * @param {module:wirelesstags~apiCallback} [callback] - if provided,
 *                             the `tagManager` parameter must be
 *                             provided too (even if as undefined or
 *                             null)
 *
 * @returns {Promise} On success, resolves to an array of tag data objects
 * @private
 */
function pollForNextUpdate(client, tagManager, callback) {
    let req = new Promise((resolve, reject) => {
        let methodName = tagManager ?
            "GetNextUpdateForAllManagersOnDB" :
            "GetNextUpdateForAllManagers";
        let soapMethod = client[methodName];
        let args = {};
        if (tagManager) args.dbid = tagManager.dbid;
        soapMethod(args, function(err, result) {
            if (err) return reject(err);
            let tagDataList = JSON.parse(result[methodName + "Result"]);
            try {
                if (callback) callback(null, { object: tagManager,
                                               value: tagDataList});
            }
            catch(err) {
                console.error("error in callback:");
                console.error(err.stack ? err.stack : err);
                // no good reason to escalate an error thrown by callback
            }
            resolve(tagDataList);
        });
    });
    if (callback) req = req.catch((err) => { callback(err); throw err; });
    return req;
}

module.exports = PollingTagUpdater;
