"use strict";

/*
 * Test fixture of common setup and other functions
 */

var chai = require('chai'),
    chaiAsPromised = require('chai-as-promised'),
    sinonChai = require('sinon-chai');

chai.use(chaiAsPromised);
chai.use(sinonChai);

global.expect = chai.expect;
global.sinon = require('sinon');
