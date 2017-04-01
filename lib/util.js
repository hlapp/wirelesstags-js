"use strict";

var deepEqual = require('deep-equal'),
    EventEmitter = require('events'),
    retryPromised = require('promise-retry'),
    OperationIncompleteError = require('./error/OperationIncompleteError.js');

/** @module lib/util */

module.exports = {
    defineLinkedPropertiesFromMap: defineLinkedPropertiesFromMap,
    defineLinkedProperty: defineLinkedProperty,
    defineOnChangeProperty: defineOnChangeProperty,
    FILETIMEtoDate: FILETIMEtoDate,
    round: round,
    defaultHandler: defaultHandler,
    createFilter: createFilter,
    retryUntil: retryUntil
};

/**
 * Defines a property with the given name for the given object using a
 * getter/setter combination. If the objset is an event emitter, the
 * object will emit an event of the given name if a property set changes
 * the value of the property.
 *
 * @param {object} obj - the object for which to define the property
 * @param {string} [propName] - the name of the property, defaults to 'data'
 * @param {event} [event] - the name of the event to emit, defaults to 'data'
 * @memberof module:lib/util
 * @since 0.7.0
 */
function defineOnChangeProperty(obj, propName, event) {
    if (!propName) propName = 'data';
    if (!event) event = 'data';
    let _prop = '_' + propName;
    Object.defineProperty(obj, _prop, {
        value: {},
        writable: true
    });
    Object.defineProperty(obj, propName, {
        enumerable: true,
        get: function() { return obj[_prop] },
        set: function(data) {
            let oldData = obj[_prop];
            obj[_prop] = data || {};
            if ((obj instanceof EventEmitter)
                && ! deepEqual(obj[_prop], oldData)) {
                obj.emit('_' + event, obj); // for obj-internal use
                obj.emit(event, obj);
            }
        }
    });
}

/**
 * Defines a property on the given object whose value will be linked to that
 * of the property of another object. If the object is an event emitter, a
 * property set that changes the value will emit an 'update' event for the
 * object with 3 parameters, the object, the name of the property, and the
 * new value.
 *
 * @param {object} obj - the object for which to define the property
 * @param {string|string[]} prop - the name of the property to define, or
 *                an array of two elements, namely the name of the property
 *                to define, and the name of the property to link to
 * @param {string} [srcProp] - the name of the property that stores the
 *                source object (from which values will be linked). Default
 *                is 'data'.
 * @param {boolean} [readOnly] - whether the property is to be read-only,
 *                defaults to `false`.
 * @memberof module:lib/util
 * @since 0.7.0
 */
function defineLinkedProperty(obj, prop, srcProp, readOnly) {
    let propName, srcKey;
    if (Array.isArray(prop)) {
        propName = prop[0];
        srcKey = prop[1];
    } else {
        propName = srcKey = prop;
    }
    if (typeof srcProp === 'boolean') {
        readOnly = srcProp;
        srcProp = undefined;
    }
    if (! srcProp) srcProp = 'data';
    let descriptor = {
        enumerable: true,
        get: function() { return obj[srcProp][srcKey] }
    };
    if (! readOnly) {
        descriptor.set = function(val) {
            let oldVal = obj[srcProp][srcKey];
            if (! deepEqual(val, oldVal)) {
                obj[srcProp][srcKey] = val;
                if (obj instanceof EventEmitter) {
                    obj.emit('update', obj, propName, val);
                }
            }
        };
    }
    Object.defineProperty(obj, propName, descriptor);
}

/**
 * Defines properties on the given object according to property
 * specifications found in a map. If a property specification defines
 * setter behavior, the object is an event emitter, and a property set
 * changes the value, the object will emit an 'update' event, with 4
 * parameters: the object, the name of the property, the new value, and the
 * previous value.
 *
 * @param {object} obj - the object on which to define the properties
 * @param {object} propMapDict - a dictionary of property specification maps.
 *      A property specification map is keyed by the names of the properties
 *      to define. The value (the property specification) is an array. Its
 *      first element is the name of the property in another object (see
 *      `srcProp`) from which to derive the value, or undefined if there is
 *      no simple source property. The second element is a transform function
 *      to apply for the getter, which is passed the source property value
 *      (if the first element gives a source property). The third element
 *      is the same for the setter. If getter or setter transforms are
 *      undefined, the property will not have a getter or setter,
 *      respectively.
 * @param {string} dictKey - the key to the dictionary under which the property
 *      specification map is found. If the specification map is a string, it
 *      will be used recursively to look up the specification map.
 * @param {string} [srcProp] - the name of the property storing the object from
 *      which property values will be linked. Default is 'data'.
 * @memberof module:lib/util
 * @since 0.7.0
 */
