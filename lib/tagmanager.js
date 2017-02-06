"use strict";

/** module */
module.exports = WirelessTagManager;

var request = require('request'),
    util = require('util'),
    EventEmitter = require('events'),
    u = require('./util'),
    WirelessTagPlatform = require('./platform'),
    WirelessTag = require('./tag');

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
    this.callAPI = WirelessTagPlatform.callAPI;
    u.setObjProperties(this, roMgrProps, rwMgrProps);
    this.data = data;
}
util.inherits(WirelessTagManager, EventEmitter);

WirelessTagManager.prototype.discoverTags = function(query, callback) {
    query = Object.assign({ "wirelessTagManager": {} }, query);
    query.wirelessTagManager.mac = this.mac;
    return this.wirelessTagPlatform.discoverTags(query, callback);
};

WirelessTagManager.prototype.select = function(callback) {
    return this.wirelessTagPlatform.selectTagManager(this, callback);
};
