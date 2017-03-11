"use strict";

/** module */
module.exports = WirelessTagManager;

var util = require('util'),
    EventEmitter = require('events'),
    u = require('./util');

const roMgrProps = ["mac",
                    "radioId",
                    "rev",
                    "wirelessConfig",
                    "online",
                    "selected",
                    "dbid"];
const rwMgrProps = ["name"];

/**
 * The cloud instance of a Wireless Tag Manager. There can be multiple
 * Wireless Tag managers under one account. A user will not normally
 * need to create instances directly; instead they are found, and
 * created by {@link WirelessTagPlatform#discoverTagManagers}.
 *
 * @param {WirelessTagPlatform} platform - the platform instance that
 *                              discovered this tag manager
 * @param {Object} data - the object comprising the tag manager's
 *                        status properties, as returned by the API
 *                        endpoint.
 *
 * @class
 * @alias WirelessTagManager
 *
 * @property {string} mac - unique serial number (MAC) of the tag manager
 * @property {string} name
 * @property {string} radioId
 * @property {string} rev - hardware revision
 * @property {object} wirelessConfig
 * @property {boolean} online - true if the tag manager is online, and false otherwise
 * @property {boolean} selected - true if the tag manager is currently selected, and false otherwise
 * @property {number} dbid - a sequential number among the tag managers associated with an account
 */
function WirelessTagManager(platform, data) {
    EventEmitter.call(this);
    this.wirelessTagPlatform = platform;
    this.errorHandler = platform ? platform.errorHandler : u.defaultHandler;
    this.callAPI = platform ? platform.callAPI : undefined;
    u.setObjProperties(this, roMgrProps, rwMgrProps);
    this.data = data;
}
util.inherits(WirelessTagManager, EventEmitter);

/**
 * Discover event. Emitted for every {@link WirelessTag} instance discovered.
 *
 * @event WirelessTagManager#discover
 * @type {WirelessTag}
 */
/**
 * Data event. Emitted whenever the properties data for an instance changes.
 *
 * @event WirelessTagManager#data
 * @type {WirelessTagManager}
 */

/**
 * Retrieves the tags associated with this tag managaer and available
 * to the connected account. The list is optionally filtered depending
 * on the supplied query parameter.
 *
 * @param {Object} [query] - an object with keys and values that a tag
 *                 data object returned by the API has to meet. The
 *                 most useful ones are likely `name` and
 *                 `uuid`. Consult the [GetTagForSlaveId JSON API]{@link http://wirelesstag.net/media/mytaglist.com/ethClient.asmx@op=GetTagForSlaveId.html}
 *                 for possible keys.
 * @param {module:wirelesstags~apiCallback} [callback] - if provided,
 *                `query` must be provided too, even if as value undefined.
 *
 * @fires WirelessTagManager#discover
 * @returns {Promise} Resolves to an array of {@link WirelessTag} instances.
 */
WirelessTagManager.prototype.discoverTags = function(query, callback) {
    query = Object.assign({ "wirelessTagManager": {} }, query);
    query.wirelessTagManager.mac = this.mac;
    return this.wirelessTagPlatform.discoverTags(query, callback);
};

/**
 * Selects this tag manager for subsequent API calls that expect it,
 * if this tag manager is not already selected.
 *
 * Note that the library will call this automatically, and so a user
 * will not normally need to do so.
 *
 * @param {module:wirelesstags~apiCallback} [callback]
 *
 * @returns {Promise} resolves to the tag manager instance
 */
WirelessTagManager.prototype.select = function(callback) {
    return this.wirelessTagPlatform.selectTagManager(this, callback);
};

/**
 * Finds the tag associated with this tag manager and identified by the
 * given 'slaveId'.
 *
 * @param {number} slaveId - the sequential ID of the tag to be found
 * @param {module:wirelesstags~apiCallback} [callback]
 *
 * @returns {Promise} resolves to the tag object if successful, and otherwise
 *      rejects with an [InvalidOperationError]{@link WirelessTagPlatform.InvalidOperationError}
 * @since 0.6.2
 */
WirelessTagManager.prototype.findTagById = function(slaveId, callback) {
    let factory = this.wirelessTagPlatform.factory;
    let tag = factory.createTag(this, { slaveId: slaveId });
    return tag.update(callback);
};