function defineLinkedPropertiesFromMap(obj, propMapDict, dictKey, srcProp) {
    let propMap = propMapDict[dictKey];
    // key aliased to another entry?
    if ('string' === typeof propMap) propMap = propMapDict[propMap];
    if (! srcProp) srcProp = 'data';
    for (let propName in propMap) {
        let propSpec = propMap[propName];
        let dataKey = propSpec[0];
        let transform = propSpec[1] ? propSpec[1].bind(obj) : undefined;
        let revTransform = propSpec[2] ? propSpec[2].bind(obj) : undefined;
        let descriptor = {
            enumerable: true,
            configurable: true
        };
        if (transform !== undefined) {
            /* jshint loopfunc: true */
            // this works because every variable used is declared with let
            descriptor.get = () => {
                if (dataKey === undefined) {
                    return transform();
                }
                return transform(obj[srcProp][dataKey]);
            };
            /* jshint loopfunc: false */
        }
        if (revTransform !== undefined) {
            /* jshint loopfunc: true */
            // this works because every variable used is declared with let
            descriptor.set = (newValue) => {
                let val = revTransform(newValue);
                if (dataKey !== undefined) obj[srcProp][dataKey] = val;
                if ('function' === typeof obj.markModified) {
                    obj.markModified(propName);
                    if (dataKey !== undefined) obj.markModified(dataKey);
                }
                if (obj instanceof EventEmitter) {
                    obj.emit('update', obj, propName, newValue, val);
                }
            };
            /* jshint loopfunc: false */
        }
        Object.defineProperty(obj, propName, descriptor);
    }
}

/**
 * Converts from Windows FILETIME (100 nanosecond intervals since
 * January 1, 1601 (UTC)) to JavaScript Date (milliseconds since
 * January 1, 1970 (UTC)).
 *
 * @param {number} filetime - the Windows FILETIME value to convert
 * @returns {number} the corresponding milliseconds since the epoch
 * @memberof module:lib/util
 */
function FILETIMEtoDate(filetime) {
    // Windows FILETIME is 100 nanosecond intervals since January 1, 1601 (UTC)
    // JavaScript Date time is milliseconds since January 1, 1970 (UTC)
    // Offset between the two epochs in milliseconds is 11644473600000
    return filetime / 10000 - 11644473600000;
}

/**
 * Similar to `Math.round()` but rounds to given precision of decimal places.
 * @param {number} number - the number to round
 * @param {number} precision - the precision to round to in decimal places
 * @memberof module:lib/util
 */
function round(number, precision) {
    var factor = Math.pow(10, precision);
    return Math.round(number * factor) / factor;
}

/**
 * Creates a default error handler function and returns it.
 *
 * @param {function} [callback] - possibly existing callback
 * @returns {function} the `callback` parameter if it is a function, and
 *       otherwise a function that treats its first argument as an error
 *       object and throws it if it is defined.
 * @memberof module:lib/util
 */
function defaultHandler(callback) {
    return (callback && ('function' === typeof callback)) ?
        callback :
        function(err) {
            if (err) throw err;
        }
    ;
}

/**
 * Turns the given JSON object into a filter function.
 *
 * @param {object} [jsonQuery] - An object specifying properties and values
 *           that an object has to match in order to pass the filter. If
 *           omitted, or if the object has no keys, any object will pass the
 *           generated filter.
 * @returns {function} the generated filter function, accepts an object as
 *           argument and returns true if it passes the filter and false
 *           otherwise.
 * @memberof module:lib/util
 */
function createFilter(jsonQuery) {
    if ('function' === typeof jsonQuery) return jsonQuery;
    if ((!jsonQuery) || (Object.keys(jsonQuery).length === 0)) {
        return () => true;
    }
    jsonQuery = Object.assign({}, jsonQuery); // protect against side effects
    return function(obj) {
        for (let key of Object.keys(jsonQuery)) {
            if (! Object.is(obj[key], jsonQuery[key])) return false;
        }
        return true;
    };
}

/**
 * Retries the given (assumed to be asynchronous) action until it succeeds,
 * or throws a general error.
 *
 * @param {function} action - the action to retry, expected to return a promise
 * @param {function} success - A function that is passed the value to which
 *          `action()` resolves, and the current attempt (a number). Should
 *          either return true (indicating success), throw an instance of
 *          {@link WirelessTagPlatform.OperationIncompleteError} to indicate
 *          an unsuccessful attempt that should be retried, or throw another
 *          error to terminate retry attempts.
 * @param {object} [options] - options to be passed on to `retryPromise`.
 * @returns the value to which the action resolves
 * @memberof module:lib/util
 */
function retryUntil(action, success, options) {
    return retryPromised(
        (retry, attempt) => action().then((result) => {
            if (success(result, attempt)) return result;
            throw new Error("should throw RetryUnsuccessfulError if failed");
        }).catch((e) => {
            if (e instanceof OperationIncompleteError) {
                return retry(e);
            }
            throw e;
        }),
        options);
}
