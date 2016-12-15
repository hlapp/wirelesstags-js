"use strict";

var tagManager;
var credentialsMissing = true;
var tags = [];

/*
 * Test functions of the tag manager object
 */

describe('WirelessTagManager:', function() {

    var WirelessTagManager,
        WirelessTagPlatform,
        WirelessTag,
        platform;

    before('load and connect to platform, find tag manager(s)', function(done) {
        WirelessTagPlatform = require('../');
        WirelessTagManager = require('../lib/tagmanager.js');
        WirelessTag = require('../lib/tag.js');

        // create platform object, register listeners
        platform = WirelessTagPlatform.create();
        platform.on('discover', (manager) => {
            // right now we only need one tag manager for testing
            if (tagManager === undefined) tagManager = manager;
            done();
        });

        // load connection options, then connect
        let connOpts = WirelessTagPlatform.loadConfig();
        if ((connOpts.username && connOpts.password) || connOpts.bearer) {
            credentialsMissing = false;
            platform.connect(connOpts).then(
                (pf) => { pf.discoverTagManagers(); }
            ).catch((e) => { console.error(e.stack ? e.stack : e); throw e; });
        } else {
            // signal we're done - without connecting there's no discovering
            done();
        }
    });

    describe('#mac', function() {
        it('a string, its (unique) MAC address', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            expect(tagManager.mac).to.be.a('string').
                and.to.have.length.within(10,14);     // 12 in theory?
        });
    });
    describe('#name', function() {
        it('a string, its (user-assigned) name', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            return expect(tagManager.name).to.be.a('string').
                and.to.not.be.empty;
        });
    });
    describe('#online', function() {
        it('a boolean, whether it is online', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            expect(tagManager.online).to.be.a('boolean');
        });
    });
    describe('#selected', function() {
        it('a boolean, whether it is currently selected', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            expect(tagManager.selected).to.be.a('boolean');
        });
    });
    describe('#wirelessConfig', function() {
        it('an object, wireless communication settings', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            expect(tagManager.wirelessConfig).to.be.a('object');
        });
        it('should have at least a certain list of properties', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            expect(tagManager.wirelessConfig).to.have.all.keys(
                'dataRate',
                'activeInterval',
                'Freq',
                'useCRC16',
                'useCRC32',
                'psid');
        });
    });
    describe('#radioId', function() {
        it('a string, its (unique?) radio identity (freq band?)', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            return expect(tagManager.radioId).to.be.a('string').
                and.to.not.be.empty;
        });
        it('should convert to a float between 100-200', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            // normally these are around 150
            expect(Number(tagManager.radioId)).to.be.within(100,200);
        });
    });
    describe('#rev', function() {
        it('a number, should be its revision', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            expect(tagManager.rev).to.be.a('number').
                and.to.be.below(256);     // byte
        });
    });

    describe('#select()', function() {
        it('should promise to select it for API calls - happens automatically',
           function() {
               // skip this if we don't have connection information
               if (credentialsMissing) return this.skip();
               
               return expect(tagManager.select()).
                   to.eventually.equal(tagManager);
           });
        it('property "selected" should be true afterwards', function() {
               // skip this if we don't have connection information
               if (credentialsMissing) return this.skip();
               
               return expect(tagManager.selected).to.be.true;
        });
    });

    describe('#discoverTags()', function() {
        let discoverSpy = sinon.spy();
        
        it('should promise an array of tags associated with it', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            tagManager.on('discover', discoverSpy);
            tagManager.on('discover', (tag) => {
                tags.push(tag);
            });
            return expect(tagManager.discoverTags()).
                to.eventually.satisfy((tags) => {
                    return tags.reduce((state, tag) => {
                        return state && (tag instanceof WirelessTag);
                    }, tags.length > 0);
                });
        });
        it('should emit "discover" event for each associated tag', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            expect(discoverSpy).to.have.always.been.calledWith(
                sinon.match.instanceOf(WirelessTag));
        });
    });

});

/*
 * Test functions of the tag object
 */

describe('WirelessTag:', function() {

    describe('#uuid', function() {
        it('a string, its unique identifier as a UUID', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            tags.map((tag) => { return tag.uuid }).forEach((value) => {
                expect(value).to.be.a('string').and.have.lengthOf(36);
            });
        });
    });

    describe('#name', function() {
        it('a string, its (user-assigned) name', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            tags.map((tag) => { return tag.name }).forEach((value) => {
                return expect(value).to.be.a('string').and.to.not.be.empty;
            });
        });
    });

    describe('#slaveId', function() {
        it("a number, its unique 8-bit number among the tag manager's tags",
           function() {
               // skip this if we don't have connection information
               if (credentialsMissing) return this.skip();

               tags.map((tag) => { return tag.slaveId }).forEach((value) => {
                   return expect(value).to.be.a('number').and.to.be.below(256);
               });
           });
    });

    describe('#alive', function() {
        it('a boolean, whether it is "alive"', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            tags.map((tag) => { return tag.alive }).forEach((value) => {
                return expect(value).to.be.a('boolean');
            });
        });
    });

    describe('#tagType', function() {
        it('a number, an 8-bit code for its hardware type', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            tags.map((tag) => { return tag.tagType }).forEach((value) => {
                return expect(value).to.be.a('number').and.to.be.below(256);
            });
        });
    });

    describe('#rev', function() {
        it('a number, an 8-bit code for its hardware revision', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            tags.map((tag) => { return tag.rev }).forEach((value) => {
                return expect(value).to.be.a('number').and.to.be.below(256);
            });
        });
    });

    describe('#updateInterval', function() {
        it('a number, interval between updates in seconds', function() {
            // skip this if we don't have connection information
            if (credentialsMissing) return this.skip();

            tags.map((tag) => {
                return tag.updateInterval;
            }).forEach((value) => {
                return expect(value).to.be.a('number').and.to.be.within(10,
                                                                        7200);
            });
        });
    });

});
