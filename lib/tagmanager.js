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
    this.wirelessTags = [];
    this.wirelessTagMap = {};
    this.errorHandler = platform ? platform.errorHandler : u.defaultHandler;
    this.callAPI = WirelessTagPlatform.callAPI;
    u.setObjProperties(this, roMgrProps, rwMgrProps);
    this.data = data;
}
util.inherits(WirelessTagManager, EventEmitter);

WirelessTagManager.prototype.discoverTags = function(query, callback) {

    var req = this.callAPI(
        '/ethClient.asmx/GetTagManagerTagList',
        {},
        callback);
    return req.then(
        (result) => {
            result = result.filter((elem) => {
                return elem.mac == this.mac;
            });
            if (result.length != 1) {
                let e =  new Error(result.length
                                   + " result(s) for tag manager " + this.mac);
                if (callback) callback(e);
                throw e;  // if no callback, or the callback didn't throw
            }
            let tagsList = result[0].tags.filter(u.createFilter(query));
            this.wirelessTags = [];
            this.wirelessTagMap = {};
            for (let tagData of tagsList) {
                let tag = new WirelessTag(this, tagData);
                // console.log(tagData);
                this.wirelessTags.push(tag);
                this.wirelessTagMap[tag.uuid] = tag;
                this.emit('discover', tag);
            }
            if (callback) callback(null,
                                   { object: this, value: this.wirelessTags });
            return this.wirelessTags;
        },
        this.errorHandler(callback)
    );
};

WirelessTagManager.prototype.select = function(callback) {
    return this.wirelessTagPlatform.selectTagManager(this, callback);
};
