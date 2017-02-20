"use strict";

/*
 * Test that all of the core modules and objects load correctly.
 */

describe('loading modules and instantiating objects:', function() {

    var WirelessTagPlatform,
        WirelessTagManager,
        WirelessTag,
        WirelessTagSensor;
    var platform,
        manager,
        tag;

    // platform module
    describe('#WirelessTagPlatform', function() {
        it('should load module', function() {
            expect(() => { WirelessTagPlatform = require('../') }).
                to.not.throw();
        });
        it('should instantiate object with new', function() {
            expect(() => { platform = new WirelessTagPlatform() }).
                to.not.throw();
        });
        it('can also create() object', function() {
            expect(() => { platform = WirelessTagPlatform.create() }).
                to.not.throw();
            expect(platform).to.be.instanceOf(WirelessTagPlatform);
        });
    });

    // tag manager module
    describe('#WirelessTagManager', function() {
        it('should load module ', function() {
            expect(() => { WirelessTagManager = require('../lib/tagmanager') }).
                to.not.throw();
        });
        it('should instantiate object with new', function() {
            expect(() => { manager = new WirelessTagManager(platform) }).
                to.not.throw();
        });
    });

    // tag module
    describe('#WirelessTag', function() {
        it('should load module ', function() {
            expect(() => { WirelessTag = require('../lib/tag') }).
                to.not.throw();
        });
        it('should instantiate object with new', function() {
            expect(() => { tag = new WirelessTag(manager) }).
                to.not.throw();
        });
    });

    // sensor module
    describe('#WirelessTagSensor', function() {
        it('should load module ', function() {
            expect(() => { WirelessTagSensor = require('../lib/sensor') }).
                to.not.throw();
        });
        it('should instantiate object with new', function() {
            expect(() => new WirelessTagSensor(tag, 'temp')).
                to.not.throw();
        });
    });
});
