"use strict";

module.exports = WirelessTagManager;

var request = require('request'),
    util = require('util'),
    EventEmitter = require('events'),
    u = require('./util.js'),
    WirelessTagPlatform = require('./platform.js'),
    WirelessTag = require('./tag.js');

const roMgrProps = ["mac","radioId","rev","wirelessConfig","online","selected"];
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
    var filter = u.createFilter(query);

    if (callback) {
        callback = (error, result) => {
            if (error) return callback(error);
            result = result.filter((elem) => {
                return elem.mac == this.mac;
            });
            if (result.length === 0) {
                return callback(new Error("No results for Tag Manager " +
                                          this.mac));
            }
            callback(error, result[0].tags);
        };
    }

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
                throw new Error(result.length + " result(s) for Tag Manager " + this.mac);
            }
            var tagsList = result[0].tags.filter(filter);
            this.wirelessTags = [];
            this.wirelessTagMap = {};
            for (let tagData of tagsList) {
                let tag = new WirelessTag(this, tagData);
                // console.log(tagData);
                this.wirelessTags.push(tag);
                this.wirelessTagMap[tag.uuid] = tag;
                this.emit('discover', tag);
                tag.discoverSensors().catch((e) => { this.errorHandler()(e); });
            }
        },
        this.errorHandler(callback)
    );
};

WirelessTagManager.prototype.select = function(callback) {
    return this.wirelessTagPlatform.selectTagManager(this);
};
