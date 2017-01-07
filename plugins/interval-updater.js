"use strict";

/** 
 * This is a TagUpdater plugin implementation that simply uses the {@link
 * WirelessTag#startUpdateLoop} and {@link WirelessTag#stopUpdateLoop}
 * methods, which auto-update a tag based on the update interval
 * configured for it.
 *
 * The main motivation is to have a module for using an interval-based
 * update method that uses the same API interface as others, and can
 * thus be swapped in.
 *
 * @module
 */

/**
 * Creates the updater instance.
 *
 * @constructor
 */
function TimedTagUpdater() {
    this.tagsByUUID = {};
}

/**
 * Adds the given tags to the ones to be updated by this updater. If
 * the update loop is already running (because
 * [startUpdateLoop()]{@link module:plugins/interval-updater~TimedTagUpdater#startUpdateLoop}
 * was called), the tag will start auto-updating.
 *
 * @param {(WirelessTag|WirelessTag[])} tags - the tags (or the tag) to
 *                                           be updated
 *
 * @return {module:plugins/interval-updater~TimedTagUpdater}
 */
TimedTagUpdater.prototype.addTags = function(tags) {
    if (!Array.isArray(tags)) tags = [tags];
    for (let tag of tags) {
        if (this._running) tag.startUpdateLoop();
        this.tagsByUUID[tag.uuid] = tag;
    }
    return this;
};

/**
 * Removes the given tags from the ones to be updated by this
 * updater. If the update loop is already running (because
 * [startUpdateLoop()]{@link module:plugins/interval-updater~TimedTagUpdater#startUpdateLoop}
 * was called), the tag will stop auto-updating.
 *
 * @param {(WirelessTag|WirelessTag[])} tags - the tags (or the tag) to
 *                                           be removed from updating
 *
 * @return {module:plugins/interval-updater~TimedTagUpdater}
 */
TimedTagUpdater.prototype.removeTags = function(tags) {
    if (tags && !Array.isArray(tags)) tags = [tags];
    for (let tag of tags) {
        if (this._running) tag.stopUpdateLoop();
        delete this.tagsByUUID[tag.uuid];
    }
    return this;
};

/**
 * Starts the continuous update loop. Registered tags will get updated
 * until they are removed, or [stopUpdateLoop()]{@link module:plugins/interval-updater~TimedTagUpdater#stopUpdateLoop}
 * is called.
 */
TimedTagUpdater.prototype.startUpdateLoop = function() {
    if (this._running) return this;
    this._running = true;
    for (let uuid in this.tagsByUUID) {
        this.tagsByUUID[uuid].startUpdateLoop();
    }
    return this;
};

/**
 * Stops the continuous update loop. Has no effect if an update loop
 * is not currently active.
 */
TimedTagUpdater.prototype.stopUpdateLoop = function() {
    if (this._running) {
        this._running = false;
        for (let uuid in this.tagsByUUID) {
            this.tagsByUUID[uuid].stopUpdateLoop();
        }
    }
    return this;
};

module.exports = TimedTagUpdater;
