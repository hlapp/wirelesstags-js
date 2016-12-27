"use strict";

var util = require('util');

function OperationIncompleteError(msg, object, opName) {
    Error.captureStackTrace(this, this.constructor);
    this.name = this.constructor.name;
    this.object = object;
    this.operation = opName;
    this.message =
        (msg ? msg + "\n" : "")
        + "Operation" + (this.operation ? " '" + this.operation + "'" : "")
        + (this.object ? " on " + this.object.name : "")
        + " remains incomplete."
        + (this.object ? " Current state of object:\n" + this.object : "");
}
util.inherits(OperationIncompleteError, Error);

module.exports = OperationIncompleteError;
