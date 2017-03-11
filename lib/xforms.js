"use strict";

/* eslint-disable no-invalid-this */
var xforms = module.exports = {
    noop: function (x) { return x },
    mapFunction: function(map) { return function(x) { return map[x] } },
    revMapFunction: function(map) {
        return function(x) {
            for (let key in map) {
                /* eslint-disable eqeqeq */
                if (map[key] == x) return key;
                /* eslint-enable eqeqeq */
            }
            throw new RangeError(x + " is not a value in the map");
        };
    },
    valuesInMapFunction: function(map) {
        return function() {
            return Object.keys(map).map((k) => map[k]);
        };
    },
    mapObjectFunction: function(map, prop, xformMap) {
        return function() {
            // return cached object if there is one
            if (prop && this['_'+prop]) return this['_'+prop];
            // otherwise create from scratch
            let value = {};
            let createMappedProp = (obj, key) => {
                let transform = xforms.noop, revTransform = xforms.noop;
                if (xformMap && xformMap[key]) {
                    transform = xformMap[key][0].bind(this);
                    revTransform = xformMap[key][1].bind(this);
                }
                Object.defineProperty(obj, key, {
                    enumerable: true,
                    configurable: true,
                    get: () => transform(this.data[map[key]]),
                    set: (x) => {
                        this.data[map[key]] = revTransform(x);
                        if ('function' === typeof this.markModified) {
                            this.markModified(map[key]);
                            this.markModified((prop ? prop + '.' : '') + key);
                        }
                    }
                });
            };
            for (let key in map) {
                createMappedProp(value, key);
            }
            // prevent other properties from being added accidentally
            Object.seal(value);
            // cache for the future (as non-enumerable and read-only) and return
            if (prop) Object.defineProperty(this, '_'+prop, { value: value });
            return value;
        };
    },
    delegatingFunction: function(delegateTo, propName) {
        let xformFunc = function(value) {
            if (value === undefined) {
                value = this[propName];
            } else {
                this[propName] = value;
            }
            return value;
        };
        return xformFunc.bind(delegateTo);
    },
    degCtoF: function(x, isRelative) {
        return x * 9/5.0 + (isRelative ? 0 : 32);
    },
    degFtoC: function(x, isRelative) {
        return (x - (isRelative ? 0 : 32)) * 5/9.0;
    },
    tempToNative: function(isRelative) {
        return function(x) {
            let mconfig = this.monitoringConfig ? this.monitoringConfig() : this;
            let unit = mconfig.unit;
            return unit === "degF" ? xforms.degFtoC(x, isRelative) : x;
        };
    },
    tempFromNative: function(isRelative) {
        return function(x) {
            let mconfig = this.monitoringConfig ? this.monitoringConfig() : this;
            let unit = mconfig.unit;
            return unit === "degF" ? xforms.degCtoF(x, isRelative) : x;
        };
    },
    rh2dewPoint: function(x) {
        let T = this.wirelessTag.data.temperature; // need native dC temperature
        let b = 17.67, c = 243.5;
        let m = Math.log(x / 100.0) + b * T / (c + T);
        return c * m / (b - m);
    }
};
