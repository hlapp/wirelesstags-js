"use strict";

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

/*
 * The cloud instance of a Wireless Tag Manager. There can be
 * multiple Wireless Tag managers under one account.
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
