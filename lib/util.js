"use strict";

var deepEqual = require('deep-equal'),
    EventEmitter = require('events'),
    retryPromised = require('promise-retry'),
    OperationIncompleteError = require('./error/OperationIncompleteError.js'),
    RetryUnsuccessfulError = require('./error/RetryUnsuccessfulError.js');

module.exports = TagUtils;

function TagUtils() {
    // nothing to do here for now, all methods are static
}

TagUtils.setObjProperties = function(obj, roProps, rwProps) {
    Object.defineProperty(obj, "_data", {
        value: {},
        writable: true
    });
    Object.defineProperty(obj, "data", {
        enumerable: true,
        get: function() { return obj._data; },
        set: function(data) {
            let oldData = obj._data;
            obj._data = data || {};
            if ((obj instanceof EventEmitter)
                && ! deepEqual(obj._data, oldData)) {
                obj.emit('_data', obj); // for obj-internal use
                obj.emit('data', obj);
            }
        }
    });
    var defineProp = (obj, prop, readOnly) => {
        let propName = prop;
        let dataKey = propName;
        if (Array.isArray(prop)) {
            propName = prop[0];
            dataKey = prop[1];
        }
        let descriptor = {
            enumerable: true,
            get: function() { return obj.data[dataKey]; },
        };
        if (! readOnly) {
            descriptor.set = function(val) {
                let oldVal = obj.data[dataKey];
                if (! deepEqual(val, oldVal)) {
                    obj.data[dataKey] = val;
                    if (obj instanceof EventEmitter) {
                        obj.emit('update', obj, propName, val);
                    }
                }
            };
        }
        Object.defineProperty(obj, propName, descriptor);
    };
    for (let prop of roProps) {
        defineProp(obj, prop, true);
    }
    for (let prop of rwProps) {
        defineProp(obj, prop, false);
    }
};

TagUtils.FILETIMEtoDate = function(filetime) {
    // Windows FILETIME is 100 nanosecond intervals since January 1, 1601 (UTC)
    // JavaScript Date time is milliseconds since January 1, 1970 (UTC)
    // Offset between the two epochs in milliseconds is 11644473600000
    return filetime / 10000 - 11644473600000;
};

TagUtils.round = function(number, precision) {
    var factor = Math.pow(10, precision);
    return Math.round(number * factor) / factor;
};

TagUtils.defaultHandler = function(callback) {
    return (callback && ('function' === typeof callback)) ?
        callback :
        function(err) {
            if (err) {
                console.error(err.stack ? err.stack : err);
                throw err;
            }
        }
    ;
};

TagUtils.createFilter = function(jsonQuery) {
    if (! jsonQuery) {
        return function(obj) {
            return true;
        };
    }
    if ('function' === typeof jsonQuery) return jsonQuery;
    return function(obj) {
        for(let key of Object.keys(jsonQuery)) {
            if (! Object.is(obj[key], jsonQuery[key])) return false;
        }
        return true;
    };
};

TagUtils.retryUntil = function(action, success, options) {
    return retryPromised((retry, attempt) => {
        options = options || {};
        if ('function' === typeof options.log) options.log(attempt);
        return action().then((result) => {
            if (success(result, attempt)) return result;
            throw new Error("should throw RetryUnsuccessfulError if failed");
        }).catch((e) => {
            if (e instanceof OperationIncompleteError) {
                return retry(e);
            }
            throw e;
        });
    }, options);
};