"use strict";

var request = require('request');

module.exports.doAPIrequest = doAPIrequest;
module.exports.roundPrec = roundPrec;
module.exports.createFilter = createFilter;
module.exports.defaultHandler = defaultHandler;
module.exports.setObjProperties = setObjProperties;

const BASE_URI = 'https://www.mytaglist.com';

function doAPIrequest(uri, method, reqBody, callback) {
    if (! (uri.startsWith('https://') || uri.startsWith('http://'))) {
        uri = BASE_URI + uri;
    }
    var apiCall = new Promise((resolve,reject) => {
        request({
            method: method,
            uri: uri,
            json: true,
            jar: true,
            gzip: true,
            body: reqBody || {}
        }, function (error, response, body) {
            error = checkAPIerror(error, response, uri, reqBody, body);
            if (error) return reject(error);
            resolve(body.d === undefined ? body : body.d);
        });
    });
    if (callback) {
        return apiCall.then(result => { callback(null,result) },
                            error => { callback(error) });
    }
    return apiCall;
}

function checkAPIerror(error, response, uri, reqBody, body) {
    if (error) return error;
    if (! response) return new Error("undefined response for URI " + uri);
    if (response.statusCode != 200) {
        let error = new Error(
            "Calling " + uri
                + (reqBody ? " with body " + JSON.stringify(reqBody) : "")
                + " failed with status " + response.statusCode);
        error.name = http.STATUS_CODES[response.statusCode];
        if (body) {
            if (body.ExceptionType) error.name = body.ExceptionType;
            if (body.Message) error += "\n" + body.Message;
        }
        return error;
    }
    return null;
}

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

function roundPrec (number, precision) {
    var factor = Math.pow(10, precision);
    return Math.round(number * factor) / factor;
};

function defaultHandler(callback) {
    return (callback && ('function' === typeof callback)) ?
        callback :
        function(err) {
            if (err) console.error(err.stack ? err.stack : err);
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

