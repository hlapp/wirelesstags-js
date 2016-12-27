"use strict";

var util = require('util');

function OperationUnsupportedError(msg, object, opName) {
    Error.captureStackTrace(this, this.constructor);
    this.name = this.constructor.name;
    this.object = object;
    this.operation = opName;
    this.message =
        (msg ? msg + "\n" : "")
        + (this.object ? this.object.name : "object")
        + " does not support "
        + (this.operation ? this.operation : "operation")
        + (this.object ? ". Current state of object:\n" + this.object : "");
}
util.inherits(OperationUnsupportedError, Error);

module.exports = OperationUnsupportedError;
