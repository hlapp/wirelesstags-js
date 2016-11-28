"use strict";

var request = require('request');

module.exports.FILETIMEtoDate = FILETIMEtoDate;
module.exports.roundPrec = roundPrec;
module.exports.createFilter = createFilter;
module.exports.defaultHandler = defaultHandler;
module.exports.setObjProperties = setObjProperties;

function setObjProperties(obj, roProps, rwProps) {
    Object.defineProperty(obj, "_data", {
        value: {},
        writable: true
    });
    Object.defineProperty(obj, "data", {
        enumerable: true,
        get: function() { return obj._data; },
        set: function(data) {
            obj._data = data || {};
            if (data && (Object.keys(data).length > 0)) {
                obj.emit('data', obj);
            }
        }
    });
    for (let prop of roProps) {
        Object.defineProperty(obj, prop, {
            enumerable: true,
            get: function() { return obj.data[prop]; }
        });
    }
    for (let prop of rwProps) {
        Object.defineProperty(obj, prop, {
            enumerable: true,
            get: function() { return obj.data[prop]; },
            set: function(val) {
                obj.data[prop] = val;
                obj.emit('update', obj, prop, val);
            }
        });
    }
}

function FILETIMEtoDate(filetime) {
    // Windows FILETIME is 100 nanosecond intervals since January 1, 1601 (UTC)
    // JavaScript Date time is milliseconds since January 1, 1970 (UTC)
    // Offset between the two epochs in milliseconds is 11644473600000
    return filetime / 10000 - 11644473600000;
}

function roundPrec (number, precision) {
    var factor = Math.pow(10, precision);
    return Math.round(number * factor) / factor;
};

function defaultHandler(callback) {
    return (callback && ('function' === typeof callback)) ?
        callback :
        function(err) {
            if (err) {
                console.error(err.stack ? err.stack : err);
                throw err;
            }
        }
    ;
}

function createFilter(jsonQuery) {
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
    }
}

