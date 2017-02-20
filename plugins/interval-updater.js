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
 * Adding the same (determined by identity) object again has no
 * effect. However, an object that represents the same tag as one
 * already added (i.e., has the same `uuid` property value) will be
 * registered for updates, too.
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
        if (this.tagsByUUID[tag.uuid]) {
            this.tagsByUUID[tag.uuid].add(tag);
        } else {
            this.tagsByUUID[tag.uuid] = new Set([tag]);
        }
    }
    return this;
};

/**
 * Removes the given tag object(s) from the ones to be updated by this
 * updater. If the update loop is already running (because
 * [startUpdateLoop()]{@link module:plugins/interval-updater~TimedTagUpdater#startUpdateLoop}
 * was called) and a tag object was previously registered, it will
 * stop auto-updating.
 *
 * Note that only the given object(s) will be removed. Specifically,
 * other tag objects with the same `uuid` property value, if
 * previously added, remain registered.
 *
 * @param {(WirelessTag|WirelessTag[])} tags - the tag object(s) to
 *                                           be removed from updating
 *
 * @return {module:plugins/interval-updater~TimedTagUpdater}
 */
TimedTagUpdater.prototype.removeTags = function(tags) {
    if (tags && !Array.isArray(tags)) tags = [tags];
    for (let tag of tags) {
        let tagSet = this.tagsByUUID[tag.uuid];
        if (tagSet) {
            if (tagSet.has(tag) && this._running) tag.stopUpdateLoop();
            tagSet.delete(tag);
        }
    }
    return this;
};

/**
 * Starts the continuous update loop. Registered tags will get updated
 * until they are removed, or [stopUpdateLoop()]{@link module:plugins/interval-updater~TimedTagUpdater#stopUpdateLoop}
 * is called.
 *
 * Has no effect if a continuous update loop is already running.
 */
TimedTagUpdater.prototype.startUpdateLoop = function() {
    if (this._running) return this;
    this._running = true;
    Object.keys(this.tagsByUUID).forEach((uuid) => {
        this.tagsByUUID[uuid].forEach((tag) => tag.startUpdateLoop());
    });
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
            this.tagsByUUID[uuid].forEach((tag) => tag.stopUpdateLoop());
        }
    }
    return this;
};

module.exports = TimedTagUpdater;
