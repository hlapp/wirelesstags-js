"use strict";

/**
 * Uses a SOAP endpoint in the cloud API to continuously poll for
 * available updates.
 *
 * The SOAP endpoint (`/ethComet.asmx`) is undocumented, but is the
 * one used by the [client web application](http://wirelesstag.net/media/mytaglist.com/apidoc.html).
 * The difference is that this implementation uses a proper SOAP API
 * interface (in contrast to hand-building the XML to be transmitted,
 * and to parsing the returned XML with a regex), and that it calls a
 * different method at that endpoint.
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
const UPDATE_LOOP_WAIT = 20;
/**
 * @const {number} - the minimum time to wait between subsequent calls of the
 *                   polling endpoint after an error occurred (in milliseconds)
 * @default
 */
const WAIT_AFTER_ERROR = 1000;

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
 * Adds the given tags to the ones to be updated by this updater.
 *
 * @param {(WirelessTag|WirelessTag[])} tags - the tags (or the tag) to
 *                                           be updated
 *
 * @return {module:plugins/polling-updater~PollingTagUpdater}
 */
PollingTagUpdater.prototype.addTags = function(tags) {
    if (!Array.isArray(tags)) tags = [tags];
    for (let tag of tags) {
        this.tagsByUUID[tag.uuid] = tag;
    }
    return this;
};

/**
 * Removes the given tags from the ones to be updated by this updater.
 *
 * @param {(WirelessTag|WirelessTag[])} tags - the tags (or the tag) to
 *                                           be removed from updating
 *
 * @return {module:plugins/polling-updater~PollingTagUpdater}
 */
PollingTagUpdater.prototype.removeTags = function(tags) {
    if (tags && !Array.isArray(tags)) tags = [tags];
    for (let tag of tags) {
        delete this.tagsByUUID[tag.uuid];
    }
    return this;
};

/**
 * Starts the continuous update loop. Registered tags will get updated
 * until they are removed, or [stopUpdateLoop()]{@link module:plugins/polling-updater~PollingTagUpdater#stopUpdateLoop}
 * is called.
 *
 * @param {number} [waitTime] - the time to wait until scheduling the
 *                 next update; defaults to [UPDATE_LOOP_WAIT]{@link
 *                 module:plugins/polling-updater~UPDATE_LOOP_WAIT}.
 */
PollingTagUpdater.prototype.startUpdateLoop = function(waitTime) {
    if (waitTime === undefined) waitTime = UPDATE_LOOP_WAIT;
    if (this._updateTimer) return this._updateTimer;
    this._updateTimer = true; // placeholder to avoid race conditions
    let action = () => {
        this._updateTimer = true; // timer is done but action not yet
        this.apiClient().then((client) => {
            return pollForNextUpdate(client);
        }).then((tagDataList) => {
            tagDataList.forEach((tagData) => {
                updateTag(this.tagsByUUID[tagData.uuid], tagData);
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
                this.startUpdateLoop(waitTime);
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
    if (this.client) return Promise.resolve(this.client);
    return createSoapClient(this.options).then((client) => {
        this.client = client;
        return client;
    });
};

/**
 * Updates the tag corresponding to the given tag data. Does nothing
 * if the respective tag is undefined or null.
 *
 * @param {WirelessTag} tag - the tag object to be updated
 * @param {object} tagData - the data to update the tag object with;
 *                 this is normally returned from the API endpoint
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
 *                             to restrict updates (this is currently ignored)
 *
 * @returns {Promise} On success, resolves to an array of tag data objects
 */
function pollForNextUpdate(client, tagManager) {
    return new Promise((resolve, reject) => {
        let methodName = tagManager ?
            "GetNextUpdateForAllManagersOnDB" :
            "GetNextUpdateForAllManagers";
        let soapMethod = client[methodName];
        let args = {};
        if (tagManager) args.dbid = tagManager.dbid;
        soapMethod(args, function(err, result) {
            if (err) return reject(err);
            let tagDataList = JSON.parse(result[methodName + "Result"]);
            resolve(tagDataList);
        });
    });
}

module.exports = PollingTagUpdater;
